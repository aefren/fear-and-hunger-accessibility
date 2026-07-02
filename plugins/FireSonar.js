/*:
 * @plugindesc Always-on spatial "sonar" for fire and light sources on the map (a
 * lit furnace and candles/beacons/bonfires/torches you can light with a Tinderbox):
 * each fire event emits a positional ping (pan = horizontal offset, pitch =
 * vertical offset, volume = distance). Pings once a second, or twice within a few
 * tiles. No toggle. Sibling of EnemySonar / DoorSonar / ContainerSonar for fire and
 * light.
 * Author: project_accessibility
 *
 * @param Fire Sound
 * @desc SE played as the per-fire sonar ping (file in audio/se, no extension).
 * @type text
 * @default fireball_334234__liamg-sfx__fireball-cast-1_01_01
 *
 * @param Far Interval
 * @desc Frames between pings for a distant fire. 60 frames = 1 second.
 * @type number
 * @default 60
 *
 * @param Near Interval
 * @desc Frames between pings for a near fire (<= Near Threshold). 30 = half a second.
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
 * @desc Only ping fires within this many tiles (Manhattan). 0 = no limit
 * (ping every fire on the map).
 * @type number
 * @default 10
 *
 * @param Line Of Sight
 * @desc If true, do not ping fires hidden behind a wall (a wall tile sits on the
 * straight line between you and them).
 * @type boolean
 * @default true
 *
 * @param Min Gap
 * @desc Minimum frames between ANY two fire pings, so they never overlap. 30 =
 * half a second. When several fires are due at once they queue and sound one
 * at a time, closest first.
 * @type number
 * @default 30
 *
 * @help
 * Fire and light matter in Fear & Hunger: the furnace and bonfire let you grill meat
 * to eat, and candles/beacons/torches are light sources in a game whose darkness is
 * a constant threat. A sighted player sees the glow of a lit furnace and the
 * candles, beacons, bonfires and torches waiting to be lit; a blind player got no
 * cue that a tile was a fire or a light source at all. This plugin gives those
 * interactables a continuous audio presence, the counterpart of EnemySonar
 * (threats), ContainerSonar (loot) and AltarSonar (ritual sites).
 *
 * It is ALWAYS ON (no toggle key). Every frame on the map it scans for fires and,
 * on each one's own timer, plays a spatial ping:
 *   - Pan    = horizontal offset. Far to the right pans hard right; one tile
 *              to the side is almost centred (dx / 10 tiles -> full pan).
 *   - Pitch  = vertical offset. High above raises the pitch, far below lowers
 *              it, barely above is only slightly higher (dy / 10 tiles -> full).
 *   - Volume = distance. The closer the fire, the louder the ping.
 * Cadence is per fire: once a second normally, twice a second once it is within
 * Near Threshold tiles.
 *
 * Detection (runtime, no hard-coded coordinates): a fire is an event with a
 * player-activatable page (trigger 0 action button) whose Show Text lines (code
 * 401) match one of the fire-family markers -- a furnace ("The fire is burning hot
 * in the furnace.") or a candle / beacon / bonfire / torch ("Use Tinderbox to
 * light the candle/beacon/bonfire/torch?"). Escape/colour codes are stripped
 * first, so the colour-split prompts (e.g. "Use \c[2]Tinderbox\c[0] to light the
 * candle?") still match. A scan of all 170 maps found 180 such events (100 candles
 * + 42 beacons + 19 torches + 12 bonfires + 7 furnaces) and nothing else, so the
 * markers never leak a non-fire.
 *
 * EVERY page is scanned, not just the active one (AltarSonar's approach), so a fire
 * KEEPS PINGING after it is lit. Each marker lives on a specific state page -- the
 * furnace's "burning hot" text is its LIT page, the "Use Tinderbox to light the ..."
 * prompt is the candle/beacon/bonfire/torch's UNLIT page -- and lighting the fire
 * flips the active page away from that state, which would silence a sonar that read
 * only the active page. But a lit candle or torch is still a light source, and a
 * lit furnace or bonfire is still where you cook, so a fire is a landmark worth
 * finding in either state. Reading the static event definition (all pages) keeps it
 * on the radar whether or not it has been lit.
 *
 * It reads positions straight from the engine, so it works regardless of how dark
 * the room is. It never speaks and never alters movement -- pure spatial sound.
 *
 * Two filters keep it from leaking fires you could not actually perceive, matching
 * EnemySonar / DoorSonar / ContainerSonar:
 *   - Max Range: fires beyond this Manhattan distance are silent.
 *   - Line Of Sight: a fire is silent if a solid wall tile sits on the straight
 *     line between you and it. Wall tiles are read from the map's passage flags
 *     (impassable in every direction), so this is exact and lighting-agnostic.
 *
 * Load order: place this after ScreenReaderAccess.js (kept with the other
 * accessibility plugins at the end of plugins.js).
 */

