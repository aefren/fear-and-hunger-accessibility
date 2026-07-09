/*:
 * @plugindesc Always-on spatial "sonar" for doors on the map: each door event
 * emits a positional ping (pan = horizontal offset, pitch = vertical offset,
 * volume = distance). Real doors and invisible contact-transfer thresholds use
 * different sounds. Pings every two seconds, or once a second within a few tiles. No toggle.
 * Author: project_accessibility
 *
 * @param Door Sound
 * @desc SE for a REAL door (a door sprite you can see). File in audio/se, no
 * extension.
 * @type text
 * @default Transceiver
 *
 * @param Passage Sound
 * @desc SE for an invisible contact transfer (a threshold tile that moves you
 * to the next room when you step on it). File in audio/se, no extension.
 * @type text
 * @default Switch2
 *
 * @param Far Interval
 * @desc Frames between pings for a distant door. 120 frames = 2 seconds.
 * @type number
 * @default 120
 *
 * @param Near Interval
 * @desc Frames between pings for a near door (<= Near Threshold). 60 = one second.
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
 * @desc Only ping doors within this many tiles (Manhattan). 0 = no limit
 * (ping every door on the map).
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
 * Cadence is per door: every two seconds normally, once a second once the door is
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
 * Detection (runtime, no hard-coded coordinates). Two independent signals mark
 * a door, so both kinds are caught:
 *   - A DOOR SPRITE ($door1, $celldoor, $gate, $elevator, $portal, matching
 *     door/gate/elevator/mechanism/gauntlet/hatch/ladder/portal). Most F&H doors
 *     do NOT transfer you directly — you interact, the door plays its open sound
 *     and flips a switch, and a separate tile (or a revealed passage) does the
 *     move. So a visible door sprite is treated as a REAL DOOR on its own, even
 *     with no Transfer Player command, as long as it has a page the PLAYER can
 *     activate (trigger 0 action button, 1 player touch, 2 event touch).
 *   - A "Transfer Player" command (code 201) on a player-activatable page with
 *     NO sprite => CONTACT TRANSFER (the invisible seamless room-edge thresholds).
 * Enemies that yank you to another map are filtered out (any page with "Battle
 * Processing", code 301), since EnemySonar already covers them. A 201 that
 * carries a non-door sprite (NPCs like captain/knight, decals like blood/shadows)
 * is neither and stays silent. Every page is scanned, so a locked/closed door
 * whose transfer or open logic hides behind a key/switch still pings — open and
 * closed doors sound alike. Events at (0,0) are ignored.
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
    var parameters = PluginManager.parameters('DoorSonar');
    var doorSound = parameters['Door Sound'] || 'Transceiver';
    var passageSound = parameters['Passage Sound'] || 'Switch2';
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

    // Classify an event into the kind of door it is, or null if it is not a door
    // we should ping. Every page is scanned (not just the active one) so a
    // locked/closed door whose open logic hides on a switch-gated page is still
    // caught — open and closed doors classify alike.
    //   - has "Battle Processing" (301) anywhere  -> enemy, skip (EnemySonar's job)
    //   - a door-sprite name on a player-activatable page -> 'real' (visible door),
    //     whether or not it carries a Transfer Player command: most F&H doors open
    //     via a switch and let a separate tile do the transfer.
    //   - else, a "Transfer Player" (201) on a player-activatable page with no
    //     sprite -> 'contact' (invisible seamless threshold).
    //   - anything else (autorun/parallel-only transfer, or a transfer under an
    //     NPC/decal sprite) -> skip.
    // A player-activatable page is trigger 0 (action button), 1 (player touch) or
    // 2 (event touch); autorun/parallel pages (story cutscenes) do not count.
    // Returns 'real', 'contact', or null. Guards events at (0,0).
    function classifyDoor(event) {
        if (event.x <= 0 || event.y <= 0) return null;
        var data = (typeof event.event === 'function') ? event.event() : null;
        if (!data || !data.pages) return null;

        var playerPage = false;     // any page the player can activate (trigger 0/1/2)
        var playerTransfer = false; // 201 on such a page
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
            var playerActivatable = page.trigger >= 0 && page.trigger <= 2;
            if (playerActivatable) playerPage = true;
            if (has201 && playerActivatable) playerTransfer = true;
            if (!sprite && page.image && page.image.characterName) sprite = page.image.characterName;
        }

        // A visible door sprite is a real door on its own — no transfer required.
        if (DOOR_SPRITE.test(sprite) && playerPage) return 'real';
        if (!playerTransfer) return null;          // no door sprite and no player transfer
        if (!sprite) return 'contact';             // invisible threshold
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

    // Collapse a multi-tile door into a single ping. F&H draws many doors as two
    // or more tiles — stacked halves ($door2 + $door2_2), a big double door
    // ($big_doorL + $big_doorR) — and a wide contact threshold as a whole row of
    // tiles. Doors of the SAME kind whose tiles touch (including diagonally) are
    // one physical door, so a flood-fill groups them and keeps a single
    // representative: the tile nearest the player, so the ping points at the
    // closest edge. Without this a two-tile door pings twice from adjacent tiles.
    function dedupeDoors(doors, px, py) {
        var used = [];
        var out = [];
        for (var i = 0; i < doors.length; i++) {
            if (used[i]) continue;
            used[i] = true;
            var cluster = [doors[i]];
            for (var c = 0; c < cluster.length; c++) {
                for (var j = i + 1; j < doors.length; j++) {
                    if (used[j] || doors[j].kind !== cluster[c].kind) continue;
                    var touching = Math.max(
                        Math.abs(doors[j].event.x - cluster[c].event.x),
                        Math.abs(doors[j].event.y - cluster[c].event.y)) <= 1;
                    if (touching) { used[j] = true; cluster.push(doors[j]); }
                }
            }
            // Representative: the cluster tile closest to the player (tie-break id).
            var best = cluster[0];
            var bestD = Math.abs(best.event.x - px) + Math.abs(best.event.y - py);
            for (var k = 1; k < cluster.length; k++) {
                var d = Math.abs(cluster[k].event.x - px) + Math.abs(cluster[k].event.y - py);
                if (d < bestD || (d === bestD && cluster[k].event._eventId < best.event._eventId)) {
                    best = cluster[k];
                    bestD = d;
                }
            }
            out.push(best);
        }
        return out;
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
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * panStrength)));
        // Pitch: above raises, below lowers (+/- pitchAmp over ~10 tiles).
        var pitchOffset = Math.max(-pitchAmp, Math.min(pitchAmp, Math.round(-dy / 10 * pitchAmp)));
        var pitch = 100 + pitchOffset;
        // Volume: louder near fading to quiet far by ~30 tiles (halved scale).
        var d = Math.min(dist, 30);
        var volume = Math.round(30 - (d / 30) * 20);
        if (volume < 10) volume = 10;

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
        var doors = dedupeDoors(doorEvents(), px, py);
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
