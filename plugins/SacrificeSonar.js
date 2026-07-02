/*:
 * @plugindesc Always-on spatial "sonar" for the sacrificial circles for the older
 * gods (the big red circles with the instruction stand): each site emits a
 * positional ping (pan = horizontal offset, pitch = vertical offset, volume =
 * distance). Pings once a second, or twice within a few tiles. No toggle.
 * Sibling of AltarSonar for the god-offering sites.
 * Author: project_accessibility
 *
 * @param Sacrifice Sound
 * @desc SE played as the per-site sonar ping (file in audio/se, no extension).
 * @type text
 * @default Magic1
 *
 * @param Max Volume
 * @desc Loudest the ping ever gets (when standing next to the site). 30 = 30%.
 * @type number
 * @default 30
 *
 * @param Far Interval
 * @desc Frames between pings for a distant site. 60 frames = 1 second.
 * @type number
 * @default 60
 *
 * @param Near Interval
 * @desc Frames between pings for a near site (<= Near Threshold). 30 = half a second.
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
 * @desc Only ping sites within this many tiles (Manhattan). 0 = no limit
 * (ping every site on the map).
 * @type number
 * @default 10
 *
 * @param Line Of Sight
 * @desc If true, do not ping sites hidden behind a wall (a wall tile sits on
 * the straight line between you and them).
 * @type boolean
 * @default true
 *
 * @param Min Gap
 * @desc Minimum frames between ANY two site pings, so they never overlap. 30 =
 * half a second. When several sites are due at once they queue and sound one
 * at a time, closest first.
 * @type number
 * @default 30
 *
 * @help
 * The sacrificial circles for the older gods are among the most consequential
 * spots in Fear & Hunger: the big red circle where Gro-goroth takes human
 * sacrifices and Sylvian accepts an act of love (Marriage), unlocking some of
 * the strongest boons in the game. Each site is a room with the red circle on
 * the floor and a stand holding the instructions ("Sacrificial circle for the
 * older gods."). A sighted player spots the red drawing across the room; a
 * blind player got no cue the room was special at all. This plugin gives every
 * sacrificial-circle site a continuous audio identity, distinct from the
 * generic ritual-circle ping of AltarSonar.
 *
 * It is ALWAYS ON (no toggle key). Every frame on the map it scans for sites
 * and, on each one's own timer, plays a spatial ping:
 *   - Pan    = horizontal offset. Far to the right pans hard right; one tile
 *              to the side is almost centred (dx / 10 tiles -> full pan).
 *   - Pitch  = vertical offset. High above raises the pitch, far below lowers
 *              it, barely above is only slightly higher (dy / 10 tiles -> full).
 *   - Volume = distance. The closer the site, the louder the ping, capped at
 *              Max Volume (default 30%) so the cue stays discreet: the site is
 *              a landmark, not a threat.
 * Cadence is per site: once a second normally, twice a second once it is
 * within Near Threshold tiles.
 *
 * Detection (runtime, no hard-coded coordinates): each site has exactly one
 * event whose own Show Text names the place -- the instruction stand reading
 * "Sacrificial circle for the older gods." (or, in the late-game variant,
 * "Instructions on how to use the sacrificial circle... But for you it's no
 * use now."). A site is therefore any event with a player-activatable page
 * (trigger 0 action button, 1/2 contact) whose text contains "sacrificial
 * circle". A scan of all 170 maps found exactly 11 such events (one per site:
 * maps 1, 11, 24, 29, 39, 51, 132, 171, 177, 183 and 184 -- the late-game
 * maps are alternate versions of the same rooms) and nothing else, so it
 * never leaks a non-site. EVERY page is scanned, not just the active one, so
 * a site keeps pinging whatever state it is in.
 *
 * The red circle tiles themselves double as ritual circles ("Create a Blood
 * portal?") and already carry AltarSonar's ping; this plugin deliberately
 * marks the SITE via its unique instructions event instead, so the two sonars
 * never double-ping one event and a player who knows the sounds hears both
 * "there is a ritual circle here" and "this one is THE sacrificial circle".
 *
 * It reads positions straight from the engine, so it works regardless of how
 * dark the room is. It never speaks and never alters movement -- pure spatial
 * sound.
 *
 * Two filters keep it from leaking sites you could not actually perceive,
 * matching the sibling sonars:
 *   - Max Range: sites beyond this Manhattan distance are silent.
 *   - Line Of Sight: a site is silent if a solid wall tile sits on the
 *     straight line between you and it. Wall tiles are read from the map's
 *     passage flags (impassable in every direction), so this is exact and
 *     lighting-agnostic.
 *
 * Load order: place this after ScreenReaderAccess.js (kept with the other
 * accessibility plugins at the end of plugins.js).
 */

