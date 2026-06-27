/*:
 * @plugindesc Directional "radar" for blind players: while walking it scans ahead
 * in the direction you face and pings what it finds (wall vs interactable),
 * encoding direction in pitch/pan and distance in volume. Toggle with R;
 * hold Ctrl while moving for a quick, momentary radar without toggling.
 * Author: project_accessibility
 *
 * @param Toggle Key
 * @desc Keycode that turns the radar on/off. Default 82 = R ("Radar").
 * @type text
 * @default 82
 *
 * @param Max Scan
 * @desc How many tiles to look ahead in the facing direction before giving up.
 * @type number
 * @default 12
 *
 * @param Wall Sound
 * @desc SE played when the obstacle ahead is a wall (file in audio/se, no ext).
 * @type text
 * @default Earth3
 *
 * @param Interactable Sound
 * @desc SE played when the thing ahead is an interactable event.
 * @type text
 * @default Saint5
 *
 * @param Bump Debounce
 * @desc Frames to wait before re-pinging while held against the same blocked
 * tile (turns/bumps). Steps into open tiles always ping. 60 frames = 1s.
 * @type number
 * @default 30
 *
 * @help
 * Press R to toggle the radar permanently. Hold Ctrl while moving for a quick
 * momentary radar without toggling it on — release Ctrl and it stops. Both
 * activate the same scan: every time the player faces a new direction OR steps
 * forward, the radar looks ahead and plays a ping describing the first obstacle:
 *   - Wall Sound        -> the path is blocked by impassable terrain
 *   - Interactable Sound -> the first thing ahead is an interactable event
 *                           (barrel, crate, corpse, door, NPC...)
 * Direction is encoded the same way as the InteractableElementsMenu beacon:
 *   - Pitch = vertical: facing up is higher, facing down is lower
 *   - Pan   = horizontal: facing left/right pans the sound to that side
 *   - Volume = distance: the closer the obstacle, the louder the ping
 * If nothing is found within Max Scan tiles the radar stays silent (open path).
 *
 * It reads passability and events straight from the engine (Game_Player.canPass,
 * Game_Map.eventsXy), so it is exact regardless of how dark the room is. This
 * complements WallBump (reactive, fires on contact) by giving proactive,
 * ranged feedback as you steer.
 *
 * Load order: place this after ScreenReaderAccess.js (it uses that plugin's
 * window.ScreenReaderAccess.announce API to speak the on/off state).
 */

