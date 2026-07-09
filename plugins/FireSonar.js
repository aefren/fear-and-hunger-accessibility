/*:
 * @plugindesc Always-on spatial "sonar" for fire and light sources on the map (a
 * lit furnace and candles/beacons/bonfires/torches you can light with a Tinderbox):
 * each fire event emits a positional ping (pan = horizontal offset, pitch =
 * vertical offset, volume = distance). Pings every two seconds, or once a second within a few
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
 * @desc Frames between pings for a distant fire. 120 frames = 2 seconds.
 * @type number
 * @default 120
 *
 * @param Near Interval
 * @desc Frames between pings for a near fire (<= Near Threshold). 60 = one second.
 * @type number
 * @default 60
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
 * @param Hearing Range
 * @desc In darkness, targets within this many tiles (Manhattan) still ping --
 * you would hear them even without seeing them. Beyond it a target must be lit
 * (by your light globe or a burning map light) to ping. 0 = hearing off.
 * @type number
 * @default 2
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
 * @param Pan Strength
 * @desc Stereo pan strength in percent. 100 = full pan at ~10 tiles of
 * horizontal offset; higher pans harder per tile. Like a panning_strength.
 * @type number
 * @default 110
 *
 * @param Pitch Strength
 * @desc Vertical pitch strength in percent. 100 = +/-50 pitch at ~10 tiles
 * of vertical offset; higher shifts pitch more per tile.
 * @type number
 * @default 110
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
 * Cadence is per fire: every two seconds normally, once a second once it is within
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
 * DYNAMIC RANGE FROM LIGHT. The game's darkness is not cosmetic: TerraxLighting
 * multiplies the screen with a black mask, so a sighted player only sees what
 * some light globe reaches (fresh torch 300 px = 6.25 tiles, bare hands 240 px
 * = 5 tiles, all the way down to 0 in the Terror & Starvation darkness). This
 * sonar honours the same rule: beyond Hearing Range tiles a target only pings
 * while it is LIT -- inside the player's current light globe or inside any map
 * light that is burning (a lit candle, a wall torch, a patrolling
 * torch-bearer). Lighting a torch therefore widens every sonar, and losing
 * your light narrows them to arm's length, exactly as it does for a sighted
 * player. Max Range stays the hard cap and Line Of Sight still applies on top.
 * Without TerraxLighting (other games) nothing changes.
 *
 * Load order: place this after ScreenReaderAccess.js (kept with the other
 * accessibility plugins at the end of plugins.js).
 */

