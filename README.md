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
altars, and readable notes. See [PLAN.md](PLAN.md) for the full roadmap and progress
checklist.

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

**Iterating (A / S).** Nearby interactables are sorted by distance, closest first. The
list refreshes every time you take a step: right after moving, **A** selects the closest
element and **S** the next one out; while standing still, **A / S** walk back and forth
through the list. Elements out of range or hidden behind a wall are skipped.

**Positional sound.** Both the A/S beacon and the always-on sonars place each sound in
space so you can locate its source by ear: **pan** (left/right) gives the horizontal
offset, **pitch** gives the vertical offset (higher = above you, lower = below), and
**volume plus repeat speed** give the distance (closer = louder and faster).

**Pause (P).** Fear & Hunger 1 has no pause — this is an extra feature of the
accessibility mod. A sighted player takes in the whole screen at a glance; a blind
player needs time to sweep the surroundings with the sonars and the interactables menu
before deciding where to go. Pressing **P** on the map freezes enemies and the random-
encounter counter while leaving the screen reader and the interactables menu fully
usable, so you can survey at your own pace; press **P** again to resume. It is ignored
during cutscenes and dialogue so it can never interrupt them.

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
   {"name":"TrapWarning","status":true,"description":"Manual proximity scan for floor traps","parameters":{}}
   ```

3. Launch the game with your screen reader active.

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
