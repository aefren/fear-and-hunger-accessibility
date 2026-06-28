/*:
 * @plugindesc Interactable Elements Menu
 * @param Trigger Key
 * @desc The keycode used to trigger the interactable elements menu
 * @type text
 * @default 73
 *
 * @param Previous Key
 * @desc Keycode to quick-select the PREVIOUS interactable without opening the menu. Default 65 = A.
 * @type text
 * @default 65
 *
 * @param Next Key
 * @desc Keycode to quick-select the NEXT interactable without opening the menu. Default 83 = S.
 * @type text
 * @default 83
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
 * @param Max Range
 * @desc Only list interactables within this many tiles (Manhattan). 0 = no limit
 * (list every interactable on the map).
 * @type number
 * @default 12
 *
 * @param Line Of Sight
 * @desc If true, hide interactables behind a wall (a wall tile sits on the
 * straight line between you and them); they reappear once you round the corner.
 * @type boolean
 * @default true
 *
 * @help
 * Press the trigger key to list interactable elements on the map. Select one
 * with OK (Z / Enter / Space) to start an audio beacon that guides you to it:
 *   - Pan  = horizontal offset (target left/right of the player)
 *   - Pitch = vertical offset (target above = higher, below = lower)
 *   - Repeat rate + volume = distance (closer = faster and louder)
 * The beacon plays a one-shot Arrival Sound and stops when you reach the tile.
 * Press the trigger key again (or cancel in the menu) to stop tracking early.
 *
 * Quick-select (no menu): press the Previous Key (A) / Next Key (S) on the map to
 * cycle through the interactable elements sorted by proximity, hearing each one
 * announced and starting its audio beacon immediately. The list refreshes on
 * every step you take: right after a step, A announces the first (closest)
 * element and S the second; while standing still, A / S walk backward / forward
 * through the list.
 *
 * Two filters (shared by the menu and A/S) keep the list to what you could
 * actually perceive nearby, mirroring EnemySonar:
 *   - Max Range: interactables beyond this Manhattan distance are hidden.
 *   - Line Of Sight: an interactable is hidden if a solid wall tile sits on the
 *     straight line between you and it, so things in adjacent rooms behind a
 *     wall do not show until you round the corner. Wall tiles are read from the
 *     map's passage flags, so this is exact and lighting-agnostic.
 * An already-started beacon is NOT affected by these filters: once you pick a
 * target it keeps guiding you even if it passes behind a wall or out of range.
 */

