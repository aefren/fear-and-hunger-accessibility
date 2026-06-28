/*:
 * @plugindesc Always-on spatial "sonar" for on-map enemies: each living enemy
 * event emits a positional ping (pan = horizontal offset, pitch = vertical
 * offset, volume = distance). Pings once a second, or twice a second within
 * a few tiles. No key to toggle — it is always active.
 * Author: project_accessibility
 *
 * @param Enemy Sound
 * @desc SE played as the per-enemy sonar ping (file in audio/se, no extension).
 * @type text
 * @default Cursor2
 *
 * @param Far Interval
 * @desc Frames between pings for a distant enemy. 60 frames = 1 second.
 * @type number
 * @default 60
 *
 * @param Near Interval
 * @desc Frames between pings for a near enemy (<= Near Threshold). 30 = half a second.
 * @type number
 * @default 30
 *
 * @param Near Threshold
 * @desc Manhattan distance (in tiles) at or below which the faster Near Interval
 * is used.
 * @type number
 * @default 5
 *
 * @param Max Range
 * @desc Only ping enemies within this many tiles (Manhattan). 0 = no limit
 * (ping every living enemy on the map).
 * @type number
 * @default 10
 *
 * @param Line Of Sight
 * @desc If true, do not ping enemies hidden behind a wall (a wall tile sits on
 * the straight line between you and them).
 * @type boolean
 * @default true
 *
 * @help
 * Fear & Hunger's roaming enemies are map events that start combat on contact.
 * A sighted player sees them move and can dodge, flee or line up an ambush; a
 * blind player got nothing — they fell through as generic "interactables" with
 * no threat cue. This plugin gives them a continuous audio presence.
 *
 * It is ALWAYS ON (no toggle key). Every frame on the map it scans for enemies
 * and, on each one's own timer, plays a spatial ping:
 *   - Pan    = horizontal offset. Far to the right pans hard right; one tile
 *              to the side is almost centred (dx / 10 tiles -> full pan).
 *   - Pitch  = vertical offset. High above raises the pitch, far below lowers
 *              it, barely above is only slightly higher (dy / 10 tiles -> full).
 *   - Volume = distance. The closer the enemy, the louder the ping.
 * Cadence is per enemy: once a second normally, twice a second once the enemy
 * is within Near Threshold tiles, so an approaching threat speeds up.
 *
 * Detection (runtime, no hard-coded coordinates): an enemy is any event whose
 * ACTIVE page starts a battle ON CONTACT -- it contains a "Battle Processing"
 * command (event code 301) AND its trigger is player-touch (1) or event-touch
 * (2). That is exactly what a roaming enemy is: you walk into it and the fight
 * begins.
 *
 * Battle pages with any OTHER trigger are intentionally NOT treated as enemies,
 * because pinging them was a false positive (a thing that "is not an enemy"):
 *   - Action button (trigger 0): doors that ambush when opened ($celldoor,
 *     $door5_1, events literally named "door1"/"2doors"), talk-to bosses and
 *     NPCs ($hydra, $sergregor, $people4) and invisible Transfer+Battle
 *     passages. You start these by facing them and pressing a button -- you
 *     cannot bump into them, so they are not roaming threats.
 *   - Autorun (3) / Parallel (4): scripted, forced battles -- boss cutscenes
 *     (Le'garde, isaiyah, domination1) and invisible trap triggers
 *     (arrow_check). They fire on their own; there is nothing to dodge.
 * A defeated enemy flips a self-switch to a page without a contact battle, so it
 * stops pinging automatically. Events with no active page (erased) or at (0,0)
 * are ignored.
 *
 * It reads positions straight from the engine, so it works regardless of how
 * dark the room is. It never speaks and never alters movement — it is pure
 * spatial sound, the audio counterpart of seeing enemies on screen.
 *
 * Two filters keep it from leaking enemies you could not actually perceive:
 *   - Max Range: enemies beyond this Manhattan distance are silent.
 *   - Line Of Sight: an enemy is silent if a solid wall tile sits on the
 *     straight line between you and it, so enemies in adjacent rooms behind a
 *     wall do not ping. Wall tiles are read from the map's passage flags
 *     (impassable in every direction), so this is exact and lighting-agnostic.
 *
 * Load order: place this after ScreenReaderAccess.js (kept with the other
 * accessibility plugins at the end of plugins.js).
 */