(function () {
    var parameters = PluginManager.parameters('FireSonar');
    var fireSound = parameters['Fire Sound'] || 'fireball_334234__liamg-sfx__fireball-cast-1_01_01';
    var farInterval = parseInt(parameters['Far Interval']) || 120;
    var nearInterval = parseInt(parameters['Near Interval']) || 60;
    var nearThreshold = parseInt(parameters['Near Threshold']) || 5;
    var panStrength = parseInt(parameters['Pan Strength']);
    if (isNaN(panStrength)) panStrength = 110;
    var pitchStrength = parseInt(parameters['Pitch Strength']);
    if (isNaN(pitchStrength)) pitchStrength = 110;
    // Pitch swing in pitch-units at ~10 tiles: 50 at 100%, 55 at the 110% default.
    var pitchAmp = Math.round(50 * pitchStrength / 100);
    // 0 means unlimited, so respect an explicit 0 instead of falling back.
    var maxRangeParam = parameters['Max Range'];
    var maxRange = (maxRangeParam === undefined || maxRangeParam === '') ? 10 : parseInt(maxRangeParam);
    if (isNaN(maxRange)) maxRange = 10;
    var lineOfSight = parameters['Line Of Sight'] !== 'false'; // default on
    // 0 is a valid choice (no hearing floor), so respect it like Max Range's 0.
    var hearingRangeParam = parameters['Hearing Range'];
    var hearingRange = (hearingRangeParam === undefined || hearingRangeParam === '') ? 2 : parseInt(hearingRangeParam);
    if (isNaN(hearingRange)) hearingRange = 2;
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
    // Bilingual: English + community Spanish translation.
    var FIRE_RE = /fire is burning hot in the furnace|to light the (?:candle|beacon|bonfire|torch)|fuego (?:arde|est[áa]? ardiendo)[^.]*horno|para encender (?:la|el) (?:vela|antorcha|hoguera|almenara|baliza|faro)/i;

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

    // Shared light-perception helper. Every accessibility sonar carries this
    // same block; the first one that loads defines it and the rest reuse it.
    //
    // Fear & Hunger's darkness is real: TerraxLighting multiplies the screen
    // with a black mask, so a sighted player only perceives what some light
    // globe reaches. isLit(x, y) answers "could a sighted player see that tile
    // right now?" -- true when the tile is inside the player's own light globe
    // (current radius in pixels, mirrored into $gameVariables by Terrax;
    // 48 px = 1 tile) or inside the globe of any map light that is burning: an
    // event whose note reads "Light 250 #FFFFFF" / "Fire 450 ..." (candles,
    // wall torches, a torch-carrying priest). Lights with a trailing id
    // ("Light 250 #FFFFFF 77") follow Terrax's "Light on/off" state, and the
    // kill self-switch (Terrax's Kill Switch parameter, C in Fear & Hunger)
    // silences any of them. Positions come from the LIVE events, so a
    // patrolling torch-bearer's glow moves with him. Without TerraxLighting,
    // isLit is always true and the sonars keep their fixed ranges.
    if (!window.AccessibilityLight) window.AccessibilityLight = (function () {
        var TILE = 48; // RPG Maker MV tile size; Terrax radii are in pixels

        function terraxPresent() {
            return typeof Game_Variables !== 'undefined' &&
                typeof Game_Variables.prototype.setRadiusSave === 'function';
        }

        // The player's current light radius in pixels. Terrax mirrors it into
        // $gameVariables on every "Light/Fire radius" command and on each
        // frame of a "radiusgrow" fade; before the first command runs (the
        // first frames of a fresh game) fall back to the plugin's "Player
        // radius" parameter.
        function playerRadiusPx() {
            var v = $gameVariables ? $gameVariables._Terrax_Lighting_Radius : undefined;
            if (typeof v === 'number' && !isNaN(v)) return v;
            var params = PluginManager.parameters('TerraxLighting');
            var fallback = parseInt(params && params['Player radius']);
            return isNaN(fallback) ? 300 : fallback;
        }

        // Map lights, parsed once per map from the static event notes:
        // "Light|Fire <radius> [#color] [B..] [D..] [id]".
        var lightCache = null;
        var lightCacheMapId = -1;

        function mapLights() {
            var mapId = $gameMap.mapId();
            if (lightCache && lightCacheMapId === mapId) return lightCache;
            lightCacheMapId = mapId;
            lightCache = [];
            var events = ($dataMap && $dataMap.events) || [];
            for (var i = 0; i < events.length; i++) {
                var data = events[i];
                if (!data || !data.note) continue;
                var args = data.note.trim().split(/\s+/);
                var kind = args[0].toLowerCase();
                if (kind !== 'light' && kind !== 'fire') continue;
                var radius = Number(args[1]);
                if (isNaN(radius) || radius <= 0) continue;
                // A bare trailing number is the switchable light id; color,
                // B(rightness) and D(irection) arguments are skipped.
                var lightId = 0;
                for (var a = 2; a < args.length; a++) {
                    if (/^\d+$/.test(args[a])) { lightId = Number(args[a]); break; }
                }
                lightCache.push({ eventId: data.id, x: data.x, y: data.y, radius: radius, lightId: lightId });
            }
            return lightCache;
        }

        // Is that map light burning right now? Lights without an id always
        // are; id lights follow Terrax's "Light on/off <id>" state; the kill
        // self-switch turns any of them off.
        function lightIsOn(light) {
            var params = PluginManager.parameters('TerraxLighting');
            var kill = params && params['Kill Switch'];
            if ((kill === 'A' || kill === 'B' || kill === 'C' || kill === 'D') &&
                $gameSelfSwitches.value([$gameMap.mapId(), light.eventId, kill])) {
                return false;
            }
            if (light.lightId > 0) {
                var ids = ($gameVariables.valueLightArrayId && $gameVariables.valueLightArrayId()) || [];
                var states = ($gameVariables.valueLightArrayState && $gameVariables.valueLightArrayState()) || [];
                for (var i = 0; i < ids.length; i++) {
                    if (ids[i] == light.lightId) return !!states[i];
                }
                return false; // an id light that was never switched on
            }
            return true;
        }

        // Squared pixel distance between the centers of two tiles.
        function distPx2(x0, y0, x1, y1) {
            var dx = (x1 - x0) * TILE;
            var dy = (y1 - y0) * TILE;
            return dx * dx + dy * dy;
        }

        function isLit(tx, ty) {
            if (!terraxPresent()) return true;
            var pr = playerRadiusPx();
            if (pr > 0 && distPx2($gamePlayer.x, $gamePlayer.y, tx, ty) <= pr * pr) return true;
            var lights = mapLights();
            for (var i = 0; i < lights.length; i++) {
                var light = lights[i];
                if (!lightIsOn(light)) continue;
                // Live position when the light source moves (torch-bearers).
                var ev = $gameMap.event(light.eventId);
                var lx = ev ? ev.x : light.x;
                var ly = ev ? ev.y : light.y;
                if (distPx2(lx, ly, tx, ty) <= light.radius * light.radius) return true;
            }
            return false;
        }

        return { isLit: isLit };
    })();

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
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * panStrength)));
        // Pitch: above raises, below lowers (+/- pitchAmp over ~10 tiles).
        var pitchOffset = Math.max(-pitchAmp, Math.min(pitchAmp, Math.round(-dy / 10 * pitchAmp)));
        var pitch = 100 + pitchOffset;
        // Volume: louder near fading to quiet far by ~30 tiles. Fires sit with
        // containers in the mix (max 30) -- a useful landmark, not a threat.
        var d = Math.min(dist, 30);
        var volume = Math.round(30 - (d / 30) * 20);
        if (volume < 10) volume = 10;

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
            // In the dark a sighted player would not perceive this either:
            // beyond hearing distance the target must be lit (by the player's
            // light globe or a burning map light) to stay on the radar.
            if (dist > hearingRange && !window.AccessibilityLight.isLit(ev.x, ev.y)) {
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
