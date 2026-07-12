# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A screen-reader accessibility mod for **Fear & Hunger 1** (an RPG Maker MV game running
on NW.js / Chromium). It is a set of RPG Maker MV plugins — plain browser JavaScript, no
build step, no package manager. The game is not in this repo (it's gitignored); you edit
the `.js` files in `plugins/` and copy them into a game install to test.

See `README.md` for the player-facing feature list and controls, and `PLAN.md` for the
roadmap and progress checklist.

## Language convention

- **All commit messages and GitHub releases (tag names, titles, and bodies) must be in English**, even when the conversation is in Spanish. The repository's public record stays English.
- Chat replies follow the user's language.
- The mod is bilingual (English + community Spanish translation); user-facing in-game text and `README.md` stay bilingual as already established.

## Dev workflow

There is no compile/lint/test tooling. The "test" loop is: edit a plugin, install it into
a local game copy, launch the game with a screen reader, and listen.

- Keep a game copy in a `Fear & Hunger/` folder next to the repo (gitignored). Then:
  - `dev_install.bat` → copies `plugins/*.js` into that local copy's `www/js/plugins/` and registers them in `plugins.js` (keeping a `.a11y-bak` backup).
  - `dev_uninstall.bat` → restores the backup.
- `install.bat` / `uninstall.bat` are the **end-user** installers: they auto-locate the Steam install of the game via the registry + `libraryfolders.vdf` (see `installer/_lib.ps1`).
- All installer logic lives in `installer/*.ps1` (Windows PowerShell 5.1 — no `pwsh` required). The `.bat` files are thin launchers. Shared functions are in `installer/_lib.ps1`.
- `test/` holds unzipped copies of prior releases for regression comparison — not an automated test suite.

**Plugin load order matters.** These plugins wrap the *final* versions of the game's
window methods, so they must load **last** — after every other plugin, especially
`YEP_MessageCore` and `Olivia_OctoBattle`. `ScreenReaderAccess` must load **first among
the mod's own plugins** because the others rely on globals it establishes; the installer
enforces this ordering (`Get-ModPluginNames` in `_lib.ps1`).

## Architecture

### Core: `ScreenReaderAccess.js`

The foundation. Fear & Hunger has a real DOM (Chromium), so instead of an external TTS
bridge (Tolk/SAPI), this plugin injects hidden `aria-live` regions (`#sr-announce`
polite, `#sr-announce-assertive`) into the page and pushes game text into them. Any screen
reader listening to live regions (NVDA/JAWS/VoiceOver) reads it. It hooks RPG Maker /
Yanfly window methods (menus, dialogue, choices, battle text) to route their text through
a sanitize + announce path.

It exposes `window.ScreenReaderAccess.announce(message, interrupt)` as the shared speech
API that sibling plugins (e.g. `TrapWarning`) call instead of touching the DOM directly.

### Map navigation plugins

- `WallBump.js` — audio cue on walking into a wall (keys off collision, text-independent).
- `InteractableElementsMenu.js` — the **A/S** step-through and **I** menu of nearby interactables, with a positional tracking beacon.
- `TrapWarning.js` — the manual **R** trap scan.
- `SonarTutorialMenu.js` — the **Shift+S** sound-legend menu.
- The **Sonar family**: `DoorSonar`, `EnemySonar`, `ContainerSonar`, `CorpseSonar`, `AltarSonar`, `NoteSonar`, `FireSonar`, `CageSonar`, `SacrificeSonar`, `ItemSonar`, `SecretSonar`. Each is an always-on spatial ping for one category of map object.

### Two shared patterns you must know before editing a sonar

The sonars are near-copies of one another (~450–560 lines each) with no shared module —
each file re-declares the common blocks. Two of these blocks are load-order-shared
singletons and their canonical copy is duplicated verbatim across files:

1. **`window.AccessibilityLight`** — the light-perception model. Fear & Hunger's darkness
   is real: TerraxLighting multiplies the screen with a black mask, so a sighted player
   only perceives lit tiles. `isLit(x, y)` answers "could a sighted player see that tile
   now?" — true inside the player's own light globe (radius mirrored into
   `$gameVariables._Terrax_Lighting_Radius`, 48 px = 1 tile) or inside any *burning* map
   light's globe (events whose note reads `Light 250 #FFFFFF` / `Fire 450 ...`, respecting
   Terrax on/off and kill-switch state, using live event positions so a patrolling
   torch-bearer's glow moves with him). Every sonar honours this: beyond the small
   `Hearing Range` (default 2 tiles), a target only pings while lit. The **first plugin to
   load defines it; the rest reuse it** (`if (!window.AccessibilityLight) window.AccessibilityLight = ...`). If you change this block, change it in every file that carries it.

2. **Positional audio**: pan = horizontal offset (dx over ~10 tiles → full pan), pitch =
   vertical offset (higher = above), volume + repeat speed = distance. Pings queue with a
   `Min Gap` so they never overlap; `Near`/`Far Interval` set cadence.

**Text-driven detection.** Most sonars identify their target by the on-screen text an
event *would* show (e.g. a container is any event whose message matches "You search the…").
Detection is done with **bilingual English/Spanish regexes** (see e.g. `SEARCH_RE` in
`ContainerSonar.js`) verified 1:1 against the community Spanish translation. Exceptions:
`DoorSonar`, `EnemySonar`, and `WallBump` key off sprite filenames and are
language-independent. Adding a language means extending those regexes; detection language
keys off the game's own `System.json`, not the OS locale.

Each sonar exposes RPG Maker plugin parameters (sound file, intervals, `Max Range`,
`Hearing Range`, `Line Of Sight`, pan/pitch strength, `Min Gap`) declared in the `/*: …`
header comment — the standard MV plugin-metadata format.
