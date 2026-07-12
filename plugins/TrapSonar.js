/*:
 * @plugindesc Always-on positional sonar for armed floor traps. Uses the same
 * targets and range as TrapWarning's R scan, and the same sound as SecretSonar.
 * Author: project_accessibility
 *
 * @param Far Interval
 * @type number
 * @default 120
 * @param Near Interval
 * @type number
 * @default 60
 * @param Near Threshold
 * @type number
 * @default 5
 * @param Min Gap
 * @type number
 * @default 30
 * @param Pan Strength
 * @type number
 * @default 110
 * @param Pitch Strength
 * @type number
 * @default 110
 * @param Hearing Range
 * @desc In darkness, traps within this many tiles (Manhattan) still ping --
 * you would hear one underfoot even without seeing it. Beyond it a trap must
 * be lit (the player's own light globe or a burning map light) to ping.
 * @type number
 * @default 2
 *
 * @help
 * TrapWarning defines the shared armed-trap classifier and Max Scan radius.
 * This plugin pings those exact targets. It reads SecretSonar's Secret Sound
 * parameter (Knock by default), so both categories use the same sound.
 * Beyond Hearing Range, a trap only pings while lit -- same rule the rest of
 * the Sonar family follows (see window.AccessibilityLight).
 * Load after TrapWarning.js.
 */
(function () {
    var parameters = PluginManager.parameters('TrapSonar');
    var secretParameters = PluginManager.parameters('SecretSonar');
    var trapSound = secretParameters['Secret Sound'] || 'Knock';
    var farInterval = parseInt(parameters['Far Interval']) || 120;
    var nearInterval = parseInt(parameters['Near Interval']) || 60;
    var nearThreshold = parseInt(parameters['Near Threshold']) || 5;
    var minGap = parseInt(parameters['Min Gap']);
    if (isNaN(minGap)) minGap = 30;
    var panStrength = parseInt(parameters['Pan Strength']);
    if (isNaN(panStrength)) panStrength = 110;
    var pitchStrength = parseInt(parameters['Pitch Strength']);
    if (isNaN(pitchStrength)) pitchStrength = 110;
    var pitchAmp = Math.round(50 * pitchStrength / 100);
    // 0 is a valid choice (no hearing floor), so respect it like Max Scan's 0.
    var hearingRangeParam = parameters['Hearing Range'];
    var hearingRange = (hearingRangeParam === undefined || hearingRangeParam === '') ? 2 : parseInt(hearingRangeParam);
    if (isNaN(hearingRange)) hearingRange = 2;
    var globalCooldown = 0;
    var pingTimers = {};
    var timersMapId = 0;

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

    function ping(dx, dy, dist) {
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * panStrength)));
        var pitchOffset = Math.max(-pitchAmp, Math.min(pitchAmp, Math.round(-dy / 10 * pitchAmp)));
        var volume = Math.max(20, Math.round(60 - (Math.min(dist, 20) / 20) * 40));
        AudioManager.playSe({ name: trapSound, volume: volume, pitch: 100 + pitchOffset, pan: pan });
    }

    function updateSonar() {
        var detector = window.AccessibilityTraps;
        if (!detector || !detector.armedEvents) return;
        var mapId = $gameMap.mapId();
        if (mapId !== timersMapId) {
            timersMapId = mapId;
            pingTimers = {};
            globalCooldown = 0;
        }
        if (globalCooldown > 0) globalCooldown--;
        var px = $gamePlayer.x;
        var py = $gamePlayer.y;
        var traps = detector.armedEvents();
        var seen = {};
        var due = [];
        for (var i = 0; i < traps.length; i++) {
            var ev = traps[i];
            var id = ev._eventId;
            var dx = ev.x - px;
            var dy = ev.y - py;
            var dist = Math.abs(dx) + Math.abs(dy);
            if (dist <= 0 || dist > detector.maxScan) {
                delete pingTimers[id];
                continue;
            }
            // In the dark a sighted player would not perceive this either:
            // beyond hearing distance the trap must be lit (by the player's
            // light globe or a burning map light) to stay on the radar.
            if (dist > hearingRange && !window.AccessibilityLight.isLit(ev.x, ev.y)) {
                delete pingTimers[id];
                continue;
            }
            seen[id] = true;
            var interval = dist <= nearThreshold ? nearInterval : farInterval;
            var timer = pingTimers[id] === undefined ? interval : pingTimers[id] + 1;
            pingTimers[id] = timer;
            if (timer >= interval) due.push({ id: id, dx: dx, dy: dy, dist: dist });
        }
        if (due.length && globalCooldown <= 0) {
            due.sort(function (a, b) { return (a.dist - b.dist) || (a.id - b.id); });
            var target = due[0];
            ping(target.dx, target.dy, target.dist);
            pingTimers[target.id] = 0;
            globalCooldown = minGap;
        }
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
