/*:
 * @plugindesc Always-on spatial "sonar" for cages holding a captive on the map
 * (the little girl locked in a cage): each cage event emits a positional ping
 * (pan = horizontal offset, pitch = vertical offset, volume = distance). Pings
 * once a second, or twice within a few tiles. No toggle. Sibling of EnemySonar /
 * DoorSonar / ContainerSonar for captives you can free.
 * Author: project_accessibility
 *
 * @param Cage Sound
 * @desc SE played as the per-cage sonar ping (file in audio/se, no extension).
 * @type text
 * @default chainwrapping_01_richardemoore
 *
 * @param Far Interval
 * @desc Frames between pings for a distant cage. 60 frames = 1 second.
 * @type number
 * @default 60
 *
 * @param Near Interval
 * @desc Frames between pings for a near cage (<= Near Threshold). 30 = half a second.
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
 * @desc Only ping cages within this many tiles (Manhattan). 0 = no limit
 * (ping every cage on the map).
 * @type number
 * @default 10
 *
 * @param Line Of Sight
 * @desc If true, do not ping cages hidden behind a wall (a wall tile sits on the
 * straight line between you and them).
 * @type boolean
 * @default true
 *
 * @param Min Gap
 * @desc Minimum frames between ANY two cage pings, so they never overlap. 30 =
 * half a second. When several cages are due at once they queue and sound one
 * at a time, closest first.
 * @type number
 * @default 30
 *
 * @help
 * The little girl locked in a cage is a pivotal interactable in Fear & Hunger: you
 * can pick the lock or use a key to free her and, with room in your party, recruit
 * her. A sighted player sees the cage and the child inside; a blind player got no
 * cue that a tile was a cage with a captive at all. This plugin gives the caged
 * girl a continuous audio presence, the counterpart of EnemySonar (threats),
 * ContainerSonar (loot) and AltarSonar (ritual sites).
 *
 * It is ALWAYS ON (no toggle key). Every frame on the map it scans for cages and,
 * on each one's own timer, plays a spatial ping:
 *   - Pan    = horizontal offset. Far to the right pans hard right; one tile
 *              to the side is almost centred (dx / 10 tiles -> full pan).
 *   - Pitch  = vertical offset. High above raises the pitch, far below lowers
 *              it, barely above is only slightly higher (dy / 10 tiles -> full).
 *   - Volume = distance. The closer the cage, the louder the ping.
 * Cadence is per cage: once a second normally, twice a second once it is within
 * Near Threshold tiles.
 *
 * Detection (runtime, no hard-coded coordinates): a cage is an event whose ACTIVE
 * page is player-activatable (trigger 0 action button) and whose Show Text lines
 * (code 401) contain the captive marker "There seems to be a little girl inside
 * the cage...". A scan of all 170 maps found 28 such pages and nothing else, so
 * the marker never leaks a non-cage. (F&H places four adjacent cage tiles per
 * cage, so a single visible cage is a small cluster of these events -- the Min Gap
 * throttle keeps that cluster from stacking pings.)
 *
 * Because it reads the ACTIVE page, a cage goes SILENT on its own once resolved:
 * after the girl is freed (or the encounter is over) the event flips to a later
 * page that no longer shows the "little girl inside the cage" line, so the sonar
 * stops pinging it automatically -- a blind player hears only the cage that still
 * holds someone to free.
 *
 * It reads positions straight from the engine, so it works regardless of how dark
 * the room is. It never speaks and never alters movement -- pure spatial sound.
 *
 * Two filters keep it from leaking cages you could not actually perceive, matching
 * EnemySonar / DoorSonar / ContainerSonar:
 *   - Max Range: cages beyond this Manhattan distance are silent.
 *   - Line Of Sight: a cage is silent if a solid wall tile sits on the straight
 *     line between you and it. Wall tiles are read from the map's passage flags
 *     (impassable in every direction), so this is exact and lighting-agnostic.
 *
 * Load order: place this after ScreenReaderAccess.js (kept with the other
 * accessibility plugins at the end of plugins.js).
 */

