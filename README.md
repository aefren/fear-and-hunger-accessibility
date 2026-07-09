# Fear & Hunger — Screen Reader Accessibility Mod

![Version](https://img.shields.io/github/v/tag/aefren/fear-and-hunger-accessibility?label=version)
![License](https://img.shields.io/github/license/aefren/fear-and-hunger-accessibility)

A work-in-progress mod that adds screen reader support (NVDA, JAWS, VoiceOver) to
**Fear & Hunger 1**, making the game playable without sight and without any external
TTS bridge.

## Status

In active development. The mod already covers the title and character-select screens,
in-game menus, dialogue and choices, and combat text. On the map it adds keyboard-driven
navigation aids: an interactable-elements menu, wall-bump audio feedback, a manual trap
scan, and always-on spatial "sonar" pings for doors, enemies, containers, corpses,
altars, readable notes, fire and light sources, and caged captives. See
[PLAN.md](PLAN.md) for the full roadmap and progress checklist.

## How it works

Fear & Hunger runs on RPG Maker MV (NW.js / Chromium), so the game has a real DOM. The
mod injects a hidden `aria-live` region into that DOM and pushes game text into it. Any
screen reader that listens to live regions (NVDA, JAWS, VoiceOver) picks it up
automatically — no Tolk, SAPI, or external TTS is needed. Map navigation aids use
positional stereo audio (pan for horizontal offset, pitch for vertical) so points of
interest can be located by ear.

## Controls

You play with the **same keys as the vanilla game** — arrow keys to move,
**Z / Enter / Space** to confirm, and **X / Esc** to cancel. The mod adds only a few
new keys:

- **A / S** — step through the interactable elements near you (doors, containers,
  corpses, NPCs, notes…). Each press announces the element and its position and starts
  an audio beacon that guides you to it.
- **I** — open the full list of nearby interactables as a menu, instead of stepping
  through them one by one. Pick an entry with **Z / Enter / Space** to start its beacon;
  press **I** again (or cancel) to stop tracking.
- **R** — scan for floor traps around you and announce any within range.
- **P** — pause and resume the game while exploring the map.
- **Tab / Shift+Tab** — read on-screen stat panels that never take keyboard focus. In
  the **equipment**, **status** and **skill** menus, **Tab** announces the selected
  character's attributes. In **battle**, **Tab** reads the whole party's HP/MP and
  status effects, and **Shift+Tab** reads every living enemy's HP and status effects.

**Iterating (A / S).** Nearby interactables are sorted by distance, closest first. The
list refreshes every time you take a step: right after moving, **A** selects the closest
element and **S** the next one out; while standing still, **A / S** walk back and forth
through the list. Elements out of range or hidden behind a wall are skipped.

**Positional sound.** Both the A/S beacon and the always-on sonars place each sound in
space so you can locate its source by ear: **pan** (left/right) gives the horizontal
offset, **pitch** gives the vertical offset (higher = above you, lower = below), and
**volume plus repeat speed** give the distance (closer = louder and faster).

**Light matters.** Fear & Hunger's darkness is real — a sighted player only sees what
the current light reaches — and the always-on sonars honour the same rule. Beyond a
couple of "hearing" tiles, something only pings while it is lit: by your own light
(a fresh torch reaches about 6 tiles, bare hands about 5, and in the Terror &
Starvation mode's darkness nothing at all) or by a burning map light (a lit candle, a
wall torch, a guard patrolling with his own torch — whose glow gives him away to the
sonar just as it does to the eye). Lighting a torch widens every sonar and losing your
light shrinks them to arm's length, so fire is as important by ear as it is by sight.
The same rule applies to the **A / S** quick-select, which is your glance at what is
right around you: in the dark it only reaches lit elements. Each sonar (and A/S) has a
`Hearing Range` parameter (default 2 tiles) that sets what you can still hear in total
darkness. The manual trap scan (**R**) and the full interactables menu (**I**) are
deliberate survey tools and keep their full range regardless of light.

**Pause (P).** Fear & Hunger 1 has no pause — this is an extra feature of the
accessibility mod. A sighted player takes in the whole screen at a glance; a blind
player needs time to sweep the surroundings with the sonars and the interactables menu
before deciding where to go. Pressing **P** on the map freezes enemies and the random-
encounter counter while leaving the screen reader and the interactables menu fully
usable, so you can survey at your own pace; press **P** again to resume. It is ignored
during cutscenes and dialogue so it can never interrupt them.

**Reading stats (Tab / Shift+Tab).** A few panels in Fear & Hunger are painted on the
screen but never receive keyboard focus, so a screen reader can't reach them by arrowing
around — Tab reads them aloud on demand. In the equipment menu (and the status and skill
screens) it announces the selected character's six combat attributes — Attack, Defense,
M.Attack, M.Defense, Agility and Luck; move between characters with **Page Up / Page
Down** and press **Tab** again to hear the next one. In battle, where neither the party's
status bar nor the enemy sprites have a focusable panel, **Tab** speaks the party's
current HP/MP and states and **Shift+Tab** speaks each surviving enemy's HP and states —
useful for checking who is wounded before you choose an action. Outside battle, Shift+Tab
simply repeats Tab.

## Plugins

Core:

- **ScreenReaderAccess** — surfaces all game text (menus, dialogue, choices, battle) to
  the screen reader via the hidden `aria-live` region.

Map navigation:

- **WallBump** — audio feedback when you walk into a wall.
- **InteractableElementsMenu** — hotkey menu of nearby interactable map elements, with
  quick previous/next selection and a positional tracking beacon.
- **DoorSonar** — spatial sonar for doors.
- **EnemySonar** — spatial sonar for on-map enemies.
- **ContainerSonar** — spatial sonar for searchable containers.
- **CorpseSonar** — spatial sonar for corpses.
- **AltarSonar** — spatial sonar for altars and ritual circles.
- **NoteSonar** — spatial sonar for readable notes, diaries, and documents.
- **FireSonar** — spatial sonar for fire and light sources (a lit furnace and
  candles, beacons, bonfires and torches you can light with a Tinderbox).
- **CageSonar** — spatial sonar for cages holding a captive (the little girl in a cage);
  goes silent once she is freed.
- **SacrificeSonar** — spatial sonar for the sacrificial circles for the older gods (the
  big red circle with the instructions stand where Gro-goroth and Sylvian take
  offerings); quiet ping capped at 30% volume.
- **ItemSonar** — spatial sonar for loose loot on the ground (herbs, dried mushrooms and
  shining coins/soul stones you pick up); goes silent once collected.
- **SecretSonar** — spatial sonar for hidden diggable/breakable spots (soft walls, soft
  ground and loose rocks); goes silent once opened.
- **TrapWarning** — manual proximity scan (default key: **R**) that detects floor traps.

## Installation

### Easy install (Windows, recommended)

1. Go to the [latest release](https://github.com/aefren/fear-and-hunger-accessibility/releases/latest)
   and download **`FearAndHungerAccessibility-vX.X.X.zip`** from the Assets list, then
   unzip it anywhere, keeping the files together.
2. Double-click **`install.bat`**. Windows will show an "Open File - Security Warning"
   dialog because the script is unsigned and was downloaded from the internet — this is
   expected for any unsigned `.bat`/`.exe`, click **Run**. It will then ask for
   administrator permission, which is needed to write into the game folder — accept that
   too.
3. The installer finds your Steam copy of Fear & Hunger automatically, copies the
   plugins, and registers them (keeping a backup of your `plugins.js`). If it can't find
   the game, it asks you to paste the game folder path.
4. Launch the game with your screen reader running.

To remove the mod, double-click **`uninstall.bat`**; it restores the game exactly as it
was before. On macOS or Linux, use the manual method below.

### Manual install (advanced)

1. Copy all `.js` files from the `plugins/` folder into your game's `www/js/plugins/`
   directory.
2. Open `www/js/plugins.js` and add the following entries **at the very end** of the
   `$plugins` array, just before the closing `]`. They must load **after** every other
   plugin (in particular after `YEP_MessageCore` and `Olivia_OctoBattle`), because the
   mod works by wrapping the final version of the game's window methods.

   ```js
   {"name":"ScreenReaderAccess","status":true,"description":"Core screen reader support","parameters":{}},
   {"name":"WallBump","status":true,"description":"Audio feedback on wall collision","parameters":{}},
   {"name":"InteractableElementsMenu","status":true,"description":"Hotkey menu of interactable map elements","parameters":{}},
   {"name":"DoorSonar","status":true,"description":"Spatial sonar for doors","parameters":{}},
   {"name":"EnemySonar","status":true,"description":"Spatial sonar for on-map enemies","parameters":{}},
   {"name":"ContainerSonar","status":true,"description":"Spatial sonar for searchable containers","parameters":{}},
   {"name":"CorpseSonar","status":true,"description":"Spatial sonar for corpses","parameters":{}},
   {"name":"AltarSonar","status":true,"description":"Spatial sonar for altars and ritual circles","parameters":{}},
   {"name":"NoteSonar","status":true,"description":"Spatial sonar for readable notes and documents","parameters":{}},
   {"name":"FireSonar","status":true,"description":"Spatial sonar for fire and light sources","parameters":{}},
   {"name":"CageSonar","status":true,"description":"Spatial sonar for cages holding a captive","parameters":{}},
   {"name":"SacrificeSonar","status":true,"description":"Spatial sonar for the sacrificial circles for the older gods","parameters":{}},
   {"name":"ItemSonar","status":true,"description":"Spatial sonar for loose floor loot","parameters":{}},
   {"name":"SecretSonar","status":true,"description":"Spatial sonar for hidden diggable/breakable spots","parameters":{}},
   {"name":"TrapWarning","status":true,"description":"Manual proximity scan for floor traps","parameters":{}}
   ```

3. Launch the game with your screen reader active.

### Updating

To move to a newer version, download the new release and run **`install.bat`** again —
there is no need to uninstall first. It overwrites the plugin files with the new
versions and registers any plugins added since your last install, while leaving the
original `plugins.js` backup from your first install untouched, so a later
**`uninstall.bat`** still restores the vanilla game. (Updating by hand works the same
way: re-copy the `.js` files from `plugins/` and add any new `$plugins` entries that the
release notes mention.)

## Installing language mods (translations)

Translation mods (e.g. the [Spanish translation](https://www.nexusmods.com/fearandhunger/mods/168))
are safe to combine with this accessibility mod. They replace files under `www/data`
(and sometimes `www/img`/`www/audio`), not game logic, so the screen reader ends up
reading the game in the translated language.

Most sonars detect their targets by the on-screen text an event shows (e.g. a
container is whatever says "You search the crate..."), so a translation changes
exactly the text they look for. The detection regexes are **bilingual
English/Spanish**: every pattern was verified 1:1 against the community Spanish
translation — each of the ~5,400 event pages the English patterns detect in the
original data is detected in the translated data, and none extra. `DoorSonar`,
`EnemySonar` and `WallBump` are text-independent (they key off sprite filenames) and
work under any language. Supporting another language means extending those regexes
the same way; open an issue with the translation you use.

The character-select screen's spoken class descriptions ("Mercenary...",
"Knight...", etc.) are baked into images with no accessible text, so the mod
narrates them from a built-in transcription. That transcription is bilingual too and
picks English or Spanish automatically from the installed game data — no extra step.
Detection keys off the game's own `System.json`, not your operating-system language,
so an English Windows running the Spanish patch still gets the Spanish descriptions.

The one folder that **must not** be copied from a translation package is `www/js`. Some
translation tools (e.g. Translator++) regenerate `plugins.js` as part of their export,
and copying it over your game's `www/js/plugins.js` will silently wipe out this mod's
plugin registration — the game will still run, just without accessibility.

To install a translation like the Spanish one alongside this mod:

1. Install this accessibility mod first (see [Installation](#installation) above).
2. Extract the translation package and copy over everything **except its `www/js`
   folder** — typically just `data`, `img`, and `audio` — into your game's `www/`
   directory, replacing files when prompted.
3. If you already copied the `js` folder by mistake (or the package only ships as one
   combined `www` folder and you copied all of it), just run **`install.bat`** again — it
   re-copies the plugin files and re-registers them in `plugins.js`, undoing the damage.

## Compatibility

Built and tested against **Fear & Hunger 1** on RPG Maker MV (NW.js / Chromium ≥ 65).
The mod hooks Yanfly (`YEP_*`) and `Olivia_OctoBattle` methods where present and is a
no-op when those plugins are absent.

## Disclaimer

This is an unofficial, fan-made accessibility mod. It is **not affiliated with or
endorsed by** Miro Haverinen or Happy Paintings. You must own a legitimate copy of
Fear & Hunger to use it; no game assets are included in this repository.

## Credits

- **ScreenReaderAccess**, **WallBump**, and **InteractableElementsMenu** are adapted from
  [rpgmaker-mv-access](https://github.com/craigbrett17/rpgmaker-mv-access) by Craig Brett,
  licensed under the MIT License.
- All other plugins (the spatial sonars and TrapWarning) are original work for this mod.

## License

Released under the [MIT License](LICENSE). Bundled portions from rpgmaker-mv-access
remain under their original MIT License, Copyright (c) Craig Brett.
