#!/usr/bin/env python3
"""Generates an invented map pack for The Ember Crown test guide (public domain, CC0).

Writes test/fixtures/ember-crown-maps.zip containing:
  maps.json            titles, order, guide sections and example links
  world.png            overworld with the towns and dungeons from the test guide
  old-quarry.png       dungeon floor plan (section 3.1.3)
  clockwork-vault.png  dungeon floor plan with the four dials (section 3.9.3)
  harrowgate.jpg       town plan (section 3.1.1), a JPEG to exercise that path

Usage: python3 test/make_maps.py [--out DIR]   (needs Pillow and numpy)
"""
import io
import json
import random
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_DIR = "/usr/share/fonts/truetype/dejavu/"


def font(name, size):
    try:
        return ImageFont.truetype(FONT_DIR + name, size)
    except OSError:
        return ImageFont.load_default()


SERIF_B = lambda s: font("DejaVuSerif-Bold.ttf", s)
SERIF_I = lambda s: font("DejaVuSerif-Italic.ttf", s)
SANS = lambda s: font("DejaVuSans.ttf", s)
SANS_B = lambda s: font("DejaVuSans-Bold.ttf", s)

PARCH = (236, 224, 196)
INK = (74, 54, 36)
SEA = (126, 164, 170)
LAND = (214, 199, 158)
FOREST = (120, 142, 92)
MOUNT = (150, 128, 100)
RED = (160, 52, 40)


def noise(w, h, seed, octaves=5):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cells = 3 * 2 ** o
        g = rng.random((cells + 1, cells + 1))
        img = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += amp * (np.asarray(img) / 255.0)
        total += amp
        amp *= 0.5
    return out / total


def label(d, xy, text, f, fill=INK, halo=PARCH, anchor="mm"):
    x, y = xy
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            if dx or dy:
                d.text((x + dx, y + dy), text, font=f, fill=halo, anchor=anchor)
    d.text((x, y), text, font=f, fill=fill, anchor=anchor)


