# Fear & Hunger — Screen Reader Accessibility Mod

A work-in-progress mod that adds screen reader support (NVDA, JAWS, etc.) to Fear & Hunger 1.

## Status

Early development. Currently covers the title screen menu. See [PLAN.md](PLAN.md) for the full roadmap.

## How it works

Fear & Hunger runs on RPG Maker MV (NW.js / Chromium). The mod injects a hidden `aria-live` region into the DOM. Any screen reader that listens to live regions (NVDA, JAWS, VoiceOver) picks it up automatically — no Tolk or external TTS needed.

## Installation

1. Copy all `.js` files from the `plugins/` folder into your game's `www/js/plugins/` directory.
2. Open `www/js/plugins.js` and add the following entries **at the end** of the `$plugins` array, before the closing `]`:

```js
{"name":"ScreenReaderAccess","status":true,"description":"Screen reader accessibility","parameters":{}},
{"name":"WallBump","status":true,"description":"Audio feedback on wall collision","parameters":{}},
{"name":"InteractableElementsMenu","status":true,"description":"Hotkey menu of interactable map elements","parameters":{}}
```

3. Launch the game with your screen reader active.

## Credits

- [ScreenReaderAccess, WallBump, InteractableElementsMenu](https://github.com/craigbrett17/rpgmaker-mv-access) by Craig Brett — included here for convenience, licensed under MIT.
