/*:
 * @plugindesc Always-on spatial "sonar" for doors on the map: each door event
 * emits a positional ping (pan = horizontal offset, pitch = vertical offset,
 * volume = distance). Real doors and invisible contact-transfer thresholds use
 * different sounds. Pings once a second, or twice within a few tiles. No toggle.
 * Author: project_accessibility
 *
 * @param Door Sound
 * @desc SE for a REAL door (a door sprite you can see). File in audio/se, no
 * extension.
 * @type text
 * @default Decision1
 *
 * @param Passage Sound
 * @desc SE for an invisible contact transfer (a threshold tile that moves you
 * to the next room when you step on it). File in audio/se, no extension.
 * @type text
 * @default Switch2
 *
 * @param Far Interval
 * @desc Frames between pings for a distant door. 60 frames = 1 second.
 * @type number
 * @default 60
 *
 * @param Near Interval
 * @desc Frames between pings for a near door (<= Near Threshold). 30 = half a second.
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
 * @desc Only ping doors within this many tiles (Manhattan). 0 = no limit
 * (ping every door on the map).
 * @type number
 * @default 10
 *
 * @param Line Of Sight
 * @desc If true, do not ping doors hidden behind a wall (a wall tile sits on
 * the straight line between you and them).
 * @type boolean
 * @default true
 *
 * @param Min Gap
 * @desc Minimum frames between ANY two door pings, so they never overlap. 30 =
 * half a second. When several doors are due at once they queue and sound one
 * at a time, closest first.
 * @type number
 * @default 30
 *
 * @help
 * A sighted player sees doorways and can head straight for the next room; a
 * blind player got no cue that a tile was a door at all — doors fell through as
 * generic "interactables" with no special identity. This plugin gives every
 * door a continuous audio presence, the counterpart of EnemySonar for threats.
 *
 * It is ALWAYS ON (no toggle key). Every frame on the map it scans for doors
 * and, on each one's own timer, plays a spatial ping:
 *   - Pan    = horizontal offset. Far to the right pans hard right; one tile
 *              to the side is almost centred (dx / 10 tiles -> full pan).
 *   - Pitch  = vertical offset. High above raises the pitch, far below lowers
 *              it, barely above is only slightly higher (dy / 10 tiles -> full).
 *   - Volume = distance. The closer the door, the louder the ping.
 * Cadence is per door: once a second normally, twice a second once the door is
 * within Near Threshold tiles, so a door you are approaching speeds up.
 *
 * TWO KINDS OF DOOR, TWO SOUNDS. A scan of the real map data showed the game's
 * "Transfer Player" events fall into distinct groups, so they are classified
 * and given different cues:
 *   - REAL DOOR (Door Sound): the event carries a visible door sprite
 *     ($2door, $door3, $big_door, $gauntlet_door, $elevator...). A door you can
 *     see and that you (usually) operate.
 *   - CONTACT TRANSFER (Passage Sound): an INVISIBLE event that moves you to the
 *     next room when you step on it — the seamless room-edge thresholds. No
 *     sprite, transfer fires on touch/action.
 *
 * Detection (runtime, no hard-coded coordinates): a candidate is an event with
 * a "Transfer Player" command (code 201) on a page the PLAYER can activate
 * (trigger 0 action button, 1 player touch, 2 event touch) — autorun/parallel
 * pages (story cutscene transfers) are ignored. Enemies that yank you to another
 * map are filtered out (any page with "Battle Processing", code 301), since
 * EnemySonar already covers them. Of the survivors: a door-sprite name
 * (door/gate/elevator/mechanism/gauntlet/hatch/ladder/portal) => REAL DOOR; no
 * sprite at all => CONTACT TRANSFER; any other sprite (NPCs like captain/knight,
 * decals like blood/shadows/tileset overlays) is neither and stays silent.
 * Every page is scanned, so a locked/closed door whose transfer hides behind a
 * key/switch still pings — open and closed doors sound alike. Events at (0,0)
 * are ignored.
 *
 * It reads positions straight from the engine, so it works regardless of how
 * dark the room is. It never speaks and never alters movement — it is pure
 * spatial sound.
 *
 * Two filters keep it from leaking doors you could not actually perceive,
 * matching EnemySonar:
 *   - Max Range: doors beyond this Manhattan distance are silent.
 *   - Line Of Sight: a door is silent if a solid wall tile sits on the straight
 *     line between you and it, so doors in adjacent rooms behind a wall do not
 *     ping. Wall tiles are read from the map's passage flags (impassable in
 *     every direction), so this is exact and lighting-agnostic.
 *
 * Load order: place this after ScreenReaderAccess.js (kept with the other
 * accessibility plugins at the end of plugins.js).
 */