def world():
    W, H = 2400, 1600
    n = noise(W, H, 7)
    yy, xx = np.mgrid[0:H, 0:W]
    # Two continents shaped by falloff around centres.
    c1 = np.exp(-(((xx - 820) / 640) ** 2 + ((yy - 760) / 520) ** 2))
    c2 = np.exp(-(((xx - 1780) / 420) ** 2 + ((yy - 900) / 560) ** 2))
    height = n * 0.55 + np.maximum(c1, c2) * 0.75
    land = height > 0.62
    forest = land & (noise(W, H, 11, 4) > 0.56)
    mount = land & (height > 0.86)

    img = np.zeros((H, W, 3), dtype=np.uint8)
    img[:] = SEA
    img[land] = LAND
    img[forest] = FOREST
    img[mount] = MOUNT
    base = Image.fromarray(img)
    # Coastline: dark edge.
    edge = Image.fromarray((land * 255).astype(np.uint8)).filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(3))
    base.paste(INK, mask=edge)
    # Paper grain.
    grain = (noise(W, H, 3, 6) * 30 - 15).astype(np.int16)
    arr = np.clip(np.asarray(base).astype(np.int16) + grain[..., None], 0, 255).astype(np.uint8)
    im = Image.fromarray(arr)
    d = ImageDraw.Draw(im)

    rng = random.Random(4)

    def on_land(x, y):
        return land[int(y), int(x)]

    def pick(cx, cy, r):
        for _ in range(500):
            x, y = cx + rng.uniform(-r, r), cy + rng.uniform(-r, r)
            if 80 < x < W - 80 and 80 < y < H - 80 and on_land(x, y) and not mount[int(y), int(x)]:
                return x, y
        return cx, cy

    towns = ["Harrowgate", "Saltmere", "Vell's Crossing", "Brindlehook", "Orrin Keep", "Duskwater",
             "Kettle Hollow", "Tamsin Bay", "Greywold", "Lantern Rest"]
    dungeons = ["Old Quarry", "Weeping Aqueduct", "Bramble Labyrinth", "Sunken Abbey", "Copper Mine",
                "Lighthouse Ruins", "Frostbite Pass", "Hollow Oak", "Clockwork Vault", "Ashen Spire"]
    anchors = [(560, 640), (760, 420), (980, 560), (700, 900), (1000, 980), (1240, 760),
               (1640, 560), (1880, 760), (1720, 1100), (1960, 1260)]
    tpos = [pick(ax, ay, 90) for ax, ay in anchors]
    def far_from_towns(x, y):
        return all(((x - tx) / 290) ** 2 + ((y - ty) / 130) ** 2 > 1 for tx, ty in tpos)

    dpos = []
    for x, y in tpos:
        for _ in range(400):
            cand = pick(x + rng.uniform(-260, 260), y + rng.uniform(-200, 200), 40)
            if on_land(*cand) and far_from_towns(*cand) and all(np.hypot(cand[0] - a, cand[1] - b) > 200 for a, b in dpos):
                break
        dpos.append(cand)

    # Roads between consecutive towns on the same continent, dashed.
    for (x1, y1), (x2, y2) in zip(tpos, tpos[1:]):
        steps = int(np.hypot(x2 - x1, y2 - y1) / 14)
        pts = [(x1 + (x2 - x1) * t / steps, y1 + (y2 - y1) * t / steps) for t in range(steps + 1)]
        for i in range(0, len(pts) - 1, 2):
            if on_land(*pts[i]) and on_land(*pts[i + 1]):
                d.line([pts[i], pts[i + 1]], fill=RED, width=4)
    # Sea route between continents.
    d.line([tpos[5], tpos[6]], fill=(60, 90, 110), width=3)

    for i, ((x, y), name) in enumerate(zip(tpos, towns), 1):
        d.rectangle([x - 11, y - 11, x + 11, y + 11], fill=PARCH, outline=INK, width=4)
        d.rectangle([x - 4, y - 4, x + 4, y + 4], fill=INK)
        label(d, (x, y - 34), name, SERIF_B(30))
        label(d, (x, y + 30), f"3.{i}", SANS(20), fill=RED)
    for (x, y), name in zip(dpos, dungeons):
        d.polygon([(x, y - 16), (x + 15, y + 12), (x - 15, y + 12)], fill=RED, outline=INK)
        label(d, (x, y + 34), name, SERIF_I(24))

    # Title cartouche and compass.
    d.rounded_rectangle([60, 60, 840, 190], 18, fill=PARCH, outline=INK, width=5)
    d.text((450, 108), "The Realm of the Ember Crown", font=SERIF_B(38), fill=INK, anchor="mm")
    d.text((450, 155), "Overworld · invented test map · public domain", font=SERIF_I(22), fill=INK, anchor="mm")
    cx, cy = W - 170, H - 190
    d.ellipse([cx - 90, cy - 90, cx + 90, cy + 90], outline=INK, width=4)
    d.polygon([(cx, cy - 120), (cx + 22, cy), (cx, cy + 20), (cx - 22, cy)], fill=RED, outline=INK)
    d.polygon([(cx, cy + 120), (cx + 22, cy), (cx, cy - 20), (cx - 22, cy)], fill=PARCH, outline=INK)
    label(d, (cx, cy - 145), "N", SERIF_B(34))
    # Legend.
    lx, ly = 70, H - 230
    d.rounded_rectangle([lx - 10, ly - 20, lx + 360, ly + 170], 14, fill=PARCH, outline=INK, width=3)
    d.rectangle([lx + 10, ly + 10, lx + 30, ly + 30], fill=PARCH, outline=INK, width=4)
    d.text((lx + 50, ly + 20), "Town (guide chapter)", font=SANS(24), fill=INK, anchor="lm")
    d.polygon([(lx + 20, ly + 58), (lx + 34, ly + 84), (lx + 6, ly + 84)], fill=RED, outline=INK)
    d.text((lx + 50, ly + 74), "Dungeon", font=SANS(24), fill=INK, anchor="lm")
    d.line([(lx + 6, ly + 126), (lx + 18, ly + 126)], fill=RED, width=4)
    d.line([(lx + 24, ly + 126), (lx + 36, ly + 126)], fill=RED, width=4)
    d.text((lx + 50, ly + 126), "Road", font=SANS(24), fill=INK, anchor="lm")
    d.rectangle([4, 4, W - 5, H - 5], outline=INK, width=8)
    return im


