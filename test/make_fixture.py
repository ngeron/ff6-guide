#!/usr/bin/env python3
"""Generates an original, invented walkthrough in the classic GameFAQs text format.

It exercises everything the importer handles: title block, contents, chapter and
subsection headings, a sub-table of contents, wrapped prose, hyphenated wraps,
indented info boxes, labelled lines, stat blocks, aligned shop tables, dialogue,
indented option lists, URLs and _underscore_ / *star* emphasis.

Usage:
  python3 test/make_fixture.py                  -> test/fixtures/ember-crown-guide.txt
  python3 test/make_fixture.py --pdf out.pdf    -> also a PDF laid out like a Safari
                                                   "Save as PDF" of a web page (needs reportlab)
"""
import random
import sys
import textwrap
from pathlib import Path

rng = random.Random(1337)
W = 79
STARS = "*" * 34
DASH = "-" * 79
out = []


def line(s=""):
    out.append(s)


def para(text, indent=0):
    pad = " " * indent
    for l in textwrap.wrap(text, W - indent, break_on_hyphens=True):
        line(pad + l)
    line()


def heading(num, title, dashed=True):
    if dashed:
        line(DASH)
    line(f" {num:<8}{title}" if num else f" {title}")
    line(STARS)
    line()


def box(label, items):
    line(f"  {label}:")
    for l in textwrap.wrap(", ".join(items), W - 2):
        line("  " + l)
    line()


def shop(name, rows, note):
    line(f"{name}:")
    for item, price in rows:
        line(f"{item:<20}{price:>6}")
    for i, l in enumerate(textwrap.wrap(note, W - 1)):
        line((" " if i == 0 else "") + l)
    line()


# ---------------------------------------------------------------- world data
TOWNS = ["Harrowgate", "Saltmere", "Vell's Crossing", "Brindlehook", "Orrin Keep", "Duskwater",
         "Kettle Hollow", "Tamsin Bay", "Greywold", "Lantern Rest", "Cinderfall", "the Glass Steppe"]
DUNGEONS = ["Old Quarry", "Weeping Aqueduct", "Bramble Labyrinth", "Sunken Abbey", "Copper Mine",
            "Lighthouse Ruins", "Frostbite Pass", "Hollow Oak", "Clockwork Vault", "Ashen Spire"]
HEROES = ["Wren", "Corvin", "Isolde", "Pell", "Maro", "Tamsin"]
PRE = ["Mud", "Gloom", "Thorn", "Cinder", "Brine", "Rust", "Moss", "Frost", "Ember", "Hollow", "Grave", "Wisp"]
POST = ["crawler", "hound", "beak", "maw", "drake", "golem", "moth", "wight", "lurker", "snapper", "toad", "knight"]
ITEMS = [("Tonic", 40), ("Hi-Tonic", 250), ("Smelling Salts", 90), ("Antivenom", 45), ("Ether Drop", 1200),
         ("Phoenix Quill", 600), ("Camp Kit", 900), ("Eye Balm", 60), ("Warp Shard", 700), ("Smoke Bomb", 150)]
WEAPONS = ["Tin Sabre", "Oak Staff", "Iron Rapier", "Hunting Bow", "Quartz Rod", "Steel Glaive",
           "Moonsilver Blade", "Thorn Whip", "Ember Lance", "Storm Spear", "Duskfang", "Crown Edge"]
ARMOR = ["Quilted Vest", "Leather Cap", "Chain Shirt", "Buckler", "Scale Mail", "Feathered Hat",
         "Warden Plate", "Mirror Shield", "Silk Cloak", "Rune Helm"]
RELICS = ["Swift Boots", "Ward Charm", "Lucky Coin", "Owl Pendant", "Iron Will Ring", "Stillwater Bead"]
ELEMENTS = ["Fire", "Ice", "Bolt", "Water", "Wind", "Earth", "Holy", "Poison"]
STATUS = ["Poison", "Sleep", "Silence", "Blind", "Slow", "Stop", "Confuse", "Petrify", "Doom"]
QUIPS = [
    "Bring a snack; this part takes a while.",
    "Yes, the music here is the best in the game. No, I will not be taking questions.",
    "If you skipped the side room earlier, now is a good time to regret it.",
    "The developers clearly had a deadline when they built this floor.",
    "Save before you open that door. Trust me on this one.",
    "Somebody on the message boards swears there's a secret here. There isn't.",
]