(function () {
    var parameters = PluginManager.parameters('CageSonar');
    var cageSound = parameters['Cage Sound'] || 'chainwrapping_01_richardemoore';
    var farInterval = parseInt(parameters['Far Interval']) || 60;
    var nearInterval = parseInt(parameters['Near Interval']) || 30;
    var nearThreshold = parseInt(parameters['Near Threshold']) || 5;
    // 0 means unlimited, so respect an explicit 0 instead of falling back.
    var maxRangeParam = parameters['Max Range'];
    var maxRange = (maxRangeParam === undefined || maxRangeParam === '') ? 10 : parseInt(maxRangeParam);
    if (isNaN(maxRange)) maxRange = 10;
    var lineOfSight = parameters['Line Of Sight'] !== 'false'; // default on
    var minGap = parseInt(parameters['Min Gap']);
    if (isNaN(minGap)) minGap = 30;

    // Global throttle: frames remaining before any cage may ping again. Ticks down
    // each frame; a ping resets it to minGap so two pings are never closer than
    // half a second and so never overlap -- important here because F&H builds one
    // cage from four adjacent cage-tile events.
    var globalCooldown = 0;

    // Per-cage ping timers, keyed by event id: frames elapsed since the last ping
    // for that cage. Rebuilt every frame so absent cages drop out, and cleared on
    // a map change so ids are never carried across maps.
    var pingTimers = {};
    var timersMapId = 0;

    // The captive marker on a cage's ACTIVE page. The unsolved cage shows "There
    // seems to be a little girl inside the cage..."; once she is freed the event
    // flips to a later page without this line, so reading the active page silences
    // a resolved cage for free.
    var CAGE_RE = /little girl inside the cage/i;

    function stripCodes(text) {
        return text.replace(/\\[a-z]+\[\d+\]/gi, '').replace(/<[^>]+>/g, ' ');
    }

    function pageText(page) {
        var joined = '';
        var list = page.list;
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (c.code === 401 && c.parameters && c.parameters[0]) {
                joined += ' ' + stripCodes(c.parameters[0]);
            }
        }
        return joined;
    }

    // A cage is a player-activatable ACTIVE page (trigger 0) whose visible text
    // hits the captive marker. Reading the active page means a cage stops pinging
    // once the girl is freed. Guards erased pages and (0,0) template events.
    function isCageEvent(event) {
        if (event._pageIndex < 0) return false;
        if (event.x <= 0 || event.y <= 0) return false;
        var page;
        try {
            page = (typeof event.page === 'function') ? event.page() : null;
        } catch (e) {
            return false;
        }
        if (!page || !page.list) return false;
        if (page.trigger !== 0) return false;
        return CAGE_RE.test(pageText(page));
    }

    function cageEvents() {
        return $gameMap.events().filter(isCageEvent);
    }

    // A solid wall for line-of-sight purposes: a tile impassable from every
    // direction. 0x0f = all four passage bits; checkPassage returns false when
    // the tile blocks them all (a wall), true for open floor.
    function isWallTile(x, y) {
        return !$gameMap.checkPassage(x, y, 0x0f);
    }

    // True unless a wall tile sits strictly between player and cage. Walks the
    // straight line (Bresenham) and checks every intermediate tile, skipping the
    // two endpoints (the player's own tile and the cage's own tile).
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
            if (x === x1 && y === y1) break;   // reached the cage: clear path
            if (isWallTile(x, y)) return false; // a wall blocks the view
        }
        return true;
    }

    // Spatial ping for one cage: pan from horizontal offset, pitch from vertical
    // offset, volume from distance. Mirrors the EnemySonar encoding.
    function ping(dx, dy, dist) {
        // Pan: full left/right at ~10 tiles of horizontal offset; ~10 per tile
        // close in, so one step to the side is nearly centred.
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * 100)));
        // Pitch: above raises, below lowers (+/- 50 over ~10 tiles).
        var pitchOffset = Math.max(-50, Math.min(50, Math.round(-dy / 10 * 50)));
        var pitch = 100 + pitchOffset;
        // Volume: a caged captive is a rare, important landmark, so it sits a touch
        // above doors/containers in the mix (max 60, min 20) like altars, but well
        // under enemies (max 90) -- it is someone to free, not a threat.
        var d = Math.min(dist, 30);
        var volume = Math.round(60 - (d / 30) * 40);
        if (volume < 20) volume = 20;

        AudioManager.playSe({ name: cageSound, volume: volume, pitch: pitch, pan: pan });
    }

    function updateSonar() {
        if ($gameMap.mapId() !== timersMapId) {
            timersMapId = $gameMap.mapId();
            pingTimers = {};
            globalCooldown = 0;
        }

        if (globalCooldown > 0) globalCooldown--;

        var px = $gamePlayer.x;
        var py = $gamePlayer.y;
        var cages = cageEvents();
        var seen = {};
        var due = []; // cages whose own timer is up and that want to ping now

        for (var i = 0; i < cages.length; i++) {
            var ev = cages[i];
            var id = ev._eventId;
            seen[id] = true;

            var dx = ev.x - px; // + = cage to the right
            var dy = ev.y - py; // + = cage below (south)
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

            // New cages are due immediately; existing ones tick toward their
            // interval. A cage that is due but blocked by the global gap keeps
            // its raised timer (>= interval) so it stays due and pings as soon as
            // the gap opens, rather than restarting its wait.
            var t = (pingTimers[id] === undefined) ? interval : pingTimers[id] + 1;
            pingTimers[id] = t;
            if (t >= interval) due.push({ dx: dx, dy: dy, dist: dist, id: id });
        }

        // Only one cage may ping per Min Gap frames, so pings never overlap.
        // When several are due at once, the closest sounds first; the rest wait
        // their turn on the next opening.
        if (due.length > 0 && globalCooldown <= 0) {
            due.sort(function (a, b) { return (a.dist - b.dist) || (a.id - b.id); });
            var pick = due[0];
            ping(pick.dx, pick.dy, pick.dist);
            pingTimers[pick.id] = 0;
            globalCooldown = minGap;
        }

        // Drop timers for cages that left range or no longer exist so they ping
        // immediately again next time they reappear.
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