def floorplan(title, subtitle, seed, extras=None):
    W, H = 1800, 1300
    rng = random.Random(seed)
    im = Image.new("RGB", (W, H), (28, 34, 46))
    d = ImageDraw.Draw(im)
    cell = 50
    for x in range(0, W, cell):
        d.line([(x, 0), (x, H)], fill=(38, 46, 60), width=1)
    for y in range(0, H, cell):
        d.line([(0, y), (W, y)], fill=(38, 46, 60), width=1)
    rooms = []
    for _ in range(80):
        if len(rooms) >= 9:
            break
        w, h = rng.randint(4, 8) * cell, rng.randint(3, 6) * cell
        x, y = rng.randint(2, (W - w) // cell - 2) * cell, rng.randint(4, (H - h) // cell - 2) * cell
        r = (x, y, x + w, y + h)
        if any(not (r[2] + cell < o[0] or o[2] + cell < r[0] or r[3] + cell < o[1] or o[3] + cell < r[1]) for o in rooms):
            continue
        rooms.append(r)
    rooms.sort(key=lambda r: (r[0], r[1]))
    floor, wall = (196, 186, 160), (236, 228, 206)
    centers = [((r[0] + r[2]) // 2 // cell * cell + cell // 2, (r[1] + r[3]) // 2 // cell * cell + cell // 2) for r in rooms]
    for (x1, y1), (x2, y2) in zip(centers, centers[1:]):
        d.line([(x1, y1), (x2, y1), (x2, y2)], fill=floor, width=cell - 14, joint="curve")
    for i, r in enumerate(rooms):
        d.rectangle(r, fill=floor, outline=wall, width=6)
    for (x1, y1), (x2, y2) in zip(centers, centers[1:]):
        d.line([(x1, y1), (x2, y1), (x2, y2)], fill=floor, width=cell - 22, joint="curve")
    for i, ((x, y), r) in enumerate(zip(centers, rooms), 1):
        d.ellipse([x - 22, y - 22, x + 22, y + 22], fill=(28, 34, 46))
        d.text((x, y), str(i), font=SANS_B(24), fill=(236, 228, 206), anchor="mm")
    # Chests, save point, entrance, stairs.
    gold, cyan = (232, 182, 72), (120, 210, 220)
    for r in rng.sample(rooms, min(4, len(rooms))):
        x, y = r[0] + 30, r[1] + 30
        d.rectangle([x, y, x + 28, y + 20], fill=gold, outline=(80, 60, 20), width=3)
    sx, sy = rooms[len(rooms) // 2][2] - 40, rooms[len(rooms) // 2][3] - 40
    d.ellipse([sx - 16, sy - 16, sx + 16, sy + 16], outline=cyan, width=5)
    ex, ey = centers[0]
    d.polygon([(ex - 30, rooms[0][3] + 6), (ex + 30, rooms[0][3] + 6), (ex, rooms[0][3] + 40)], fill=(220, 90, 70))
    lx, ly = centers[-1][0] + 80, centers[-1][1]
    for k in range(4):
        d.line([(lx - 34 + k * 8, ly + 36 - k * 10), (lx + 34 - k * 8, ly + 36 - k * 10)], fill=(28, 34, 46), width=5)
    if extras:
        extras(d, rooms, centers)
    d.rectangle([0, 0, W, 150], fill=(20, 24, 34))
    d.text((40, 52), title, font=SERIF_B(48), fill=(236, 228, 206), anchor="lm")
    d.text((40, 108), subtitle, font=SANS(24), fill=(170, 176, 190), anchor="lm")
    # Legend on the header.
    items = [("chest", gold), ("save point", cyan), ("entrance", (220, 90, 70))]
    x = W - 560
    for name, col in items:
        if name == "save point":
            d.ellipse([x, 62, x + 26, 88], outline=col, width=5)
        elif name == "entrance":
            d.polygon([(x, 62), (x + 26, 62), (x + 13, 88)], fill=col)
        else:
            d.rectangle([x, 64, x + 26, 84], fill=col)
        d.text((x + 36, 75), name, font=SANS(22), fill=(200, 204, 214), anchor="lm")
        x += 180
    return im


def vault_extras(d, rooms, centers):
    # The four dials from the guide's puzzle, in the largest room.
    big = max(rooms, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
    cx, cy = (big[0] + big[2]) // 2, (big[1] + big[3]) // 2
    for name, (dx, dy), face in [("N", (0, -1), "Sun"), ("E", (1, 0), "Moon"), ("S", (0, 1), "Star"), ("W", (-1, 0), "Sun")]:
        x, y = cx + dx * 70, cy + dy * 52
        d.ellipse([x - 22, y - 22, x + 22, y + 22], fill=(120, 96, 60), outline=(236, 228, 206), width=3)
        d.text((x, y), name, font=SANS_B(20), fill=(236, 228, 206), anchor="mm")
    d.text((cx, big[3] - 18), "dials: N Sun · E Moon · S Star · W Sun", font=SANS(18), fill=(40, 34, 30), anchor="mm")


def town():
    W, H = 1600, 1100
    im = Image.new("RGB", (W, H), (226, 216, 186))
    d = ImageDraw.Draw(im)
    d.ellipse([140, 120, W - 140, H - 80], fill=(208, 196, 160), outline=INK, width=8)
    d.line([(W // 2, 120), (W // 2, H - 80)], fill=(180, 160, 120), width=60)
    d.line([(140, H // 2), (W - 140, H // 2)], fill=(180, 160, 120), width=60)
    d.ellipse([W // 2 - 70, H // 2 - 70, W // 2 + 70, H // 2 + 70], fill=(140, 170, 180), outline=INK, width=5)
    label(d, (W // 2, H // 2), "Well", SANS_B(26), halo=(140, 170, 180))
    shops = [("Inn", 380, 300), ("Item Shop", 1040, 300), ("Weapon Shop", 1080, 760), ("Mayor's House", 400, 780), ("Chapel", 800, 220)]
    for name, x, y in shops:
        d.rectangle([x - 110, y - 70, x + 110, y + 70], fill=(170, 110, 80), outline=INK, width=5)
        label(d, (x, y), name, SANS_B(26), halo=(170, 110, 80), fill=(250, 240, 220))
    d.rectangle([W // 2 - 50, H - 110, W // 2 + 50, H - 50], fill=RED)
    label(d, (W // 2, H - 30), "Exit to the world map", SANS(22), halo=(226, 216, 186))
    d.rectangle([20, 20, 760, 100], fill=(226, 216, 186), outline=INK, width=4)
    d.text((40, 60), "Harrowgate · town plan (invented)", font=SERIF_B(34), fill=INK, anchor="lm")
    return im


def main():
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else Path(__file__).parent / "fixtures"
    out.mkdir(parents=True, exist_ok=True)
    images = {
        "world.png": world(),
        "old-quarry.png": floorplan("The Old Quarry", "Guide section 3.1.3 · invented test map · public domain", 21),
        "clockwork-vault.png": floorplan("The Clockwork Vault", "Guide section 3.9.3 · dial puzzle in 3.7.4 · invented test map", 9, vault_extras),
        "harrowgate.jpg": town(),
    }
    manifest = {
        "title": "Ember Crown maps (invented, public domain)",
        "maps": [
            {"file": "world.png", "title": "World map", "section": "3.0"},
            {"file": "harrowgate.jpg", "title": "Harrowgate town plan", "section": "3.1.1"},
            {"file": "old-quarry.png", "title": "Old Quarry", "section": "3.1.3"},
            {"file": "clockwork-vault.png", "title": "Clockwork Vault", "section": "3.9.3"},
        ],
        "links": [
            {"title": "Interactive world map", "url": "https://example.com/ember-crown/maps/world", "section": "3.0",
             "note": "Example link; the site is fictional"},
            {"title": "Clockwork Vault dial solver", "url": "https://example.org/ember-crown/vault-dials", "section": "3.7.4",
             "note": "Example link; the site is fictional"},
            {"title": "Treasure checklist (all chests)", "url": "https://example.net/ember-crown/chests"},
        ],
    }
    dest = out / "ember-crown-maps.zip"
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("ember-crown-maps/maps.json", json.dumps(manifest, indent=2))
        for name, im in images.items():
            buf = io.BytesIO()
            if name.endswith(".jpg"):
                im.save(buf, "JPEG", quality=85)
            else:
                im.save(buf, "PNG", optimize=True)
            z.writestr("ember-crown-maps/" + name, buf.getvalue(), compress_type=zipfile.ZIP_STORED if name.endswith(".jpg") else zipfile.ZIP_DEFLATED)
    print(f"wrote {dest} ({dest.stat().st_size // 1024} KB)")
    if "--images" in sys.argv:
        for name, im in images.items():
            im.save(out / name)


if __name__ == "__main__":
    main()