(function () {
    var parameters = PluginManager.parameters('Radar');
    var toggleKey = parseInt(parameters['Toggle Key']) || 82;
    var maxScan = parseInt(parameters['Max Scan']) || 12;
    var wallSoundName = parameters['Wall Sound'] || 'Earth3';
    var interactSoundName = parameters['Interactable Sound'] || 'Saint5';
    var bumpDebounce = parseInt(parameters['Bump Debounce']) || 30;

    var enabled = false;
    var ctrlHeld = false;    // true while Ctrl is physically held down
    var lastBumpDir = 0;     // facing direction of the last blocked ping
    var bumpCooldown = 0;    // frames remaining before a held bump may re-ping

    function announce(message) {
        if (window.ScreenReaderAccess && window.ScreenReaderAccess.announce) {
            window.ScreenReaderAccess.announce(message, true);
            return;
        }
        var el = document.getElementById('sr-announce-assertive') || document.getElementById('sr-announce');
        if (el) { el.innerText = message; }
    }

    // Is the tile at (x,y) an interactable event we should ping as such?
    // Mirrors WallBump / InteractableElementsMenu: action, event-touch or
    // player-touch triggers. These are the barrels/crates/corpses/doors/NPCs.
    function tileHasInteractable(x, y) {
        var events = $gameMap.eventsXy(x, y);
        for (var i = 0; i < events.length; i++) {
            if (events[i].isTriggerIn([0, 1, 2])) return true;
        }
        return false;
    }

    // Walk forward from the player in direction d. Return the first thing found:
    //   { type: 'interactable'|'wall', dist: tiles }  or  null if the path is
    // open all the way to maxScan.
    function scanAhead(d) {
        var x = $gamePlayer.x;
        var y = $gamePlayer.y;
        for (var count = 1; count <= maxScan; count++) {
            var blocked = !$gamePlayer.canPass(x, y, d);
            var nx = $gameMap.roundXWithDirection(x, d);
            var ny = $gameMap.roundYWithDirection(y, d);

            if (blocked) {
                // Classify the tile we ran into. Account for counter tiles the
                // same way WallBump does (the real target sits one tile beyond).
                var cx = nx, cy = ny;
                if ($gameMap.isCounter(cx, cy)) {
                    cx = $gameMap.roundXWithDirection(cx, d);
                    cy = $gameMap.roundYWithDirection(cy, d);
                }
                if (tileHasInteractable(cx, cy)) {
                    return { type: 'interactable', dist: count };
                }
                return { type: 'wall', dist: count };
            }

            // Open tile: a passable interactable sitting on the path counts too
            // (e.g. a touch trigger you can walk onto).
            if (tileHasInteractable(nx, ny)) {
                return { type: 'interactable', dist: count };
            }

            x = nx;
            y = ny;
        }
        return null; // open as far as the radar can see
    }

    // Encode direction (pitch/pan) and distance (volume), then play the right SE.
    function ping(d, hit) {
        var pitch = 100;
        var pan = 0;
        if (d === 8) pitch = 150;        // up   -> higher
        else if (d === 2) pitch = 70;    // down -> lower
        else if (d === 4) pan = -100;    // left
        else if (d === 6) pan = 100;     // right

        // Closer = louder. ~90 adjacent, fading to ~30 at maxScan.
        var volume = Math.round(90 - ((hit.dist - 1) / maxScan) * 60);
        if (volume < 20) volume = 20;

        var name = (hit.type === 'interactable') ? interactSoundName : wallSoundName;
        AudioManager.playStaticSe({ name: name, volume: volume, pitch: pitch, pan: pan });
    }

    var _Game_Player_moveStraight = Game_Player.prototype.moveStraight;
    Game_Player.prototype.moveStraight = function (d) {
        _Game_Player_moveStraight.call(this, d);
        if (!enabled && !ctrlHeld) return;

        var stepped = this.isMovementSucceeded();
        if (stepped) {
            // A real step into a new tile: always ping, reset any bump throttle.
            lastBumpDir = 0;
            bumpCooldown = 0;
        } else {
            // Turn into / bump against a wall: ping once, then throttle while the
            // key is held in the same direction so it does not machine-gun.
            if (d === lastBumpDir && bumpCooldown > 0) return;
            lastBumpDir = d;
            bumpCooldown = bumpDebounce;
        }

        var hit = scanAhead(d);
        if (hit) ping(d, hit);
    };

    var _Game_Player_update = Game_Player.prototype.update;
    Game_Player.prototype.update = function (sceneActive) {
        _Game_Player_update.call(this, sceneActive);
        if (bumpCooldown > 0) bumpCooldown--;
    };

    document.addEventListener('keydown', function (event) {
        if (event.keyCode === 17) {
            ctrlHeld = true;
            return;
        }
        if (event.keyCode !== toggleKey) return;
        if (!(SceneManager._scene instanceof Scene_Map)) return;
        if ($gameMap && $gameMap.isEventRunning()) return;
        event.preventDefault();
        enabled = !enabled;
        lastBumpDir = 0;
        bumpCooldown = 0;
        announce(enabled ? 'Radar on' : 'Radar off');
    });

    document.addEventListener('keyup', function (event) {
        if (event.keyCode === 17) {
            ctrlHeld = false;
            lastBumpDir = 0;
            bumpCooldown = 0;
        }
    });
})();
