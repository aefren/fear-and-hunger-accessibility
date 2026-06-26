/*:
 * @plugindesc Interactable Elements Menu
 * @param Trigger Key
 * @desc The keycode used to trigger the interactable elements menu
 * @type text
 * @default 73
 *
 * @param Beacon Sound
 * @desc SE played as the positional tracking beacon (file in audio/se, no extension).
 * @type text
 * @default Cursor1
 *
 * @param Arrival Sound
 * @desc SE played once when the player reaches the tracked element.
 * @type text
 * @default Bell1
 *
 * @help
 * Press the trigger key to list interactable elements on the map. Select one
 * with OK (Z / Enter / Space) to start an audio beacon that guides you to it:
 *   - Pan  = horizontal offset (target left/right of the player)
 *   - Pitch = vertical offset (target above = higher, below = lower)
 *   - Repeat rate + volume = distance (closer = faster and louder)
 * The beacon plays a one-shot Arrival Sound and stops when you reach the tile.
 * Press the trigger key again (or cancel in the menu) to stop tracking early.
 */

(function () {
    var parameters = PluginManager.parameters('InteractableElementsMenu');
    var triggerKey = parseInt(parameters['Trigger Key']) || 73;
    var beaconSound = parameters['Beacon Sound'] || 'Cursor1';
    var arrivalSound = parameters['Arrival Sound'] || 'Bell1';
    var isKeyPressed = false;
    var beaconTimer = 0;
    var trackingTarget = null;
    var trackingMapId = 0;

    var _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);
        if (this.isInteractableElementsMenuTriggered()) {
            if (trackingTarget) {
                stopTracking();
                SoundManager.playCancel();
            } else {
                SceneManager.push(Scene_InteractableElementsMenu);
            }
        }

        if (trackingTarget) {
            updateBeacon();
        }
    };

    document.addEventListener('keypress', function (event) {
        if (event.keyCode === triggerKey) {
            isKeyPressed = true;
        }
    });

    document.addEventListener('keyup', function (event) {
        if (event.keyCode === triggerKey) {
            isKeyPressed = false;
        }
    });

    Scene_Map.prototype.isInteractableElementsMenuTriggered = function () {
        return isKeyPressed;
    };

    function Scene_InteractableElementsMenu() {
        this.initialize.apply(this, arguments);
    }

    Scene_InteractableElementsMenu.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_InteractableElementsMenu.prototype.constructor = Scene_InteractableElementsMenu;

    Scene_InteractableElementsMenu.prototype.initialize = function () {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_InteractableElementsMenu.prototype.create = function () {
        Scene_MenuBase.prototype.create.call(this);
        this.createInteractableElementsWindow();
    };

    Scene_InteractableElementsMenu.prototype.createInteractableElementsWindow = function () {
        if (Utils.RPGMAKER_NAME === "MV") {
            var interactableElementsWindow = new Window_InteractableElementsMenu();
            interactableElementsWindow.setHandler('cancel', interactableElementsWindow.processCancel.bind(interactableElementsWindow));
            this.addWindow(interactableElementsWindow);
        } else if (Utils.RPGMAKER_NAME === "MZ") {
            var rect = new Rectangle(0, 0, 300, 300); // Adjust size as needed
            var interactableElementsWindow = new Window_InteractableElementsMenu(rect);
            interactableElementsWindow.setHandler('cancel', interactableElementsWindow.processCancel.bind(interactableElementsWindow));
            this.addWindow(interactableElementsWindow);
        }
    };

    Scene_InteractableElementsMenu.prototype.processCancel = function () {
        SoundManager.playCancel();
        SceneManager.pop();
    };

    function Window_InteractableElementsMenu() {
        this.initialize.apply(this, arguments);
    }

    Window_InteractableElementsMenu.prototype = Object.create(Window_Command.prototype);
    Window_InteractableElementsMenu.prototype.constructor = Window_InteractableElementsMenu;

    Window_InteractableElementsMenu.prototype.initialize = function (rect) {
        this.filter = "";
        if (Utils.RPGMAKER_NAME === "MV") {
            Window_Command.prototype.initialize.call(this, 0, 0);
            this.select(0);
        } else if (Utils.RPGMAKER_NAME === "MZ") {
            Window_Command.prototype.initialize.call(this, rect);
            this.refresh();
            this.activate();
        }
    };

    Window_InteractableElementsMenu.prototype.numVisibleRows = function () {
        return 10;
    };

    Window_InteractableElementsMenu.prototype.makeCommandList = function () {
        var interactableElements = $gameMap.interactableElements();

        // sortby id
        interactableElements.sort(function (a, b) {
            return a._eventId - b._eventId;
        });

        if (this.filter === "characterName") {
            // update the items to be the interactable elements with a character name
            interactableElements = interactableElements.filter(function (element) {
                return element._characterName && element._characterName != "";
            });
        }

        for (var i = 0; i < interactableElements.length; i++) {
            var element = interactableElements[i];
            this.createCommandFromInteractableElement(element);
        }

        if (this._list.length === 0) {
            this.addCommand("No interactable elements", null, false);
        } else if (this.filter != "") {
            this.addCommand("Show all elements", "", true, { filter: "" });
        } else {
            this.addCommand("Only show elements with a name", "", true, { filter: "characterName" });
        }
    };

    Window_InteractableElementsMenu.prototype.drawItem = function (index) {
        var element = this._list[index];
        if (!element) return;

        var rect = this.itemRect(index);
        this.drawText(element.name, rect.x, rect.y, rect.width);
    };

    Window_InteractableElementsMenu.prototype.processOk = function () {
        var element = this._list[this.index()].ext;
        if (!element) return;

        if (element.filter != undefined) {
            // get the current filter
            var currentFilter = element.filter;
            this.filter = currentFilter;
            this.refresh();
            this.select(0);
            SoundManager.playOk();
            return;
        }

        trackingTarget = element;
        trackingMapId = $gameMap.mapId();
        beaconTimer = 9999; // fire on the next map frame so the beacon starts immediately
        SoundManager.playOk();
        SceneManager.pop();
    };

    Window_InteractableElementsMenu.prototype.processCancel = function () {
        if (trackingTarget) {
            stopTracking();
        }
        SoundManager.playCancel();
        SceneManager.pop();
    };

    Window_InteractableElementsMenu.prototype.createCommandFromInteractableElement = function (element) {
        var elementProjection = {
            x: element.x,
            y: element.y,
            name: element._name,
            id: element._eventId,
            characterName: element._characterName
        };

        var dx = element.x - $gamePlayer.x;
        var dy = element.y - $gamePlayer.y;

        var directions = [];
        if (dy < 0) directions.push(Math.abs(dy) + " up");
        if (dy > 0) directions.push(dy + " down");
        if (dx < 0) directions.push(Math.abs(dx) + " left");
        if (dx > 0) directions.push(dx + " right");

        var relativeText = directions.length > 0 ? " (" + directions.join(" and ") + ")" : "";

        var name = elementProjection.name ||
            (elementProjection.characterName ? "Event " + elementProjection.id + " " + elementProjection.characterName : "Event " + elementProjection.id);

        this.addCommand(name + " at " + element.x + ", " + element.y + relativeText, elementProjection.id, true, elementProjection);
    }

    function stopTracking() {
        trackingTarget = null;
        beaconTimer = 0;
    }

    // Plays a dedicated SE on a repeating interval to guide the player toward
    // trackingTarget. Direction is encoded in pan (horizontal) and pitch
    // (vertical); distance is encoded in the repeat interval and volume.
    function updateBeacon() {
        // Stop if the player left the map the target lives on.
        if ($gameMap.mapId() !== trackingMapId) {
            stopTracking();
            return;
        }

        var player = $gamePlayer;
        // Prefer the live event coords (handles moving NPCs); fall back to the
        // snapshot captured when the menu entry was built.
        var ev = (trackingTarget.id != null) ? $gameMap.event(trackingTarget.id) : null;
        var tx = ev ? ev.x : trackingTarget.x;
        var ty = ev ? ev.y : trackingTarget.y;

        var dx = tx - player.x; // + = target to the right
        var dy = ty - player.y; // + = target below (south)
        var dist = Math.abs(dx) + Math.abs(dy);

        // Reached the target: play a one-shot arrival cue and stop.
        if (dist === 0) {
            AudioManager.playSe({ name: arrivalSound, volume: 90, pitch: 100, pan: 0 });
            stopTracking();
            return;
        }

        var maxDist = 30;
        var d = Math.min(dist, maxDist);
        // Repeat interval: ~12 frames when adjacent, ~90 frames when far.
        var interval = Math.round(12 + (d / maxDist) * 78);

        beaconTimer++;
        if (beaconTimer < interval) return;
        beaconTimer = 0;

        // Pan: full left/right by ~10 tiles of horizontal offset.
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * 100)));
        // Pitch: target above raises pitch, below lowers it (+/- 50 over ~10 tiles).
        var pitchOffset = Math.max(-50, Math.min(50, Math.round(-dy / 10 * 50)));
        var pitch = 100 + pitchOffset;
        // Volume: louder when near (90) fading to quiet when far (30).
        var volume = Math.round(90 - (d / maxDist) * 60);

        AudioManager.playSe({ name: beaconSound, volume: volume, pitch: pitch, pan: pan });
    }

    Game_Map.prototype.interactableElements = function () {
        return this.events().filter(function (event) {
            return event.isInteractable() && event.x > 0 && event.y > 0;
        });
    };

    Game_Event.prototype.isInteractable = function () {
        return this.isTriggerIn([0, 1, 2]) && this.isNormalPriority();
    };
})();