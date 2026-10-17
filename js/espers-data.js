// Espers (magicite) in the Pixel Remaster, in the order the game gives them to you.
//
// Source: Final Fantasy Wiki, "Magicite (Final Fantasy VI)",
// https://finalfantasy.fandom.com/wiki/Magicite_(Final_Fantasy_VI) (CC BY-SA 3.0; this adapted
// data is too). Level-up bonuses use the Pixel Remaster values where they differ (Quetzalli,
// Alexander, Odin, Raiden). The four GBA-only espers are left out.
//
// Fields: name, alt (SNES name), spells ([[spell, learn rate]]), bonus ({ stat: str | agi | sta |
// mag | hp | mp, amt, pct } given at each level-up while equipped), summon, found.

export const ESPERS = [
  {"name": "Ramuh", "spells": [["Thunder", 10], ["Thundara", 2], ["Poison", 5]], "bonus": {"stat": "sta", "amt": 1}, "summon": "Judgment Bolt: Bathes all enemies in lightning.", "found": "Zozo - Top of the central building after seeing Terra."},
  {"name": "Kirin", "spells": [["Cure", 4], ["Cura", 1], ["Regen", 3], ["Poisona", 4], ["Libra", 5]], "summon": "Holy Aura: Gradually restores the party's HP.", "found": "Zozo - Top of the central building after seeing Terra."},
  {"name": "Siren", "spells": [["Sleep", 10], ["Silence", 8], ["Slow", 7], ["Fire", 6]], "bonus": {"stat": "hp", "amt": 10, "pct": 1}, "summon": "Lunatic Voice: Silences all enemies.", "found": "Zozo - Top of the central building after seeing Terra."},
  {"name": "Cait Sith", "alt": "Stray", "spells": [["Confuse", 7], ["Imp", 5], ["Float", 2]], "bonus": {"stat": "mag", "amt": 1}, "summon": "Cat Rain: Confuses all enemies.", "found": "Zozo - Top of the central building after seeing Terra."},
  {"name": "Ifrit", "spells": [["Fire", 10], ["Fira", 5], ["Drain", 1]], "bonus": {"stat": "str", "amt": 1}, "summon": "Hellfire: Scorches all enemies in a fiery blaze.", "found": "Magitek Research Facility, after defeating Ifrit and Shiva."},
  {"name": "Shiva", "spells": [["Blizzard", 10], ["Blizzara", 5], ["Rasp", 4], ["Osmose", 4], ["Cure", 3]], "summon": "Diamond Dust: Envelops all enemies in an arctic chill.", "found": "Magitek Research Facility, after defeating Ifrit and Shiva."},
  {"name": "Unicorn", "spells": [["Cura", 4], ["Esuna", 3], ["Dispel", 2], ["Protect", 1], ["Shell", 1]], "summon": "Healing Horn: Cures party of most status ailments.", "found": "Magitek Research Facility, after defeating Number 024."},
  {"name": "Maduin", "spells": [["Fira", 3], ["Thundara", 3], ["Blizzara", 3]], "bonus": {"stat": "mag", "amt": 1}, "summon": "Chaos Wave: Unleashes a tide of anger on enemies.", "found": "Magitek Research Facility, after defeating Number 024."},
  {"name": "Catoblepas", "alt": "Shoat", "spells": [["Bio", 8], ["Break", 5], ["Death", 2]], "bonus": {"stat": "hp", "amt": 10, "pct": 1}, "summon": "Demon Eye: Petrifies all enemies.", "found": "Magitek Research Facility, after defeating Number 024."},
  {"name": "Phantom", "spells": [["Berserk", 3], ["Vanish", 3], ["Gravity", 5]], "bonus": {"stat": "mp", "amt": 10, "pct": 1}, "summon": "Ghostly Veil: Turns all allies invisible.", "found": "Magitek Research Facility, after defeating Number 024."},
  {"name": "Carbuncle", "alt": "Carbunkl", "spells": [["Reflect", 5], ["Haste", 3], ["Shell", 2], ["Protect", 2], ["Teleport", 2]], "summon": "Ruby Light: Casts Reflect on all allies.", "found": "Magitek Research Facility, after defeating Number 024."},
  {"name": "Bismarck", "spells": [["Fire", 20], ["Blizzard", 20], ["Thunder", 20], ["Raise", 2]], "bonus": {"stat": "str", "amt": 2}, "summon": "Breach Blast: Slams all enemies with giant bubbles.", "found": "Magitek Research Facility, after defeating Number 024."},
  {"name": "Golem", "spells": [["Protect", 5], ["Stop", 5], ["Cura", 5]], "bonus": {"stat": "sta", "amt": 2}, "summon": "Earthen Wall: Protects party from physical attacks.", "found": "Auction House in Jidoor, bid 20,000 gil."},
  {"name": "Zona Seeker", "alt": "Zoneseek", "spells": [["Rasp", 20], ["Osmose", 15], ["Shell", 5]], "bonus": {"stat": "mag", "amt": 2}, "summon": "Magic Shield: Increases the party's magic defense.", "found": "Auction House in Jidoor, bid 10,000 gil."},
  {"name": "Seraph", "alt": "Sraphim", "spells": [["Raise", 5], ["Cure", 20], ["Cura", 8], ["Regen", 10], ["Esuna", 4]], "summon": "Angel Feathers: Restores HP to all allies.", "found": "Tzen, buy from thief behind Relic Shop for 3,000 (World of Balance) or 10 (World of Ruin) gil."},
  {"name": "Quetzalli", "alt": "Palidor", "spells": [["Haste", 20], ["Slow", 20], ["Hastega", 2], ["Slowga", 2], ["Float", 5]], "bonus": {"stat": "agi", "amt": 1}, "summon": "Sonic Dive: Lifts the party up for an aerial attack.", "found": "Solitary Island, on the beach after acquiring the Falcon."},
  {"name": "Fenrir", "spells": [["Teleport", 10], ["Banish", 5], ["Stop", 3]], "bonus": {"stat": "mp", "amt": 30, "pct": 1}, "summon": "Howling Moon: Creates illusionary images of the party.", "found": "Mobliz, received from orphan boy after defeating Humbaba."},
  {"name": "Valigarmanda", "alt": "Tritoch", "spells": [["Firaga", 1], ["Blizzaga", 1], ["Thundaga", 1]], "bonus": {"stat": "mag", "amt": 2}, "summon": "Tri-Disaster: Hits enemies with fire, ice and lightning.", "found": "Narshe Cliffs, defeat Valigarmanda."},
  {"name": "Midgardsormr", "alt": "Terrato", "spells": [["Quake", 3], ["Graviga", 1], ["Tornado", 1]], "bonus": {"stat": "hp", "amt": 30, "pct": 1}, "summon": "Abyssal Maw: Crushes enemies with seismic waves.", "found": "Yeti's Cave, inside the eye of the bone carving before fighting Yeti."},
  {"name": "Lakshmi", "alt": "Starlet", "spells": [["Cure", 25], ["Cura", 16], ["Curaga", 1], ["Regen", 20], ["Esuna", 20]], "bonus": {"stat": "sta", "amt": 2}, "summon": "Alluring Embrace: Restores HP to all allies.", "found": "Owzer's Mansion after defeating Chadarnook."},
  {"name": "Alexander", "spells": [["Holy", 2], ["Shell", 10], ["Protect", 10], ["Dispel", 10], ["Esuna", 15]], "bonus": {"stat": "str", "amt": 2}, "summon": "Divine Judgment: Sears enemies with a beam of holy light.", "found": "Doma Castle, in the throne room after defeating Wrexsoul and escaping Dreamscape."},
  {"name": "Phoenix", "spells": [["Raise", 10], ["Arise", 2], ["Reraise", 1], ["Curaga", 2], ["Firaga", 3]], "summon": "Flames of Rebirth: Revives all KO'd allies.", "found": "Kohlingen, automatically received after completing Phoenix Cave."},
  {"name": "Odin", "spells": [["Meteor", 1]], "bonus": {"stat": "agi", "amt": 2}, "summon": "Zantetsuken: Cleaves all enemies in two.", "found": "Ancient Castle, touch the petrified Odin in the throne room."},
  {"name": "Bahamut", "spells": [["Flare", 2]], "bonus": {"stat": "hp", "amt": 50, "pct": 1}, "summon": "Mega Flare: Hits all enemies with a nuclear blast.", "found": "Defeat Deathgaze flying across the overworld's sky."},
  {"name": "Ragnarok", "spells": [["Ultima", 1]], "summon": "Metamorphose: Turns one enemy into an item.", "found": "Narshe, inside weapons shop (Locke required in party)."},
  {"name": "Crusader", "spells": [["Meltdown", 1], ["Meteor", 10]], "bonus": {"stat": "mp", "amt": 50, "pct": 1}, "summon": "Cleansing: Greatly damages all enemies and allies.", "found": "Defeat the eight legendary dragons, received automatically when the eighth is defeated."},
  {"name": "Raiden", "spells": [["Quick", 1]], "bonus": {"stat": "agi", "amt": 2}, "summon": "Shin-Zantetsuken: Cleaves all enemies in two.", "found": "Ancient Castle, touch the petrified Queen while in possession of Odin's magicite."},
];

// Every spell espers teach, grouped as the game's Magic menu groups them.
export const SPELL_GROUPS = [
  ["Attack", ["Fire", "Blizzard", "Thunder", "Poison", "Drain", "Fira", "Blizzara", "Thundara", "Bio", "Firaga", "Blizzaga", "Thundaga", "Break", "Death", "Holy", "Flare", "Gravity", "Graviga", "Banish", "Meteor", "Ultima", "Quake", "Tornado", "Meltdown"]],
  ["Healing", ["Cure", "Cura", "Curaga", "Raise", "Arise", "Poisona", "Esuna", "Regen", "Reraise"]],
  ["Support", ["Libra", "Slow", "Rasp", "Silence", "Protect", "Sleep", "Confuse", "Haste", "Stop", "Berserk", "Float", "Imp", "Reflect", "Shell", "Vanish", "Hastega", "Slowga", "Osmose", "Teleport", "Quick", "Dispel"]],
];
