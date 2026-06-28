/*:
 * @plugindesc Always-on spatial "sonar" for corpses on the map: each dead body
 * event emits a positional ping (pan = horizontal offset, pitch = vertical
 * offset, volume = distance). Pings once a second, or twice within a few tiles.
 * No toggle. Sibling of EnemySonar / DoorSonar for examinable / lootable bodies.
 * Author: project_accessibility
 *
 * @param Corpse Sound
 * @desc SE played as the per-corpse sonar ping (file in audio/se, no extension).
 * @type text
 * @default Down1
 *
 * @param Far Interval
 * @desc Frames between pings for a distant corpse. 60 frames = 1 second.
 * @type number
 * @default 60
 *
 * @param Near Interval
 * @desc Frames between pings for a near corpse (<= Near Threshold). 30 = half a second.
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
 * @desc Only ping corpses within this many tiles (Manhattan). 0 = no limit
 * (ping every corpse on the map).
 * @type number
 * @default 10
 *
 * @param Line Of Sight
 * @desc If true, do not ping corpses hidden behind a wall (a wall tile sits on
 * the straight line between you and them).
 * @type boolean
 * @default true
 *
 * @param Min Gap
 * @desc Minimum frames between ANY two corpse pings, so they never overlap. 30 =
 * half a second. When several corpses are due at once they queue and sound one
 * at a time, closest first.
 * @type number
 * @default 30
 *
 * @help
 * A sighted player sees the bodies strewn around a room; a blind player got no
 * cue that a tile held a corpse at all. Corpses matter in Fear & Hunger: you can
 * loot them and use the Soul stone on them (necromancy / resurrecting fallen
 * companions). They fell through only as generic "interactables" with no
 * identity, so this plugin gives every corpse a continuous audio presence, the
 * counterpart of EnemySonar (threats) and DoorSonar (exits).
 *
 * It is ALWAYS ON (no toggle key). Every frame on the map it scans for corpses
 * and, on each one's own timer, plays a spatial ping:
 *   - Pan    = horizontal offset. Far to the right pans hard right; one tile
 *              to the side is almost centred (dx / 10 tiles -> full pan).
 *   - Pitch  = vertical offset. High above raises the pitch, far below lowers
 *              it, barely above is only slightly higher (dy / 10 tiles -> full).
 *   - Volume = distance. The closer the corpse, the louder the ping.
 * Cadence is per corpse: once a second normally, twice a second once the corpse
 * is within Near Threshold tiles.
 *
 * Detection (runtime, no hard-coded coordinates): a corpse is an event whose
 * ACTIVE page is a dead body and has NO "Battle Processing" command (code 301)
 * -- a page with 301 is a LIVE enemy and belongs to EnemySonar, not here. The
 * body is recognised by:
 *   - SOUL STONE (primary): the active page shows the necromancy prompt
 *     "...you could use Soul stone here...". This is the marker EVERY corpse
 *     shares in F&H -- a slain enemy that turned into a gore pile, a "downed"
 *     enemy you can Beat / Search / Leave (e.g. "The monstrosity is down...")
 *     that KEEPS its living sprite and event name, and a fallen companion alike.
 *     A scan of all 170 maps found this text on 3118 pages and not one of them
 *     also fires a battle, so it never mistakes a live enemy for a corpse. This
 *     is what catches the downed enemies that a sprite/name check missed.
 *   - CORPSE SPRITE (backup): the active page shows a body-only sprite -- $flesh
 *     (the defeated-enemy gore pile), $corpsepile, $charred_body,
 *     $characters_dead, $husk, $skeleton_arms1 -- for the few corpse pages whose
 *     sprite shows before the Soul-stone line or that omit the text.
 * Because both read the ACTIVE page, a defeated enemy starts pinging as a corpse
 * exactly when it stops pinging as an enemy (it flips from its contact-battle
 * page to its downed/gore page), and a corpse later removed (page switched away)
 * stops on its own.
 *
 * Purely textual invisible bodies with no Soul-stone prompt ("There is a
 * skeleton here", "a body hanging here") are NOT detected: matching them needs
 * generic text scanning, which in the real data also catches non-corpses
 * (blood-portal tiles, Transfer passages), so it would leak false positives.
 * Those remain reachable through the interactables menu.
 *
 * It reads positions straight from the engine, so it works regardless of how
 * dark the room is. It never speaks and never alters movement -- pure spatial
 * sound.
 *
 * Two filters keep it from leaking corpses you could not actually perceive,
 * matching EnemySonar / DoorSonar:
 *   - Max Range: corpses beyond this Manhattan distance are silent.
 *   - Line Of Sight: a corpse is silent if a solid wall tile sits on the
 *     straight line between you and it. Wall tiles are read from the map's
 *     passage flags (impassable in every direction), so this is exact and
 *     lighting-agnostic.
 *
 * Load order: place this after ScreenReaderAccess.js (kept with the other
 * accessibility plugins at the end of plugins.js).
 */