(function () {
    var parameters = PluginManager.parameters('DoorSonar');
    var doorSound = parameters['Door Sound'] || 'Decision1';
    var passageSound = parameters['Passage Sound'] || 'Switch2';
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

    // Global throttle: frames remaining before any door may ping again. Ticks
    // down each frame; a ping resets it to minGap so two pings are never closer
    // than half a second and so never overlap, even with many doors in range.
    var globalCooldown = 0;

    // Per-door ping timers, keyed by event id: frames elapsed since the last
    // ping for that door. Rebuilt every frame so absent doors drop out, and
    // cleared on a map change so ids are never carried across maps.
    var pingTimers = {};
    var timersMapId = 0;

    // Sprite names that mark a visible, real door (vs an invisible threshold).
    var DOOR_SPRITE = /door|gate|elevator|mechanism|gauntlet|hatch|ladder|portal/i;

    // Classify a Transfer-Player event into the kind of door it is, or null if
    // it is not a door we should ping. Every page is scanned (not just the active
    // one) so a locked/closed door whose transfer hides on a switch-gated page is
    // still caught — open and closed doors classify alike.
    //   - has "Battle Processing" (301) anywhere  -> enemy, skip (EnemySonar's job)
    //   - "Transfer Player" (201) only on autorun/parallel pages -> forced story
    //     cutscene, not a door the player operates, skip
    //   - of the rest: a door-sprite name  -> 'real' (visible door)
    //                  no sprite at all     -> 'contact' (invisible threshold)
    //                  any other sprite     -> NPC/decal, skip
    // Returns 'real', 'contact', or null. Guards events at (0,0).
    function classifyDoor(event) {
        if (event.x <= 0 || event.y <= 0) return null;
        var data = (typeof event.event === 'function') ? event.event() : null;
        if (!data || !data.pages) return null;

        var playerTransfer = false; // 201 on a player-activatable page (trigger 0/1/2)
        var sprite = '';
        for (var p = 0; p < data.pages.length; p++) {
            var page = data.pages[p];
            var list = page.list;
            var has201 = false;
            if (list) {
                for (var i = 0; i < list.length; i++) {
                    var code = list[i].code;
                    if (code === 301) return null;   // enemy grab/transfer: not a door
                    if (code === 201) has201 = true;
                }
            }
            if (has201 && page.trigger >= 0 && page.trigger <= 2) playerTransfer = true;
            if (!sprite && page.image && page.image.characterName) sprite = page.image.characterName;
        }

        if (!playerTransfer) return null;          // autorun/parallel only: forced transfer
        if (DOOR_SPRITE.test(sprite)) return 'real';
        if (!sprite) return 'contact';
        return null;                               // NPC or decal sprite: not a door
    }

    // Map every door event to { event, kind } so the kind (and its sound) is
    // computed once per scan rather than twice.
    function doorEvents() {
        var out = [];
        var events = $gameMap.events();
        for (var i = 0; i < events.length; i++) {
            var kind = classifyDoor(events[i]);
            if (kind) out.push({ event: events[i], kind: kind });
        }
        return out;
    }

    // A solid wall for line-of-sight purposes: a tile impassable from every
    // direction. 0x0f = all four passage bits; checkPassage returns false when
    // the tile blocks them all (a wall), true for open floor.
    function isWallTile(x, y) {
        return !$gameMap.checkPassage(x, y, 0x0f);
    }

    // True unless a wall tile sits strictly between player and door. Walks the
    // straight line (Bresenham) and checks every intermediate tile, skipping the
    // two endpoints (the player's own tile and the door's own tile).
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
            if (x === x1 && y === y1) break;   // reached the door: clear path
            if (isWallTile(x, y)) return false; // a wall blocks the view
        }
        return true;
    }

    // Spatial ping for one door: pan from horizontal offset, pitch from vertical
    // offset, volume from distance. Mirrors the EnemySonar encoding. The SE name
    // distinguishes a real door from an invisible contact transfer.
    function ping(soundName, dx, dy, dist) {
        // Pan: full left/right at ~10 tiles of horizontal offset; ~10 per tile
        // close in, so one step to the side is nearly centred.
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * 100)));
        // Pitch: above raises, below lowers (+/- 50 over ~10 tiles).
        var pitchOffset = Math.max(-50, Math.min(50, Math.round(-dy / 10 * 50)));
        var pitch = 100 + pitchOffset;
        // Volume: louder near fading to quiet far by ~30 tiles (halved scale).
        var d = Math.min(dist, 30);
        var volume = Math.round(45 - (d / 30) * 30);
        if (volume < 15) volume = 15;

        AudioManager.playSe({ name: soundName, volume: volume, pitch: pitch, pan: pan });
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
        var doors = doorEvents();
        var seen = {};
        var due = []; // doors whose own timer is up and that want to ping now

        for (var i = 0; i < doors.length; i++) {
            var ev = doors[i].event;
            var sound = (doors[i].kind === 'real') ? doorSound : passageSound;
            var id = ev._eventId;
            seen[id] = true;

            var dx = ev.x - px; // + = door to the right
            var dy = ev.y - py; // + = door below (south)
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

            // New doors are due immediately; existing ones tick toward their
            // interval. A door that is due but blocked by the global gap keeps
            // its raised timer (>= interval) so it stays due and pings as soon
            // as the gap opens, rather than restarting its wait.
            var t = (pingTimers[id] === undefined) ? interval : pingTimers[id] + 1;
            pingTimers[id] = t;
            if (t >= interval) due.push({ sound: sound, dx: dx, dy: dy, dist: dist, id: id });
        }

        // Only one door may ping per Min Gap frames, so pings never overlap.
        // When several are due at once, the closest sounds first; the rest wait
        // their turn on the next opening.
        if (due.length > 0 && globalCooldown <= 0) {
            due.sort(function (a, b) { return (a.dist - b.dist) || (a.id - b.id); });
            var pick = due[0];
            ping(pick.sound, pick.dx, pick.dy, pick.dist);
            pingTimers[pick.id] = 0;
            globalCooldown = minGap;
        }

        // Drop timers for doors that left range or no longer exist so they ping
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