(function () {
    var parameters = PluginManager.parameters('SacrificeSonar');
    var sacrificeSound = parameters['Sacrifice Sound'] || 'Magic1';
    var maxVolume = parseInt(parameters['Max Volume']);
    if (isNaN(maxVolume)) maxVolume = 30;
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

    // Global throttle: frames remaining before any site may ping again. Ticks
    // down each frame; a ping resets it to minGap so two pings are never closer
    // than half a second and so never overlap.
    var globalCooldown = 0;

    // Per-site ping timers, keyed by event id: frames elapsed since the last
    // ping for that site. Rebuilt every frame so absent sites drop out, and
    // cleared on a map change so ids are never carried across maps.
    var pingTimers = {};
    var timersMapId = 0;

    // Marker for a sacrificial-circle site: the instructions event's own text
    // names it ("Sacrificial circle for the older gods." / "Instructions on how
    // to use the sacrificial circle..."). Escape codes are stripped first so a
    // colour-split line still matches.
    var SACRIFICE_RE = /sacrificial circle/i;

    function stripCodes(text) {
        return text.replace(/\\[a-z]+\[\d+\]/gi, '').replace(/<[^>]+>/g, ' ');
    }

    // A site is an event with a player-activatable page (trigger 0/1/2) whose
    // Show Text lines name the sacrificial circle. Every page is scanned -- not
    // just the active one -- so the site keeps pinging in any state. The verdict
    // is cached per map+event because event definitions are static.
    var siteCache = {};
    var siteCacheMapId = 0;
    function isSacrificeEvent(event) {
        if (event.x <= 0 || event.y <= 0) return false;
        var id = event._eventId;
        if (siteCache.hasOwnProperty(id)) return siteCache[id];
        var result = false;
        var data = (typeof event.event === 'function') ? event.event() : null;
        if (data && data.pages) {
            for (var p = 0; p < data.pages.length && !result; p++) {
                var page = data.pages[p];
                if (!page || !page.list) continue;
                if (page.trigger < 0 || page.trigger > 2) continue; // skip autorun/parallel
                var joined = '';
                for (var i = 0; i < page.list.length; i++) {
                    var c = page.list[i];
                    if (c.code === 401 && c.parameters && c.parameters[0]) joined += ' ' + c.parameters[0];
                }
                result = SACRIFICE_RE.test(stripCodes(joined));
            }
        }
        siteCache[id] = result;
        return result;
    }

    function sacrificeEvents() {
        if ($gameMap.mapId() !== siteCacheMapId) {
            siteCacheMapId = $gameMap.mapId();
            siteCache = {};
        }
        return $gameMap.events().filter(isSacrificeEvent);
    }

    // A solid wall for line-of-sight purposes: a tile impassable from every
    // direction. 0x0f = all four passage bits; checkPassage returns false when
    // the tile blocks them all (a wall), true for open floor.
    function isWallTile(x, y) {
        return !$gameMap.checkPassage(x, y, 0x0f);
    }

    // True unless a wall tile sits strictly between player and site. Walks the
    // straight line (Bresenham) and checks every intermediate tile, skipping the
    // two endpoints (the player's own tile and the site's own tile).
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
            if (x === x1 && y === y1) break;   // reached the site: clear path
            if (isWallTile(x, y)) return false; // a wall blocks the view
        }
        return true;
    }

    // Spatial ping for one site: pan from horizontal offset, pitch from vertical
    // offset, volume from distance. Mirrors the AltarSonar encoding, but the
    // whole curve is scaled down to Max Volume (default 30%) so the cue stays a
    // quiet landmark under every other sonar.
    function ping(dx, dy, dist) {
        // Pan: full left/right at ~10 tiles of horizontal offset; ~10 per tile
        // close in, so one step to the side is nearly centred.
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * 100)));
        // Pitch: above raises, below lowers (+/- 50 over ~10 tiles).
        var pitchOffset = Math.max(-50, Math.min(50, Math.round(-dy / 10 * 50)));
        var pitch = 100 + pitchOffset;
        // Volume: Max Volume when adjacent, fading with distance to a floor of
        // a third of Max Volume by ~30 tiles, so it stays audible but discreet.
        var d = Math.min(dist, 30);
        var floor = Math.max(1, Math.round(maxVolume / 3));
        var volume = Math.round(maxVolume - (d / 30) * (maxVolume - floor));
        if (volume < floor) volume = floor;
        if (volume > maxVolume) volume = maxVolume;

        AudioManager.playSe({ name: sacrificeSound, volume: volume, pitch: pitch, pan: pan });
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
        var sites = sacrificeEvents();
        var seen = {};
        var due = []; // sites whose own timer is up and that want to ping now

        for (var i = 0; i < sites.length; i++) {
            var ev = sites[i];
            var id = ev._eventId;
            seen[id] = true;

            var dx = ev.x - px; // + = site to the right
            var dy = ev.y - py; // + = site below (south)
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

            // New sites are due immediately; existing ones tick toward their
            // interval. A site that is due but blocked by the global gap keeps
            // its raised timer (>= interval) so it stays due and pings as soon
            // as the gap opens, rather than restarting its wait.
            var t = (pingTimers[id] === undefined) ? interval : pingTimers[id] + 1;
            pingTimers[id] = t;
            if (t >= interval) due.push({ dx: dx, dy: dy, dist: dist, id: id });
        }

        // Only one site may ping per Min Gap frames, so pings never overlap.
        // When several are due at once, the closest sounds first; the rest wait
        // their turn on the next opening.
        if (due.length > 0 && globalCooldown <= 0) {
            due.sort(function (a, b) { return (a.dist - b.dist) || (a.id - b.id); });
            var pick = due[0];
            ping(pick.dx, pick.dy, pick.dist);
            pingTimers[pick.id] = 0;
            globalCooldown = minGap;
        }

        // Drop timers for sites that left range or no longer exist so they
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