(function () {
    var parameters = PluginManager.parameters('CorpseSonar');
    var corpseSound = parameters['Corpse Sound'] || 'Down1';
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

    // Global throttle: frames remaining before any corpse may ping again. Ticks
    // down each frame; a ping resets it to minGap so two pings are never closer
    // than half a second and so never overlap, even with many corpses in range.
    var globalCooldown = 0;

    // Per-corpse ping timers, keyed by event id: frames elapsed since the last
    // ping for that corpse. Rebuilt every frame so absent corpses drop out, and
    // cleared on a map change so ids are never carried across maps.
    var pingTimers = {};
    var timersMapId = 0;

    // The universal corpse marker. Every body in F&H -- a slain enemy, a
    // "downed" enemy you can Beat/Search/Leave, a fallen companion -- shows the
    // necromancy prompt "...you could use Soul stone here..." on its active page.
    // A scan of all 170 maps found this text on 3118 pages and NOT ONE of them
    // also fires a battle (code 301), so it never collides with a live enemy.
    var SOUL_STONE = /soul stone/i;

    // Sprite names that are only ever a corpse (verified against all 170 maps):
    // $flesh is the gore pile some defeated enemies turn into; the rest are
    // placed dead bodies. Matched with the !$ sprite-mode prefixes stripped.
    // Kept as a backup signal for the handful of corpse pages whose body sprite
    // shows before the Soul-stone text line (or that omit it entirely).
    var CORPSE_SPRITE = /^(flesh|corpsepile|charred_body|characters_dead|husk|skeleton_arms1)$/i;

    // A corpse is an event whose ACTIVE page is a dead body and does NOT fire a
    // battle (a battle page = live enemy, EnemySonar's job). Recognised by the
    // "Soul stone" necromancy prompt on the page -- the marker shared by EVERY
    // body type, crucially including a "downed" enemy that keeps its living
    // sprite and event name (e.g. "The monstrosity is down...", guard1/mauler1/
    // lizard sprites) which sprite/name signals alone missed -- or, as a backup,
    // a corpse-only body sprite. Reading the ACTIVE page means a slain enemy
    // becomes a corpse here exactly as it stops being an enemy. Guards erased
    // pages and (0,0) events.
    function isCorpseEvent(event) {
        if (event._pageIndex < 0) return false;
        if (event.x <= 0 || event.y <= 0) return false;
        var page;
        try {
            page = (typeof event.page === 'function') ? event.page() : null;
        } catch (e) {
            return false;
        }
        if (!page || !page.list) return false;

        var sprite = (page.image && page.image.characterName)
            ? page.image.characterName.replace(/^[!$]+/, '') : '';
        var spriteIsCorpse = sprite && CORPSE_SPRITE.test(sprite);

        // One pass over the active page: a battle command means a LIVE enemy
        // (never a corpse, even if the sprite looks dead); a "Soul stone" text
        // line is the universal corpse marker.
        var hasSoulStone = false;
        var list = page.list;
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (c.code === 301) return false; // live enemy: not a corpse
            if (!hasSoulStone && c.code === 401 && c.parameters && c.parameters[0]
                && SOUL_STONE.test(c.parameters[0])) {
                hasSoulStone = true;
            }
        }
        return hasSoulStone || spriteIsCorpse;
    }

    function corpseEvents() {
        return $gameMap.events().filter(isCorpseEvent);
    }

    // A solid wall for line-of-sight purposes: a tile impassable from every
    // direction. 0x0f = all four passage bits; checkPassage returns false when
    // the tile blocks them all (a wall), true for open floor.
    function isWallTile(x, y) {
        return !$gameMap.checkPassage(x, y, 0x0f);
    }

    // True unless a wall tile sits strictly between player and corpse. Walks the
    // straight line (Bresenham) and checks every intermediate tile, skipping the
    // two endpoints (the player's own tile and the corpse's own tile).
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
            if (x === x1 && y === y1) break;   // reached the corpse: clear path
            if (isWallTile(x, y)) return false; // a wall blocks the view
        }
        return true;
    }

    // Spatial ping for one corpse: pan from horizontal offset, pitch from
    // vertical offset, volume from distance. Mirrors the EnemySonar encoding.
    function ping(dx, dy, dist) {
        // Pan: full left/right at ~10 tiles of horizontal offset; ~10 per tile
        // close in, so one step to the side is nearly centred.
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * 100)));
        // Pitch: above raises, below lowers (+/- 50 over ~10 tiles).
        var pitchOffset = Math.max(-50, Math.min(50, Math.round(-dy / 10 * 50)));
        var pitch = 100 + pitchOffset;
        // Volume: louder near fading to quiet far by ~30 tiles. Max 30 so
        // corpses sit well under enemies/doors in the mix.
        var d = Math.min(dist, 30);
        var volume = Math.round(30 - (d / 30) * 15);
        if (volume < 15) volume = 15;

        AudioManager.playSe({ name: corpseSound, volume: volume, pitch: pitch, pan: pan });
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
        var corpses = corpseEvents();
        var seen = {};
        var due = []; // corpses whose own timer is up and that want to ping now

        for (var i = 0; i < corpses.length; i++) {
            var ev = corpses[i];
            var id = ev._eventId;
            seen[id] = true;

            var dx = ev.x - px; // + = corpse to the right
            var dy = ev.y - py; // + = corpse below (south)
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

            // New corpses are due immediately; existing ones tick toward their
            // interval. A corpse that is due but blocked by the global gap keeps
            // its raised timer (>= interval) so it stays due and pings as soon
            // as the gap opens, rather than restarting its wait.
            var t = (pingTimers[id] === undefined) ? interval : pingTimers[id] + 1;
            pingTimers[id] = t;
            if (t >= interval) due.push({ dx: dx, dy: dy, dist: dist, id: id });
        }

        // Only one corpse may ping per Min Gap frames, so pings never overlap.
        // When several are due at once, the closest sounds first; the rest wait
        // their turn on the next opening.
        if (due.length > 0 && globalCooldown <= 0) {
            due.sort(function (a, b) { return (a.dist - b.dist) || (a.id - b.id); });
            var pick = due[0];
            ping(pick.dx, pick.dy, pick.dist);
            pingTimers[pick.id] = 0;
            globalCooldown = minGap;
        }

        // Drop timers for corpses that left range or no longer exist so they
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
