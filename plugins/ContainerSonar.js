/*:
 * @plugindesc Always-on spatial "sonar" for searchable containers on the map
 * (crates, barrels, urns, bookshelves, shelves, kitchen tables): each unsearched container event
 * emits a positional ping (pan = horizontal offset, pitch = vertical offset,
 * volume = distance). Pings every two seconds, or once a second within a few tiles. No
 * toggle. Sibling of EnemySonar / DoorSonar / CorpseSonar for lootable furniture.
 * Author: project_accessibility
 *
 * @param Container Sound
 * @desc SE played as the per-container sonar ping (file in audio/se, no extension).
 * @type text
 * @default Decision2
 *
 * @param Far Interval
 * @desc Frames between pings for a distant container. 120 frames = 2 seconds.
 * @type number
 * @default 120
 *
 * @param Near Interval
 * @desc Frames between pings for a near container (<= Near Threshold). 60 = one second.
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
 * @desc Only ping containers within this many tiles (Manhattan). 0 = no limit
 * (ping every container on the map).
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
 * @desc If true, do not ping containers hidden behind a wall (a wall tile sits on
 * the straight line between you and them).
 * @type boolean
 * @default true
 *
 * @param Min Gap
 * @desc Minimum frames between ANY two container pings, so they never overlap. 30 =
 * half a second. When several containers are due at once they queue and sound one
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
 * A sighted player sees the crates, barrels and urns lining a room and heads
 * straight for them to loot; a blind player got no cue that a tile held a
 * searchable container at all. Searchable furniture is where F&H hides most of
 * its items, so this plugin gives every unsearched container a continuous audio
 * presence, the counterpart of EnemySonar (threats), DoorSonar (exits) and
 * CorpseSonar (bodies).
 *
 * It is ALWAYS ON (no toggle key). Every frame on the map it scans for containers
 * and, on each one's own timer, plays a spatial ping:
 *   - Pan    = horizontal offset. Far to the right pans hard right; one tile
 *              to the side is almost centred (dx / 10 tiles -> full pan).
 *   - Pitch  = vertical offset. High above raises the pitch, far below lowers
 *              it, barely above is only slightly higher (dy / 10 tiles -> full).
 *   - Volume = distance. The closer the container, the louder the ping.
 * Cadence is per container: every two seconds normally, once a second once it is
 * within Near Threshold tiles.
 *
 * Detection (runtime, no hard-coded coordinates): a container is an event whose
 * ACTIVE page shows a lootable-furniture prompt (a Show Text line, code 401). In
 * F&H every lootable crate/barrel/urn/bookshelf/shelf opens with exactly the line
 * "You search the <noun> for anything useful..." ("You search the crate...", "You
 * search the barrel...", etc.); a scan of all 170 maps found 1307 such events
 * across five nouns (crate, urn, barrel, bookshelf, shelf). A few furniture pieces
 * use their own opening line instead -- a shelf of odds and ends ("The shelf has
 * miscellaneous items."), a scratched kitchen table ("A crude kitchen table with
 * lots of scratch and cut marks...") and a special bookshelf hiding a unique book
 * ("Dusty old books fill the bookshelf. Some of them seem partly rotten and
 * moldy.", 84 events) -- so those are matched too. Each prompt is unique to its
 * lootable, so none ever leaks a non-container.
 *
 * Because it reads the ACTIVE page, an already-searched container goes SILENT on
 * its own: once looted, the event flips a self-switch to a second page that shows
 * "The crate is searched already." / "Nothing left here." -- text that no longer
 * contains "You search the" -- so the sonar stops pinging it automatically, and a
 * blind player hears only the containers still worth opening, exactly as a
 * sighted player would skip the ones they have emptied.
 *
 * It reads positions straight from the engine, so it works regardless of how
 * dark the room is. It never speaks and never alters movement -- pure spatial
 * sound.
 *
 * Two filters keep it from leaking containers you could not actually perceive,
 * matching EnemySonar / DoorSonar / CorpseSonar:
 *   - Max Range: containers beyond this Manhattan distance are silent.
 *   - Line Of Sight: a container is silent if a solid wall tile sits on the
 *     straight line between you and it. Wall tiles are read from the map's
 *     passage flags (impassable in every direction), so this is exact and
 *     lighting-agnostic.
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
    var parameters = PluginManager.parameters('ContainerSonar');
    var containerSound = parameters['Container Sound'] || 'Decision2';
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

    // Global throttle: frames remaining before any container may ping again. Ticks
    // down each frame; a ping resets it to minGap so two pings are never closer
    // than half a second and so never overlap, even with many containers in range
    // (a single room can hold dozens of crates).
    var globalCooldown = 0;

    // Per-container ping timers, keyed by event id: frames elapsed since the last
    // ping for that container. Rebuilt every frame so absent containers drop out,
    // and cleared on a map change so ids are never carried across maps.
    var pingTimers = {};
    var timersMapId = 0;

    // The prompts that mark a lootable container's UNSEARCHED page. Most crates /
    // barrels / urns / bookshelves / shelves open with "You search the <noun> for
    // anything useful..."; a few furniture pieces use their own opening line
    // instead -- a shelf of odds and ends ("The shelf has miscellaneous items."), a
    // scratched-up kitchen table ("A crude kitchen table with lots of scratch and
    // cut marks..."), and a special bookshelf hiding a unique book ("Dusty old
    // books fill the bookshelf. Some of them seem partly rotten and moldy."). All
    // four live on the UNSEARCHED page; once emptied the event flips to a page that
    // says "...searched already" / "Nothing especially useful here..." with no such
    // line, so reading the active page silences looted containers for free.
    // Bilingual: the stock English lines plus the community Spanish translation,
    // which renders the same prompts several different ways across maps.
    var SEARCH_RE = /you search the|the shelf has miscellaneous items|a crude kitchen table|dusty old books fill the bookshelf|buscas en |registras la |el estante tiene varios|mesa de cocina (?:rudimentaria|tosca)|estanter[íi]a est[áa] llena de viejos libros|viejos libros polvorientos llenan/i;

    // A container is an event whose ACTIVE page shows the search prompt. Reading
    // the active page (not every page) is deliberate: it makes a looted container
    // -- now on its "already searched" page -- stop pinging on its own. Guards
    // erased pages and (0,0) events.
    function isContainerEvent(event) {
        if (event._pageIndex < 0) return false;
        if (event.x <= 0 || event.y <= 0) return false;
        var page;
        try {
            page = (typeof event.page === 'function') ? event.page() : null;
        } catch (e) {
            return false;
        }
        if (!page || !page.list) return false;
        var list = page.list;
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (c.code === 401 && c.parameters && c.parameters[0] && SEARCH_RE.test(c.parameters[0])) {
                return true;
            }
        }
        return false;
    }

    function containerEvents() {
        return $gameMap.events().filter(isContainerEvent);
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

    // True unless a wall tile sits strictly between player and container. Walks the
    // straight line (Bresenham) and checks every intermediate tile, skipping the
    // two endpoints (the player's own tile and the container's own tile).
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
            if (x === x1 && y === y1) break;   // reached the container: clear path
            if (isWallTile(x, y)) return false; // a wall blocks the view
        }
        return true;
    }

    // Spatial ping for one container: pan from horizontal offset, pitch from
    // vertical offset, volume from distance. Mirrors the EnemySonar encoding.
    function ping(dx, dy, dist) {
        // Pan: full left/right at ~10 tiles of horizontal offset; ~10 per tile
        // close in, so one step to the side is nearly centred.
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * panStrength)));
        // Pitch: above raises, below lowers (+/- pitchAmp over ~10 tiles).
        var pitchOffset = Math.max(-pitchAmp, Math.min(pitchAmp, Math.round(-dy / 10 * pitchAmp)));
        var pitch = 100 + pitchOffset;
        // Volume: louder near fading to quiet far by ~30 tiles (halved scale, like
        // doors). Containers sit below enemies in the mix -- loot, not a threat.
        var d = Math.min(dist, 30);
        var volume = Math.round(45 - (d / 30) * 30);
        if (volume < 15) volume = 15;

        AudioManager.playSe({ name: containerSound, volume: volume, pitch: pitch, pan: pan });
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
        var containers = containerEvents();
        var seen = {};
        var due = []; // containers whose own timer is up and that want to ping now

        for (var i = 0; i < containers.length; i++) {
            var ev = containers[i];
            var id = ev._eventId;
            seen[id] = true;

            var dx = ev.x - px; // + = container to the right
            var dy = ev.y - py; // + = container below (south)
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

            // New containers are due immediately; existing ones tick toward their
            // interval. A container that is due but blocked by the global gap keeps
            // its raised timer (>= interval) so it stays due and pings as soon as
            // the gap opens, rather than restarting its wait.
            var t = (pingTimers[id] === undefined) ? interval : pingTimers[id] + 1;
            pingTimers[id] = t;
            if (t >= interval) due.push({ dx: dx, dy: dy, dist: dist, id: id });
        }

        // Only one container may ping per Min Gap frames, so pings never overlap.
        // When several are due at once, the closest sounds first; the rest wait
        // their turn on the next opening.
        if (due.length > 0 && globalCooldown <= 0) {
            due.sort(function (a, b) { return (a.dist - b.dist) || (a.id - b.id); });
            var pick = due[0];
            ping(pick.dx, pick.dy, pick.dist);
            pingTimers[pick.id] = 0;
            globalCooldown = minGap;
        }

        // Drop timers for containers that left range or no longer exist so they
        // ping immediately again next time they reappear.
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
