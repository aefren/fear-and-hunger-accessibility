/*:
 * @plugindesc Detects floor traps for blind players: a manual proximity scan (R)
 * lists armed traps with direction/distance, and a step-by-step heads-up warns
 * when an armed trap sits on a tile you could walk straight onto. Warn-only:
 * never blocks movement.
 * Author: project_accessibility
 *
 * @param Trigger Key
 * @desc Keycode that runs the trap proximity scan. Default 82 = R.
 * (T is bound in-game to lighting a torch, so this scan uses R.)
 * @type text
 * @default 82
 *
 * @param Max Scan
 * @desc Radius (in tiles, Manhattan) the manual scan reports armed traps within.
 * @type number
 * @default 8
 *
 * @param Max Reported
 * @desc Cap on how many traps the manual scan reads out (closest first).
 * @type number
 * @default 5
 *
 * @param Danger Sound
 * @desc SE played alongside the spoken warning (file in audio/se, no extension).
 * Leave blank for speech only.
 * @type text
 * @default bear_trap_hepriest909
 *
 * @help
 * Fear & Hunger lays its floor traps out as map events that the existing
 * accessibility tools cannot see:
 *   - bearTrap*  -> visible "$beartrap" sprite, Parallel-process trigger
 *   - gas_trap*  -> NO sprite at all (invisible even to sighted players),
 *                   Player-Touch trigger
 * Both are priority 0 ("below characters"), so isInteractable() rejects them and
 * they never reach the InteractableElementsMenu or the A/S quick-select beacon.
 * Because the trap tile is passable (through:true), WallBump treats it as open
 * floor. The result is that a blind player gets no signal at all before stepping
 * on one. This plugin closes that gap.
 *
 * Detection (runtime, no hard-coded coordinates):
 *   - A trap is any event whose data name matches /trap/i (bearTrap, gas_trap...).
 *   - Floor-collapse tiles ("You hear a crack underneath your feet...") carry
 *     default event names (EV089...), so they are recognised by that warning
 *     text on a player-touch page instead. 13 exist across maps 3/31/53/93/181.
 *   - A bear trap that has already snapped flips its self-switch A and shows a
 *     harmless "sprung" page; such events are treated as disarmed and ignored.
 *     Collapsed cracks flip the same self-switch, so they too go silent once
 *     the floor has given way.
 *
 * Two ways traps are surfaced (this plugin never blocks or alters movement):
 *   1. Manual scan: press the trigger key (default R) to hear every armed trap
 *      within Max Scan tiles, closest first, with the same relative phrasing the
 *      InteractableElementsMenu uses, e.g. "Trap, 2 down 1 left. Trap, 3 right."
 *      Says "No traps nearby." when clear.
 *   2. Step heads-up: after each step, if an armed trap now sits on one of the
 *      four tiles you could walk straight onto, it is announced once, e.g.
 *      "Trap north." A short Danger Sound plays with it. Each trap is only
 *      announced when it newly becomes adjacent, so walking a corridor of traps
 *      does not machine-gun the same warning.
 *
 * Load order: place this after ScreenReaderAccess.js (it uses that plugin's
 * window.ScreenReaderAccess.announce API to speak).
 */

