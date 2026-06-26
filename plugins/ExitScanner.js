/*:
 * @plugindesc Announces open exits (passable directions) from the player's
 * current tile, so blind players can sense corridors without bumping into walls.
 * Author: project_accessibility
 *
 * @param Trigger Key
 * @desc Keycode that triggers the exit scan. Default 69 = E ("Exits").
 * @type text
 * @default 69
 *
 * @param Max Scan
 * @desc How many tiles to look ahead in each direction before giving up.
 * @type number
 * @default 12
 *
 * @help
 * Press the trigger key (default E) while walking around the map to hear which
 * of the four cardinal directions are open and how far the corridor runs before
 * a wall blocks it, e.g. "North 5. East 1. South blocked. West blocked."
 *
 * It reads passability straight from the engine (Game_Player.canPass), so it is
 * exact regardless of how dark the room is. Announcements go through
 * ScreenReaderAccess so RPG Maker / Yanfly escape codes are stripped.
 *
 * Load order: place this after ScreenReaderAccess.js (it calls that plugin's
 * window.ScreenReaderAccess.announce API at runtime).
 */

(function () {
    var parameters = PluginManager.parameters('ExitScanner');
    var triggerKey = parseInt(parameters['Trigger Key']) || 69;
    var maxScan = parseInt(parameters['Max Scan']) || 12;

    // RPG Maker numpad-style direction codes paired with a spoken label.
    var DIRECTIONS = [
        { code: 8, label: 'North' },
        { code: 6, label: 'East' },
        { code: 2, label: 'South' },
        { code: 4, label: 'West' }
    ];

    // Walk from the player's tile in direction d, counting passable tiles until a
    // wall (or maxScan) stops us. Returns the number of free tiles ahead.
    function distanceInDirection(d) {
        var x = $gamePlayer.x;
        var y = $gamePlayer.y;
        var count = 0;
        while (count < maxScan) {
            if (!$gamePlayer.canPass(x, y, d)) break;
            x = $gameMap.roundXWithDirection(x, d);
            y = $gameMap.roundYWithDirection(y, d);
            count++;
        }
        return count;
    }

    function announce(message) {
        // Prefer the shared API; fall back to the live region directly so the
        // scanner still works if ScreenReaderAccess changes shape.
        if (window.ScreenReaderAccess && window.ScreenReaderAccess.announce) {
            window.ScreenReaderAccess.announce(message, true);
            return;
        }
        var el = document.getElementById('sr-announce-assertive') || document.getElementById('sr-announce');
        if (el) { el.innerText = message; }
    }

    function scanExits() {
        var parts = [];
        var anyOpen = false;
        for (var i = 0; i < DIRECTIONS.length; i++) {
            var dir = DIRECTIONS[i];
            var dist = distanceInDirection(dir.code);
            if (dist > 0) {
                anyOpen = true;
                parts.push(dir.label + ' ' + dist);
            } else {
                parts.push(dir.label + ' blocked');
            }
        }
        announce(anyOpen ? parts.join('. ') + '.' : 'All directions blocked.');
    }

    document.addEventListener('keydown', function (event) {
        if (event.keyCode !== triggerKey) return;
        if (!(SceneManager._scene instanceof Scene_Map)) return;
        if ($gameMap && $gameMap.isEventRunning()) return;
        event.preventDefault();
        scanExits();
    });
})();