(function () {
    var parameters = PluginManager.parameters('InteractableElementsMenu');
    var triggerKey = parseInt(parameters['Trigger Key']) || 73;
    var prevKey = parseInt(parameters['Previous Key']) || 65;
    var nextKey = parseInt(parameters['Next Key']) || 83;
    var beaconSound = parameters['Beacon Sound'] || 'Cursor1';
    var arrivalSound = parameters['Arrival Sound'] || 'Bell1';
    // 0 means unlimited, so respect an explicit 0 instead of falling back.
    var maxRangeParam = parameters['Max Range'];
    var maxRange = (maxRangeParam === undefined || maxRangeParam === '') ? 12 : parseInt(maxRangeParam);
    if (isNaN(maxRange)) maxRange = 12;
    var lineOfSight = parameters['Line Of Sight'] !== 'false'; // default on
    var isKeyPressed = false;
    var beaconTimer = 0;
    var trackingTarget = null;
    var trackingMapId = 0;

    // Quick-select cursor: index into the proximity-sorted interactable list,
    // reset to the closest element (0) on every player step so A/S re-evaluate
    // from where the player now stands. quickSelectMapId guards against carrying
    // a stale index across a map transition.
    var quickSelectIndex = 0;
    var quickSelectMapId = 0;

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
        var interactableElements = sortedInteractableElements();

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
            name: deriveEventLabel(element),
            id: element._eventId,
            characterName: element._characterName
        };

        this.addCommand(describeElement(element), elementProjection.id, true, elementProjection);
    }

    // A solid wall for line-of-sight purposes: a tile impassable from every
    // direction. 0x0f = all four passage bits; checkPassage returns false when
    // the tile blocks them all (a wall), true for open floor. Mirrors EnemySonar.
    function isWallTile(x, y) {
        return !$gameMap.checkPassage(x, y, 0x0f);
    }

    // True unless a wall tile sits strictly between player and target. Walks the
    // straight line (Bresenham) and checks every intermediate tile, skipping the
    // two endpoints (the player's own tile and the target's own tile).
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
            if (x === x1 && y === y1) break;   // reached the target: clear path
            if (isWallTile(x, y)) return false; // a wall blocks the view
        }
        return true;
    }

    // Proximity-sorted (closest first) list of interactable elements, filtered to
    // what the player could perceive nearby: within Max Range and (optionally) not
    // hidden behind a wall. Manhattan distance matches the beacon metric; ties
    // break on event id for a stable order. Shared by the menu and the A/S
    // quick-select. The active beacon reads trackingTarget directly, so it is
    // unaffected by this filtering.
    function sortedInteractableElements() {
        var px = $gamePlayer.x;
        var py = $gamePlayer.y;
        var elements = $gameMap.interactableElements().filter(function (e) {
            var dist = Math.abs(e.x - px) + Math.abs(e.y - py);
            if (maxRange > 0 && dist > maxRange) return false;
            if (lineOfSight && !hasLineOfSight(px, py, e.x, e.y)) return false;
            return true;
        });
        elements.sort(function (a, b) {
            var da = Math.abs(a.x - px) + Math.abs(a.y - py);
            var db = Math.abs(b.x - px) + Math.abs(b.y - py);
            return (da - db) || (a._eventId - b._eventId);
        });
        return elements;
    }

    // The spoken/written description of an element: its derived label plus its
    // offset from the player (e.g. "A dead horse... 3 down 2 left, at 9 16").
    function describeElement(element) {
        var label = deriveEventLabel(element);
        var dx = element.x - $gamePlayer.x;
        var dy = element.y - $gamePlayer.y;

        var directions = [];
        if (dy < 0) directions.push(Math.abs(dy) + " up");
        if (dy > 0) directions.push(dy + " down");
        if (dx < 0) directions.push(Math.abs(dx) + " left");
        if (dx > 0) directions.push(dx + " right");

        var relativeText = directions.length > 0 ? " " + directions.join(" ") + "," : "";
        var name = label || "Event " + element._eventId;

        return name + relativeText + " at " + element.x + " " + element.y;
    }

    // Editor event names in F&H are auto-generated (EV039, EV040...) and the
    // interactable objects are usually invisible action triggers laid over a
    // parallax drawing (a barrel, a crate, a corpse) with no sprite to name.
    // The only human-readable identity is the text the event shows when used,
    // so derive the menu label from the event's first "Show Text" line, then
    // fall back to the character sprite name, then to nothing (caller adds the
    // generic "Event N").
    function deriveEventLabel(element) {
        var lists = [];

        // Active page first: respects current switch state (e.g. an opened door
        // showing different text). Guard it — _pageIndex is -1 on erased events.
        try {
            if (typeof element.list === 'function' && element._pageIndex >= 0) {
                lists.push(element.list());
            }
        } catch (e) { /* no active page */ }

        // Then every page, so we still find text even if the active page is silent.
        var data = (typeof element.event === 'function') ? element.event() : null;
        if (data && data.pages) {
            for (var i = 0; i < data.pages.length; i++) {
                lists.push(data.pages[i].list);
            }
        }

        for (var l = 0; l < lists.length; l++) {
            var text = firstTextLine(lists[l]);
            if (text) return cleanLabel(text);
        }

        if (element._characterName) {
            // strip the !$ sprite-mode prefixes and turn underscores into spaces:
            // "$seed_mercenary" -> "seed mercenary", "!Flame" -> "Flame".
            var cn = element._characterName.replace(/^[!$]+/, '').replace(/_/g, ' ').trim();
            if (cn) return cn;
        }

        return null;
    }

    function firstTextLine(list) {
        if (!list) return null;
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            // 401 = a line of a Show Text command. Skip blank lines.
            if (c.code === 401 && c.parameters[0] && c.parameters[0].trim()) {
                return c.parameters[0].trim();
            }
        }
        return null;
    }

    function cleanLabel(text) {
        text = text
            .replace(/\\{1,2}[a-zA-Z]+\[\d+\]/g, '') // \c[n], \v[n], \i[n] escape codes
            .replace(/<[^>]+>/g, ' ')                 // <WordWrap>, <CENTER>, etc.
            .replace(/[\{\}\^]/g, '')                 // size/format escapes
            .replace(/\s+/g, ' ')
            .trim();
        if (text.length > 60) text = text.slice(0, 57) + '...';
        return text;
    }

    function stopTracking() {
        trackingTarget = null;
        beaconTimer = 0;
    }

    function announce(message) {
        if (window.ScreenReaderAccess && window.ScreenReaderAccess.announce) {
            window.ScreenReaderAccess.announce(message, true);
        }
    }

    // Point the audio beacon at a live Game_Event and fire it immediately on the
    // next map frame (the same effect as picking the element from the menu).
    function startTrackingElement(element) {
        trackingTarget = {
            x: element.x,
            y: element.y,
            id: element._eventId,
            name: deriveEventLabel(element)
        };
        trackingMapId = $gameMap.mapId();
        beaconTimer = 9999; // fire on the next frame so the beacon starts at once
    }

    // A / S quick-select: move the cursor through the proximity-sorted list
    // (direction -1 = previous/closer, +1 = next/farther), then announce the
    // element and start its beacon in one go. The cursor was reset to 0 on the
    // last step, so the first A clamps to the closest element and the first S
    // advances to the second.
    function quickSelect(direction) {
        var elements = sortedInteractableElements();
        if (elements.length === 0) {
            announce("No interactable elements");
            return;
        }

        if ($gameMap.mapId() !== quickSelectMapId) {
            quickSelectMapId = $gameMap.mapId();
            quickSelectIndex = 0;
        }

        quickSelectIndex += direction;
        if (quickSelectIndex < 0) quickSelectIndex = 0;
        if (quickSelectIndex > elements.length - 1) quickSelectIndex = elements.length - 1;

        var element = elements[quickSelectIndex];
        announce(describeElement(element));
        startTrackingElement(element);
    }

    // Refresh the quick-select cursor on every real step so A/S always start
    // from the now-closest element.
    var _Game_Player_increaseSteps = Game_Player.prototype.increaseSteps;
    Game_Player.prototype.increaseSteps = function () {
        _Game_Player_increaseSteps.call(this);
        quickSelectIndex = 0;
        quickSelectMapId = $gameMap.mapId();
    };

    document.addEventListener('keydown', function (event) {
        if (event.keyCode !== prevKey && event.keyCode !== nextKey) return;
        if (!(SceneManager._scene instanceof Scene_Map)) return;
        if ($gameMap && $gameMap.isEventRunning()) return;
        event.preventDefault();
        quickSelect(event.keyCode === prevKey ? -1 : 1);
    });

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

    var SOUL_STONE_RE = /soul stone/i;

    // A corpse is an event whose ACTIVE page shows the necromancy prompt but has
    // no battle command -- the same marker CorpseSonar uses, so the two systems
    // stay in sync. Corpses are priority-0 ("below characters") and so fail
    // isNormalPriority(), but they are lootable/raisable and worth including.
    Game_Event.prototype.isCorpseInteractable = function () {
        if (this._pageIndex < 0) return false;
        if (this.x <= 0 || this.y <= 0) return false;
        if (!this.isTriggerIn([0, 1, 2])) return false;
        var page;
        try { page = (typeof this.page === 'function') ? this.page() : null; } catch (e) { return false; }
        if (!page || !page.list) return false;
        for (var i = 0; i < page.list.length; i++) {
            var c = page.list[i];
            if (c.code === 301) return false; // live enemy, not a corpse
            if (c.code === 401 && c.parameters && c.parameters[0]
                && SOUL_STONE_RE.test(c.parameters[0])) return true;
        }
        return false;
    };

    Game_Map.prototype.interactableElements = function () {
        return this.events().filter(function (event) {
            if (event.x <= 0 || event.y <= 0) return false;
            return event.isInteractable() || event.isCorpseInteractable();
        });
    };

    Game_Event.prototype.isInteractable = function () {
        return this.isTriggerIn([0, 1, 2]) && this.isNormalPriority();
    };
})();