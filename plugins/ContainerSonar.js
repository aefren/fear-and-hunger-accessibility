/*:
 * @plugindesc Always-on spatial "sonar" for searchable containers on the map
 * (crates, barrels, urns, bookshelves, shelves): each unsearched container event
 * emits a positional ping (pan = horizontal offset, pitch = vertical offset,
 * volume = distance). Pings once a second, or twice within a few tiles. No
 * toggle. Sibling of EnemySonar / DoorSonar / CorpseSonar for lootable furniture.
 * Author: project_accessibility
 *
 * @param Container Sound
 * @desc SE played as the per-container sonar ping (file in audio/se, no extension).
 * @type text
 * @default Decision2
 *
 * @param Far Interval
 * @desc Frames between pings for a distant container. 60 frames = 1 second.
 * @type number
 * @default 60
 *
 * @param Near Interval
 * @desc Frames between pings for a near container (<= Near Threshold). 30 = half a second.
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
 * @desc Only ping containers within this many tiles (Manhattan). 0 = no limit
 * (ping every container on the map).
 * @type number
 * @default 10
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
 * Cadence is per container: once a second normally, twice a second once it is
 * within Near Threshold tiles.
 *
 * Detection (runtime, no hard-coded coordinates): a container is an event whose
 * ACTIVE page shows the search prompt "You search the ..." (a Show Text line,
 * code 401). In F&H every lootable crate/barrel/urn/bookshelf/shelf opens with
 * exactly this line ("You search the crate for anything useful...", "You search
 * the barrel...", etc.); a scan of all 170 maps found 1307 such events across
 * five nouns (crate, urn, barrel, bookshelf, shelf), and the prompt is unique to
 * them, so it never leaks a non-container.
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
 * Load order: place this after ScreenReaderAccess.js (kept with the other
 * accessibility plugins at the end of plugins.js).
 */

(function () {
    var parameters = PluginManager.parameters('ContainerSonar');
    var containerSound = parameters['Container Sound'] || 'Decision2';
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

    // The universal search prompt for a lootable container. Every crate / barrel /
    // urn / bookshelf / shelf in F&H opens with "You search the <noun> for anything
    // useful...". The prompt lives on the UNSEARCHED page; an emptied container
    // flips to a page that says "...searched already" / "Nothing left here." with
    // no such line, so reading the active page silences looted containers for free.
    var SEARCH_RE = /you search the/i;

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
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * 100)));
        // Pitch: above raises, below lowers (+/- 50 over ~10 tiles).
        var pitchOffset = Math.max(-50, Math.min(50, Math.round(-dy / 10 * 50)));
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