monsters = []
used = set()
while len(monsters) < 60:
    n = rng.choice(PRE) + rng.choice(POST)
    if n in used:
        continue
    used.add(n)
    monsters.append(n)


def stat_block(name, level, boss=False):
    hp = rng.randint(40, 300) * (60 if boss else 1) * level // 4
    weak = rng.choice(ELEMENTS)
    vuln = rng.sample(STATUS, rng.randint(1, 5))
    line(name)
    line(f"Level: {level}, HP: {hp}, MP: {rng.randint(0, 40) * level}")
    line(f"Steal: {rng.choice(ITEMS)[0]} (rare), {rng.choice(ITEMS)[0]} (common), Win: {rng.choice(ITEMS)[0]} (always)")
    line(f"Weakness: {weak}")
    line(f"Special: !{rng.choice(['Lunge', 'Gnaw', 'Shriek', 'Crush', 'Spit'])}: sets {rng.choice(STATUS)}, Attack x 1.5")
    attacks = ", ".join(["Attack"] + rng.sample(["Gale Slash", "Cinder Breath", "Rockfall", "Hex", "Chill Touch", "Tidal Rush"], 2))
    vl = ", ".join(vuln)
    full = f"Vulnerable to: {vl}"
    if len(full) > W:
        cut = full.rfind(",", 0, W) + 1
        line(full[:cut])
        line(full[cut:].strip())
    else:
        line(full)
    line(f"Attacks: {attacks}")
    line()
    return weak


# ---------------------------------------------------------------- document
line("The Ember Crown Walkthrough and Field Notes")
line("Version 1.3")
line("Testwright, March 2011")
line()
line('"A map is just a promise somebody made about the ground."')
line("     \"And the ground never signed it.\"")
line()
line("- an innkeeper in Saltmere")
line()
line("Contents")
line()
line("No number: Contents")
line()
chapters = [("1.0", "Version History"), ("2.0", "Introduction and conventions"), ("3.0", "The Walkthrough"),
            ("4.0", "Shops and Equipment"), ("5.0", "Bestiary"), ("6.0", "Frequently Asked Questions"),
            ("7.0", "Credits and legal")]
for num, title in chapters:
    line(f" {num:<8}{title}")
line()

heading("1.0", "Version History", dashed=False)
for v, d, notes in [("1.3", "03/02/2011", "Added the Clockwork Vault puzzle solution and fixed two shop prices "
                    "that were swapped. Rewrote the final boss strategy after some very helpful mail."),
                    ("1.2", "11/20/2010", "Bestiary now lists steal tables. Corrected a north/south mix-up in "
                     "the Bramble Labyrinth."),
                    ("1.0", "08/14/2010", "First complete release.")]:
    line(f"- Version {v}  ({d})")
    for l in textwrap.wrap(notes, W - 6):
        line("      " + l)
    line()

heading("2.0", "Introduction and conventions", dashed=False)
para("This is a complete walkthrough for The Ember Crown, an invented role-playing game that exists only "
     "so this document can test a guide reader. Every town, monster and item below is made up. Any "
     "resemblance to a real game is a sign that role-playing games have used the same ideas for forty years.")
para("The walkthrough follows the main story in order. Each section lists the monsters you meet, the "
     "treasure you can find, and the shops in the area, followed by a description of the route and "
     "strategies for anything dangerous. General questions are answered in the FAQ at the end.")
line("Slang:")
line()
for term, desc in [("ST:", "Single-target. It hits one thing."), ("MT:", "Multi-target. It hits everything on one side."),
                   ("!Special:", "Monster attacks marked with an exclamation point are physical specials, "
                    "usually stronger than a normal Attack and often carrying a status effect.")]:
    line(term)
    line()
    para(desc)
para("For more on the conventions used by old text guides, see http://www.example.com/text-guides "
     "(an example address that goes nowhere).")