(function () {
    var parameters = PluginManager.parameters('TrapWarning');
    var triggerKey = parseInt(parameters['Trigger Key']) || 82;
    var maxScan = parseInt(parameters['Max Scan']) || 8;
    var maxReported = parseInt(parameters['Max Reported']) || 5;
    var dangerSound = parameters['Danger Sound'];
    if (dangerSound === undefined) dangerSound = 'bear_trap_hepriest909';

    // Cardinal neighbours, in RPG Maker numpad direction codes, paired with the
    // label spoken for a trap sitting on that adjacent tile.
    var CARDINALS = [
        { code: 8, label: 'north', dx: 0, dy: -1 },
        { code: 2, label: 'south', dx: 0, dy: 1 },
        { code: 6, label: 'east', dx: 1, dy: 0 },
        { code: 4, label: 'west', dx: -1, dy: 0 }
    ];

    // Event ids of traps that were adjacent after the previous step, so a trap is
    // only re-announced when it freshly becomes adjacent. Reset on map change.
    var lastAdjacentIds = {};
    var lastAdjacentMapId = 0;

    function announce(message) {
        if (window.ScreenReaderAccess && window.ScreenReaderAccess.announce) {
            window.ScreenReaderAccess.announce(message, true);
            return;
        }
        var el = document.getElementById('sr-announce-assertive') || document.getElementById('sr-announce');
        if (el) { el.innerText = message; }
    }

    // F&H's floor-collapse tiles carry no "trap" in their event name (they are
    // default-named EV089 and the like), so the name check misses them; their
    // reliable signal is the warning text on a player-touch page: "You hear a
    // crack underneath your feet...". Kept in sync with the HAZARD_RE that
    // InteractableElementsMenu uses to keep these same tiles out of its list.
    // Escape/colour codes are stripped so a colour-split line still matches.
    // Bilingual: English + community Spanish translation.
    var CRACK_RE = /crack underneath your feet|crujido debajo de tus pies/i;

    function stripCodes(text) {
        return text.replace(/\\[a-z]+\[\d+\]/gi, '').replace(/<[^>]+>/g, ' ');
    }

    function isCrackTrapEvent(event) {
        var data = (typeof event.event === 'function') ? event.event() : null;
        if (!data || !data.pages) return false;
        for (var p = 0; p < data.pages.length; p++) {
            var page = data.pages[p];
            if (!page || !page.list) continue;
            if (page.trigger < 0 || page.trigger > 2) continue;
            for (var i = 0; i < page.list.length; i++) {
                var c = page.list[i];
                if (c.code === 401 && c.parameters && c.parameters[0] && CRACK_RE.test(stripCodes(c.parameters[0]))) {
                    return true;
                }
            }
        }
        return false;
    }

    // Is this event one of F&H's floor traps? The data name is the reliable
    // signal for most (bearTrap1/2/3, gas_trap, gastrap2_left, etc.); the
    // floor-collapse cracks are recognised by their warning text instead. A
    // collapsed crack flips its self-switch A (its "hole" page), so the shared
    // isArmedTrap() check silences it once sprung, same as a snapped bear trap.
    function isTrapEvent(event) {
        var data = (typeof event.event === 'function') ? event.event() : null;
        if (data && data.name && /trap/i.test(data.name)) return true;
        return isCrackTrapEvent(event);
    }

    // An armed (still dangerous) trap. Bear traps that have snapped turn their
    // self-switch A on and switch to a harmless page; ignore those. Gas traps
    // carry no self-switch, so value() is false and they read as armed.
    // A DORMANT event is not a trap at all: F&H gates whole banks of
    // floor-collapse cracks behind a story switch, and until it turns on no
    // page's conditions are met (_pageIndex is -1) -- stepping on the tile
    // does nothing, so warning about it was a false positive.
    function isArmedTrap(event) {
        if (event._pageIndex < 0) return false;
        if (!isTrapEvent(event)) return false;
        var key = [event._mapId, event._eventId, 'A'];
        return !$gameSelfSwitches.value(key);
    }

    function armedTraps() {
        return $gameMap.events().filter(isArmedTrap);
    }

    // Spoken offset, matching InteractableElementsMenu phrasing ("2 down 1 left").
    function offsetText(dx, dy) {
        var parts = [];
        if (dy < 0) parts.push(Math.abs(dy) + ' up');
        if (dy > 0) parts.push(dy + ' down');
        if (dx < 0) parts.push(Math.abs(dx) + ' left');
        if (dx > 0) parts.push(dx + ' right');
        return parts.join(' ');
    }

    // Manual scan: read the nearest armed traps within range, closest first.
    function scanTraps() {
        var px = $gamePlayer.x;
        var py = $gamePlayer.y;
        var traps = armedTraps().map(function (ev) {
            return { ev: ev, dist: Math.abs(ev.x - px) + Math.abs(ev.y - py) };
        }).filter(function (t) {
            return t.dist > 0 && t.dist <= maxScan;
        });

        if (traps.length === 0) {
            announce('No traps nearby.');
            return;
        }

        traps.sort(function (a, b) {
            return (a.dist - b.dist) || (a.ev._eventId - b.ev._eventId);
        });

        var parts = traps.slice(0, maxReported).map(function (t) {
            var text = offsetText(t.ev.x - px, t.ev.y - py);
            return 'Trap, ' + text;
        });
        announce(parts.join('. ') + '.');
    }

    // After a step, warn about armed traps that just became adjacent (on a tile
    // the player could walk straight onto). Only newly-adjacent traps speak.
    function warnAdjacentTraps() {
        if ($gameMap.mapId() !== lastAdjacentMapId) {
            lastAdjacentMapId = $gameMap.mapId();
            lastAdjacentIds = {};
        }

        var px = $gamePlayer.x;
        var py = $gamePlayer.y;
        var currentIds = {};
        var fresh = [];

        for (var i = 0; i < CARDINALS.length; i++) {
            var dir = CARDINALS[i];
            var tx = px + dir.dx;
            var ty = py + dir.dy;
            var events = $gameMap.eventsXy(tx, ty);
            for (var j = 0; j < events.length; j++) {
                if (!isArmedTrap(events[j])) continue;
                var id = events[j]._eventId;
                currentIds[id] = true;
                if (!lastAdjacentIds[id]) fresh.push(dir.label);
            }
        }

        lastAdjacentIds = currentIds;

        if (fresh.length === 0) return;
        announce('Trap ' + fresh.join(', ') + '.');
        if (dangerSound) {
            AudioManager.playStaticSe({ name: dangerSound, volume: 80, pitch: 100, pan: 0 });
        }
    }

    var _Game_Player_increaseSteps = Game_Player.prototype.increaseSteps;
    Game_Player.prototype.increaseSteps = function () {
        _Game_Player_increaseSteps.call(this);
        warnAdjacentTraps();
    };

    document.addEventListener('keydown', function (event) {
        if (event.keyCode !== triggerKey) return;
        if (!(SceneManager._scene instanceof Scene_Map)) return;
        if ($gameMap && $gameMap.isEventRunning()) return;
        event.preventDefault();
        scanTraps();
    });
})();