(function () {
    var parameters = PluginManager.parameters('EnemySonar');
    var enemySound = parameters['Enemy Sound'] || 'Cursor2';
    var farInterval = parseInt(parameters['Far Interval']) || 60;
    var nearInterval = parseInt(parameters['Near Interval']) || 30;
    var nearThreshold = parseInt(parameters['Near Threshold']) || 5;
    // 0 means unlimited, so respect an explicit 0 instead of falling back.
    var maxRangeParam = parameters['Max Range'];
    var maxRange = (maxRangeParam === undefined || maxRangeParam === '') ? 10 : parseInt(maxRangeParam);
    if (isNaN(maxRange)) maxRange = 10;
    var lineOfSight = parameters['Line Of Sight'] !== 'false'; // default on

    // Per-enemy ping timers, keyed by event id: frames elapsed since the last
    // ping for that enemy. Rebuilt every frame so dead/absent enemies drop out,
    // and cleared on a map change so ids are never carried across maps.
    var pingTimers = {};
    var timersMapId = 0;

    // An enemy is an event whose ACTIVE page fires a battle ON CONTACT. Code
    // 301 = "Battle Processing"; trigger 1 = player-touch, 2 = event-touch. That
    // pairing is precisely a roaming enemy: you bump into it and the fight
    // starts.
    //
    // Battle pages with any other trigger are NOT enemies, and skipping them
    // removes the false positives:
    //   - Action button (trigger 0): doors that ambush when opened ($celldoor,
    //     events named "door1"), talk-to bosses/NPCs ($hydra, $people4) and
    //     invisible Transfer+Battle passages -- engaged on purpose, not bumped.
    //   - Autorun (3) / Parallel (4): forced scripted battles -- boss cutscenes
    //     (Le'garde) and invisible trap triggers (arrow_check) -- nothing to
    //     dodge.
    // A defeated enemy switches to a page without a contact battle, so it stops
    // being an enemy on its own. Guard erased pages and (0,0) events.
    function isEnemyEvent(event) {
        if (event._pageIndex < 0) return false;
        if (event.x <= 0 || event.y <= 0) return false;
        var page;
        try {
            page = (typeof event.page === 'function') ? event.page() : null;
        } catch (e) {
            return false;
        }
        if (!page || !page.list) return false;
        // Roaming = combat on contact: player-touch (1) or event-touch (2) only.
        if (page.trigger !== 1 && page.trigger !== 2) return false;
        for (var i = 0; i < page.list.length; i++) {
            if (page.list[i].code === 301) return true;
        }
        return false;
    }

    function enemyEvents() {
        return $gameMap.events().filter(isEnemyEvent);
    }

    // A solid wall for line-of-sight purposes: a tile impassable from every
    // direction. 0x0f = all four passage bits; checkPassage returns false when
    // the tile blocks them all (a wall), true for open floor.
    function isWallTile(x, y) {
        return !$gameMap.checkPassage(x, y, 0x0f);
    }

    // True unless a wall tile sits strictly between player and enemy. Walks the
    // straight line (Bresenham) and checks every intermediate tile, skipping the
    // two endpoints (the player's own tile and the enemy's own tile).
    function hasLineOfSight(x0, y0, x1, y1) {
        var dx = Math.abs(x1 - x0);
        var dy = Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1;
        var sy = y0 < y1 ? 1 : -1;
        var err = dx - dy;
        var x = x0, y = y0;
        while (true) {
            var e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
            if (x === x1 && y === y1) break;   // reached the enemy: clear path
            if (isWallTile(x, y)) return false; // a wall blocks the view
        }
        return true;
    }

    // Spatial ping for one enemy: pan from horizontal offset, pitch from
    // vertical offset, volume from distance. Mirrors the beacon's encoding.
    function ping(dx, dy, dist) {
        // Pan: full left/right at ~10 tiles of horizontal offset; ~10 per tile
        // close in, so one step to the side is nearly centred.
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * 100)));
        // Pitch: above raises, below lowers (+/- 50 over ~10 tiles).
        var pitchOffset = Math.max(-50, Math.min(50, Math.round(-dy / 10 * 50)));
        var pitch = 100 + pitchOffset;
        // Volume: louder near (90) fading to quiet far (30) by ~30 tiles.
        var d = Math.min(dist, 30);
        var volume = Math.round(90 - (d / 30) * 60);
        if (volume < 30) volume = 30;

        AudioManager.playSe({ name: enemySound, volume: volume, pitch: pitch, pan: pan });
    }

    function updateSonar() {
        if ($gameMap.mapId() !== timersMapId) {
            timersMapId = $gameMap.mapId();
            pingTimers = {};
        }

        var px = $gamePlayer.x;
        var py = $gamePlayer.y;
        var enemies = enemyEvents();
        var seen = {};

        for (var i = 0; i < enemies.length; i++) {
            var ev = enemies[i];
            var id = ev._eventId;
            seen[id] = true;

            var dx = ev.x - px; // + = enemy to the right
            var dy = ev.y - py; // + = enemy below (south)
            var dist = Math.abs(dx) + Math.abs(dy);

            // Out of range or hidden behind a wall: stay silent, and drop the
            // timer so it pings at once when it next comes into view/range
            // rather than mid-interval.
            if (maxRange > 0 && dist > maxRange) {
                delete pingTimers[id];
                continue;
            }
            if (lineOfSight && !hasLineOfSight(px, py, ev.x, ev.y)) {
                delete pingTimers[id];
                continue;
            }

            var interval = (dist <= nearThreshold) ? nearInterval : farInterval;

            // New enemies ping immediately; existing ones ping on their interval.
            var t = (pingTimers[id] === undefined) ? interval : pingTimers[id] + 1;
            if (t >= interval) {
                ping(dx, dy, dist);
                t = 0;
            }
            pingTimers[id] = t;
        }

        // Drop timers for enemies that died, left range, or no longer exist so
        // they ping immediately again next time they reappear.
        for (var key in pingTimers) {
            if (!seen[key]) delete pingTimers[key];
        }
    }

    var _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);
        if ($gameMap.isEventRunning()) return;
        if ($gameMessage && $gameMessage.isBusy()) return;
        updateSonar();
    };
})();