(function () {
    var parameters = PluginManager.parameters('FireSonar');
    var fireSound = parameters['Fire Sound'] || 'fireball_334234__liamg-sfx__fireball-cast-1_01_01';
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

    // Global throttle: frames remaining before any fire may ping again. Ticks down
    // each frame; a ping resets it to minGap so two pings are never closer than
    // half a second and so never overlap (a room can hold several candles).
    var globalCooldown = 0;

    // Per-fire ping timers, keyed by event id: frames elapsed since the last ping
    // for that fire. Rebuilt every frame so absent fires drop out, and cleared on
    // a map change so ids are never carried across maps.
    var pingTimers = {};
    var timersMapId = 0;

    // The fire-family markers. A furnace's LIT page shows "The fire is burning hot
    // in the furnace."; a candle/beacon/bonfire/torch's UNLIT page shows "Use
    // Tinderbox to light the <noun>?". These live on different pages of the same
    // event depending on state, so detection scans EVERY page (see isFireEvent) --
    // a fire stays on the radar whether or not it has been lit.
    var FIRE_RE = /fire is burning hot in the furnace|to light the (?:candle|beacon|bonfire|torch)/i;

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

    // A fire is an event whose DEFINITION has a player-activatable page (trigger 0
    // action button) whose text hits a fire marker. EVERY page is scanned -- not
    // just the active one (AltarSonar's approach) -- so a fire keeps pinging AFTER
    // it is lit: the "Use Tinderbox to light the <noun>?" prompt lives on the unlit
    // page and drops away once lit, but a lit candle/torch is still a light source
    // and a lit furnace/bonfire is still where you cook, so they remain landmarks
    // worth locating. Reading the static definition keeps them on the radar in
    // either state. Guards only the exact origin (0,0), where RPG Maker parks
    // template events.
    function isFireEvent(event) {
        if (event.x === 0 && event.y === 0) return false;
        var data = (typeof event.event === 'function') ? event.event() : null;
        if (!data || !data.pages) return false;
        for (var p = 0; p < data.pages.length; p++) {
            var page = data.pages[p];
            if (!page || !page.list) continue;
            if (page.trigger !== 0) continue; // only player action-button pages
            if (FIRE_RE.test(pageText(page))) return true;
        }
        return false;
    }

    function fireEvents() {
        return $gameMap.events().filter(isFireEvent);
    }

    // A solid wall for line-of-sight purposes: a tile impassable from every
    // direction. 0x0f = all four passage bits; checkPassage returns false when
    // the tile blocks them all (a wall), true for open floor.
    function isWallTile(x, y) {
        return !$gameMap.checkPassage(x, y, 0x0f);
    }

    // True unless a wall tile sits strictly between player and fire. Walks the
    // straight line (Bresenham) and checks every intermediate tile, skipping the
    // two endpoints (the player's own tile and the fire's own tile).
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
            if (x === x1 && y === y1) break;   // reached the fire: clear path
            if (isWallTile(x, y)) return false; // a wall blocks the view
        }
        return true;
    }

    // Spatial ping for one fire: pan from horizontal offset, pitch from vertical
    // offset, volume from distance. Mirrors the EnemySonar encoding.
    function ping(dx, dy, dist) {
        // Pan: full left/right at ~10 tiles of horizontal offset; ~10 per tile
        // close in, so one step to the side is nearly centred.
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * 100)));
        // Pitch: above raises, below lowers (+/- 50 over ~10 tiles).
        var pitchOffset = Math.max(-50, Math.min(50, Math.round(-dy / 10 * 50)));
        var pitch = 100 + pitchOffset;
        // Volume: louder near fading to quiet far by ~30 tiles. Fires sit with
        // containers in the mix (max 45) -- a useful landmark, not a threat.
        var d = Math.min(dist, 30);
        var volume = Math.round(45 - (d / 30) * 30);
        if (volume < 15) volume = 15;

        AudioManager.playSe({ name: fireSound, volume: volume, pitch: pitch, pan: pan });
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
        var fires = fireEvents();
        var seen = {};
        var due = []; // fires whose own timer is up and that want to ping now

        for (var i = 0; i < fires.length; i++) {
            var ev = fires[i];
            var id = ev._eventId;
            seen[id] = true;

            var dx = ev.x - px; // + = fire to the right
            var dy = ev.y - py; // + = fire below (south)
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

            // New fires are due immediately; existing ones tick toward their
            // interval. A fire that is due but blocked by the global gap keeps
            // its raised timer (>= interval) so it stays due and pings as soon as
            // the gap opens, rather than restarting its wait.
            var t = (pingTimers[id] === undefined) ? interval : pingTimers[id] + 1;
            pingTimers[id] = t;
            if (t >= interval) due.push({ dx: dx, dy: dy, dist: dist, id: id });
        }

        // Only one fire may ping per Min Gap frames, so pings never overlap.
        // When several are due at once, the closest sounds first; the rest wait
        // their turn on the next opening.
        if (due.length > 0 && globalCooldown <= 0) {
            due.sort(function (a, b) { return (a.dist - b.dist) || (a.id - b.id); });
            var pick = due[0];
            ping(pick.dx, pick.dy, pick.dist);
            pingTimers[pick.id] = 0;
            globalCooldown = minGap;
        }

        // Drop timers for fires that left range or no longer exist so they ping
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