heading("3.0", "The Walkthrough", dashed=False)
line("Table of Contents:")
line()
sections = []
mi = 0
for ci in range(1, 11):
    town = TOWNS[(ci - 1) % len(TOWNS)]
    dung = DUNGEONS[(ci - 1) % len(DUNGEONS)]
    subs = [f"{town}", f"Traveling to the {dung}", f"The {dung}"]
    if ci % 2 == 0:
        subs.append(f"The battle with the {monsters[(ci * 5) % len(monsters)]} Queen")
    if ci == 7:
        subs.append("The Clockwork Vault puzzle, explained slowly and with considerable patience for "
                    "everyone involved")
    for si, t in enumerate(subs, 1):
        sections.append((f"3.{ci}.{si}", t, ci, si))
for num, t, _, _ in sections:
    wrapped = textwrap.wrap(t, W - 12)
    line(f" {num:<9}{wrapped[0]}")
    for extra in wrapped[1:]:
        line(" " * 10 + extra)
line()

for num, title, ci, si in sections:
    heading(num, title)
    town = TOWNS[(ci - 1) % len(TOWNS)]
    level = ci * 3 + si
    foes = monsters[mi % 60: mi % 60 + 3]
    mi += 3
    party = rng.sample(HEROES, 3)
    if "battle with" in title:
        boss = title.split("battle with the ")[1]
        para(f"{boss} waits at the bottom of the stairs, and the game is not subtle about it: the floor "
             f"is covered in the bones of adventurers who did not read this section first.")
        weak = stat_block(boss, level + 4, boss=True)
        para(f"Open with {party[0]} casting a {weak} spell; it does nearly double damage. Keep {party[1]} on "
             f"healing duty, because the second phase starts with an MT attack that will flatten anyone "
             f"below about {level * 30} HP. When {boss} says \"You cannot burn what is already ash!\", it is "
             f"about to switch to its counter-attack pattern, so stop using physical attacks for one turn.")
        para(f"Note: if you are beyond the shame of any adventurer, you can steal a rare item here with "
             f"enough patience. It costs about twenty minutes and most of your dignity.")
        continue
    if "puzzle" in title:
        para("The vault has four dials, and each one rotates the two next to it. The game never explains "
             "this. Set them in this order:")
        line("Dial         Turns   Facing")
        for d, tn, f in [("North", 2, "Sun"), ("East", 1, "Moon"), ("South", 3, "Star"), ("West", 0, "Sun")]:
            line(f"{d:<13}{tn:<8}{f}")
        line()
        para("If you get it wrong, a Rustgolem drops from the ceiling. It is not hard, just embarrassing.")
        continue
    box("Opponents", [f"{m} (#{monsters.index(m) + 1})" for m in foes])
    box("Container contents", rng.sample([i for i, _ in ITEMS] + RELICS, 4) + [f"{rng.randint(2, 30) * 100} Gil"])
    para(f"{title} is where the story picks up speed. You arrive with {party[0]}, {party[1]} and {party[2]}, "
         f"and almost immediately somebody asks you to do something unreasonable. {rng.choice(QUIPS)}")
    para(f"Preparation: Put {party[2]} in the Back Row. Physical attacks from the back do half damage, but "
         f"{party[2]} will be casting anyway, and you'll take half damage in return.")
    line("Monster formations:")
    line()
    line("(Outside)")
    line(f"{foes[0]}, {foes[0]} (10/16)")
    line(f"{foes[1]}, {foes[0]} (6/16)")
    line()
    line("(Inside)")
    line(f"{foes[2]}, {foes[2]}, {foes[1]} (11/16)")
    line(f"{foes[1]}, {foes[2]} (5/16)")
    line()
    para(f"{foes[0]} enemies are the ones to watch. They have a habit of using !Lunge on whoever is lowest "
         f"on HP, and around level {level} that can finish off a weakened mage. {foes[1]} absorbs "
         f"{rng.choice(ELEMENTS)}, so check your MT spells before you fire them off. As for {foes[2]}, it is a "
         f"self-destructive little thing with a 33 % chance to hurt itself whenever you hit it without "
         f"killing it.")
    if si == 1:
        shop("Item Shop", rng.sample(ITEMS, 6), "Stock up on Tonics. Nothing else here is urgent, and "
             "you'll want the money for the weapon shop.")
        wpn = rng.sample(WEAPONS, 4)
        shop("Weapon Shop", [(w, rng.randint(3, 40) * 50 * ci) for w in wpn],
             f"Buy the {wpn[-1]} for {party[0]} if you can afford it. It's a large upgrade.")
        line(f"Innkeeper: Rooms are {ci * 20} Gil. Breakfast is extra, and it's mostly porridge.")
        line(f"{party[0]}: We'll take two.")
        line()
    if si == 2:
        line("At the crossroads you'll get two options:")
        line("         Take the cliff path.")
        line("         Take the river path.")
        para("The cliff path is shorter but has twice as many encounters. The river path has a hidden "
             "chest behind the waterfall with a Ward Charm, which is worth the detour.")
    para(f"Hidden Items: There's a {rng.choice(ITEMS)[0]} in the barrel behind the well, and a "
         f"{rng.choice(RELICS)} in the clock of the mayor's house. Leave the chest in the cellar alone for "
         f"now; its contents change into something much better later in the game, and you'll come back "
         f"this way anyway.")
    para(f"When you're ready, head {rng.choice(['north', 'east', 'south', 'west'])} out of {town}. The "
         f"_Ember_Crown_ itself is mentioned for the first time here, in a conversation that is easy to "
         f"miss. It's worth reading *all* of it.")

heading("4.0", "Shops and Equipment")
para("A quick reference of every shop's stock, by town. Prices are in Gil.")
for t in TOWNS[:6]:
    shop(f"{t} Armor Shop", [(a, rng.randint(2, 30) * 50) for a in rng.sample(ARMOR, 5)],
         f"The best value in {t} is usually the cheapest helmet; armor upgrades come thick and fast.")
    shop(f"{t} Relic Shop", [(r, rng.randint(5, 40) * 100) for r in rng.sample(RELICS, 3)],
         "Relics never go out of date, so buy them when you can.")

heading("5.0", "Bestiary")
para("Every regular monster, in the order the in-game bestiary lists them.")
for i, m in enumerate(monsters[:40], 1):
    stat_block(f"{m} (#{i})", rng.randint(1, 45))

heading("6.0", "Frequently Asked Questions")
for q, a in [("Q: Can I go back to Harrowgate after the bridge collapses?",
              "A: Yes, once you have the airship. The bridge itself is gone for good."),
             ("Q: Is the Crown Edge worth the trouble?",
              "A: It's the strongest sword in the game, so yes, but only if you enjoy fighting the same "
              "monster forty times in a row for a rare drop."),
             ("Q: Why does my save file say 'Chapter 0'?",
              "A: That's a known bug if you save during the opening cutscene. It's harmless.")]:
    line(q)
    for l in textwrap.wrap(a, W):
        line(l)
    line()

heading("7.0", "Credits and legal")
para("This guide and the game it describes are fictional, written as test material for a guide reader "
     "app. You may copy, change and share it freely; it is dedicated to the public domain (CC0).")

text = "\n".join(out).rstrip() + "\n"
dest = Path(__file__).parent / "fixtures" / "ember-crown-guide.txt"
dest.write_text(text)
print(f"wrote {dest} ({len(text)} bytes, {len(out)} lines, {len(sections)} walkthrough sections)")

if "--pdf" in sys.argv:
    pdf_path = sys.argv[sys.argv.index("--pdf") + 1]
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(pdf_path, pagesize=letter)
    pw, ph = letter
    size, lead, left = 8.6, 11.2, 54
    y, page, lines_ = 0, 0, text.split("\n")

    def new_page():
        global y, page
        if page:
            c.showPage()
        page += 1
        c.setFont("Helvetica-Bold", 12)
        c.drawString(left, ph - 40, "GuideSite")
        c.setFont("Helvetica", 9)
        c.drawString(left + 80, ph - 40, "Home   Boards   Guides   Q&A   Log In")
        c.setFont("Helvetica", 7.5)
        c.drawString(left, 24, "https://guides.example.com/ember-crown/walkthrough")
        c.drawRightString(pw - left, 24, f"{page}")
        y = ph - 70
        if page == 1:
            c.setFont("Helvetica-Bold", 16)
            c.drawString(left, y, "The Ember Crown - Guide and Walkthrough")
            c.setFont("Helvetica", 9)
            c.drawString(left, y - 16, "Version: 1.3 | Updated: 03/02/2011")
            y -= 44

    new_page()
    for l in lines_:
        if y < 48:
            new_page()
        if l.strip():
            c.setFont("Courier", size)
            c.drawString(left, y, l)
        y -= lead
    c.save()
    print(f"wrote {pdf_path} ({page} pages)")
