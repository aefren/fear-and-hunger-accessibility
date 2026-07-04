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
 * @param Hearing Range
 * @desc A/S ONLY: in darkness, elements within this many tiles (Manhattan) are
 * still reachable; beyond it, A/S skips anything not lit by your light or a map
 * light. 0 = A/S ignores lighting. The I menu is never light-gated.
 * @type number
 * @default 2
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
 * What counts as an interactable: any event whose active page the player can
 * trigger (action button or touch) and that is drawn at normal priority, PLUS
 * corpses (Soul stone / Necromancy prompts) and any below/above-priority event
 * whose active page shows text -- F&H paints floor loot, diggable walls,
 * ritual/sacrificial circles, statues and the like as invisible low-priority
 * triggers, and their prompt text doubles as the menu label. Contact ambushes
 * (battle pages), floor-collapse "crack" tiles and silent transfer thresholds
 * are deliberately excluded: those are EnemySonar's, TrapWarning's and
 * DoorSonar's domain, not destinations to guide you onto.
 *
 * SKILL-GATED LISTENING SPOTS only appear once you can use them. The maps are
 * dotted with invisible "Mastery over insects" spots -- hidden cockroaches
 * that whisper lore and hints, but only to a character who has learned that
 * skill (the game gates the whole interaction behind the MASTERY_OVER_INSECTS
 * switch; without it, pressing the action button does nothing at all). Listing
 * them for a skill-less party filled the menu with dozens of phantom entries
 * (one room has 29) that do nothing when reached. They are now hidden until
 * the skill is learned, at which point they appear and can be walked to like
 * any other interactable. Detection is by shape, not by coordinates: an event
 * whose active page's ENTIRE content sits inside "if MASTERY_OVER_INSECTS is
 * ON" branches (empty else), with the switch id resolved by name from the
 * game's own switch list. Events that merely mention the skill but also do
 * something without it (scarab encounters, soul-learning circles) keep their
 * unconditional content and are listed as always.
 *
 * Two filters (shared by the menu and A/S) keep the list to what you could
 * actually perceive nearby, mirroring EnemySonar:
 *   - Max Range: interactables beyond this Manhattan distance are hidden.
 *   - Line Of Sight: an interactable is hidden if a solid wall tile sits on the
 *     straight line between you and it, so things in adjacent rooms behind a
 *     wall do not show until you round the corner. Wall tiles are read from the
 *     map's passage flags, so this is exact and lighting-agnostic.
 *
 * A/S ALSO RESPECTS LIGHT (the menu does not). Fear & Hunger's darkness is real
 * -- TerraxLighting multiplies the screen with a black mask, so a sighted player
 * only makes out what some light globe reaches (a fresh torch ~6 tiles, bare
 * hands ~5, nothing at all in the Terror & Starvation darkness). Because A/S is
 * the quick "what's right around me" glance, it mirrors that: beyond Hearing
 * Range tiles it skips any element that is not lit -- by your own light globe or
 * by a burning map light (a lit candle, a wall torch, a guard patrolling with a
 * torch). So lighting a torch lets A/S reach farther and losing your light pulls
 * it back to arm's length, just like sight. The I menu is deliberately left
 * unfiltered by light: it is a full survey tool you open on purpose, not a
 * glance, so it still lists everything within Max Range. Without TerraxLighting
 * (other games) A/S is not light-gated either.
 *
 * An already-started beacon is NOT affected by any of these filters: once you
 * pick a target it keeps guiding you even if it passes behind a wall, out of
 * range, or into the dark.
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
    // 0 is a valid choice (A/S ignores lighting), so respect it like Max Range's 0.
    var hearingRangeParam = parameters['Hearing Range'];
    var hearingRange = (hearingRangeParam === undefined || hearingRangeParam === '') ? 2 : parseInt(hearingRangeParam);
    if (isNaN(hearingRange)) hearingRange = 2;
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
    //
    // applyLight adds the darkness rule (A/S only, not the survey menu): beyond
    // Hearing Range tiles an element is dropped unless it is lit -- by the
    // player's light globe or a burning map light -- so A/S reaches only as far
    // as a sighted player could make things out. See window.AccessibilityLight.
    function sortedInteractableElements(applyLight) {
        var px = $gamePlayer.x;
        var py = $gamePlayer.y;
        var elements = $gameMap.interactableElements().filter(function (e) {
            var dist = Math.abs(e.x - px) + Math.abs(e.y - py);
            if (maxRange > 0 && dist > maxRange) return false;
            if (lineOfSight && !hasLineOfSight(px, py, e.x, e.y)) return false;
            if (applyLight && dist > hearingRange && !window.AccessibilityLight.isLit(e.x, e.y)) return false;
            return true;
        });
        elements.sort(function (a, b) {
            var da = Math.abs(a.x - px) + Math.abs(a.y - py);
            var db = Math.abs(b.x - px) + Math.abs(b.y - py);
            return (da - db) || (a._eventId - b._eventId);
        });
        return dedupeMultiTile(elements);
    }

    // Collapse a multi-tile object into a single entry. F&H spreads one object
    // over several adjacent action-trigger events (a 2x2 guest book on a table, a
    // long altar, a wide bookshelf), each carrying the same prompt text. Several
    // events that share the SAME label and whose tiles touch (including
    // diagonally) are one object, so a flood-fill groups them and keeps only the
    // representative nearest the player — which, since the input is
    // proximity-sorted, is simply the first member seen. Elements with no
    // derivable label are left as-is (each stays its own entry) so unrelated
    // unnamed triggers are never merged.
    function dedupeMultiTile(elements) {
        var labels = elements.map(deriveEventLabel);
        var used = [];
        var out = [];
        for (var i = 0; i < elements.length; i++) {
            if (used[i]) continue;
            used[i] = true;
            out.push(elements[i]);
            var label = labels[i];
            if (!label) continue; // unnamed: never absorbs its neighbours
            var cluster = [elements[i]];
            for (var c = 0; c < cluster.length; c++) {
                for (var j = i + 1; j < elements.length; j++) {
                    if (used[j] || labels[j] !== label) continue;
                    var touching = Math.max(
                        Math.abs(elements[j].x - cluster[c].x),
                        Math.abs(elements[j].y - cluster[c].y)) <= 1;
                    if (touching) { used[j] = true; cluster.push(elements[j]); }
                }
            }
        }
        return out;
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

    // Live roaming enemies have no useful map text, but their battle page points
    // to a troop. F&H names enemy parts separately ("Guard [torso]",
    // "Guard [head]"), so collapse those to the creature name first. For every
    // other interactable, editor event names are auto-generated (EV039,
    // EV040...) and the objects are usually invisible action triggers laid over
    // a parallax drawing (a barrel, a crate, a corpse) with no sprite to name.
    // The only human-readable identity is the text the event shows when used,
    // so derive the menu label from the event's first "Show Text" line, then
    // fall back to the character sprite name, then to nothing (caller adds the
    // generic "Event N").
    function deriveEventLabel(element) {
        var enemyLabel = deriveLiveEnemyLabel(element);
        if (enemyLabel) return enemyLabel;

        // A corpse's active page shows the "Soul stone" / Necromancy prompt, not
        // who it was — and that prompt only appears for characters who can use the
        // Soul stone, so it is a poor, player-dependent identity. Name the body
        // after the creature/character it was instead (see deriveCorpseLabel).
        if (typeof element.isCorpseInteractable === 'function' && element.isCorpseInteractable()) {
            return deriveCorpseLabel(element);
        }

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

    // Sprites that are a generic gore pile or crowd filler, not a nameable
    // creature. When a corpse's current page shows one of these we skip it and
    // look elsewhere (troop, earlier page, event name) for the identity.
    var CORPSE_GENERIC_SPRITE = /^(flesh|corpsepile|charred_body|characters_dead|husk|skeleton_arms\d*|people\d*)$/i;

    // Name a corpse after the creature/character it was. Priority, most reliable
    // first:
    //   1. the troop on any "Battle Processing" page -> a downed enemy's true name
    //      ("Guard", "Jaggedjaw", "Isayah"). Read across ALL pages, because the
    //      corpse's active page has no battle command any more.
    //   2. the first non-gore character sprite       -> the creature drawing
    //      ("mercenary", "girl", "moonless"), taken from the earliest page so a
    //      looted body now showing $flesh is still named after its owner. This
    //      also rescues events whose name is a copy-paste leftover (a Moonless
    //      body left named "DeadGirl").
    //   3. the event name, stripped of F&H's Dead*/*DEAD and numbering.
    // Falls back to a plain "Corpse". A skeleton keeps its bare name (no "corpse"
    // suffix). Always returns a non-empty string, so a corpse never shows the
    // Soul-stone prompt again.
    function deriveCorpseLabel(element) {
        var data = (typeof element.event === 'function') ? element.event() : null;
        var name = '';

        // 1. Troop name from any battle page.
        if (data && data.pages) {
            var names = [];
            for (var p = 0; p < data.pages.length && names.length === 0; p++) {
                var list = data.pages[p].list;
                if (!list) continue;
                for (var i = 0; i < list.length; i++) {
                    var c = list[i];
                    if (c.code === 301 && c.parameters && c.parameters[0] === 0) {
                        addTroopEnemyNames(names, c.parameters[1]);
                    }
                }
            }
            if (names.length > 0) name = names.join(', ');
        }

        // 2. First non-gore creature sprite.
        if (!name && data && data.pages) {
            for (var q = 0; q < data.pages.length && !name; q++) {
                var img = data.pages[q].image;
                if (img && img.characterName) {
                    var s = img.characterName.replace(/^[!$]+/, '');
                    if (s && !CORPSE_GENERIC_SPRITE.test(s)) {
                        name = s.replace(/_/g, ' ').replace(/\d+$/g, '').trim();
                    }
                }
            }
        }

        // 3. Event name, cleaned of the Dead*/*DEAD / numbering conventions.
        if (!name && data && data.name && !/^EV\d+$/i.test(data.name)) {
            name = data.name
                .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase -> "Dead Knight"
                .replace(/([a-zA-Z])(\d)/g, '$1 $2')   // "guard1" -> "guard 1"
                .replace(/\b(the|dead)\b/gi, ' ')       // drop "the"/"dead" words
                .replace(/\d+/g, ' ')                   // drop bare numbers
                .replace(/\s+/g, ' ')
                .trim();
        }

        name = cleanLabel(name);
        if (!name) return 'Corpse';
        name = name.charAt(0).toUpperCase() + name.slice(1);
        if (/skeleton|corpse|body|remains|carcass/i.test(name)) return name;
        return name + ' corpse';
    }

    // Mirrors EnemySonar's definition of a live roaming enemy: active page,
    // contact trigger, and Battle Processing. Reads the troop's enemies from the
    // database and removes F&H's body-part suffixes, so a guard announces as
    // "Guard" instead of the first silent text/sprite fallback.
    function deriveLiveEnemyLabel(element) {
        if (!element || element._pageIndex < 0) return null;
        var page;
        try {
            page = (typeof element.page === 'function') ? element.page() : null;
        } catch (e) {
            return null;
        }
        if (!page || !page.list) return null;
        if (page.trigger !== 1 && page.trigger !== 2) return null;

        var names = [];
        var hasBattle = false;
        for (var i = 0; i < page.list.length; i++) {
            var c = page.list[i];
            if (c.code !== 301 || !c.parameters) continue;
            hasBattle = true;
            // RPG Maker MV direct troop designation: [0, troopId, canEscape, canLose].
            if (c.parameters[0] !== 0) continue;
            addTroopEnemyNames(names, c.parameters[1]);
        }
        // No Battle Processing on this page: not an enemy, so let the normal
        // text/sprite-derived label win instead of guessing from the fallbacks below.
        if (!hasBattle) return null;
        if (names.length > 0) return cleanLabel(names.join(", "));

        var data = (typeof element.event === 'function') ? element.event() : null;
        if (data && data.name && !/^EV\d+$/i.test(data.name)) {
            var eventName = data.name.replace(/_/g, ' ').replace(/\d+$/g, '').trim();
            if (eventName) return cleanLabel(eventName);
        }

        if (element._characterName) {
            var sprite = element._characterName.replace(/^[!$]+/, '').replace(/_/g, ' ').replace(/\d+$/g, '').trim();
            if (sprite) return cleanLabel(sprite);
        }

        return null;
    }

    function addTroopEnemyNames(names, troopId) {
        if (typeof $dataTroops === 'undefined' || typeof $dataEnemies === 'undefined') return;
        if (!$dataTroops || !$dataEnemies) return;
        var troop = $dataTroops[troopId];
        if (!troop || !troop.members) return;
        for (var i = 0; i < troop.members.length; i++) {
            var member = troop.members[i];
            var enemy = $dataEnemies[member.enemyId];
            if (!enemy || !enemy.name) continue;
            var name = enemy.name.replace(/\s*\[[^\]]+\]/g, '').trim();
            if (name && names.indexOf(name) < 0) names.push(name);
        }
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
        // A/S honours lighting (pass true); the survey menu does not.
        var elements = sortedInteractableElements(true);
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
    // Pre-placed skeletons raised with the Necromancy skill (see CorpseSonar).
    var NECRO_CORPSE_RE = /necromancy on|skeleton here|skeleton sits here|lone skeleton/i;
    function stripCodes(t) {
        return t.replace(/\\[a-z]+\[\d+\]/gi, '').replace(/<[^>]+>/g, ' ');
    }

    // A corpse is an event whose ACTIVE page shows a corpse prompt (Soul stone
    // for player-generated bodies, or a Necromancy/skeleton prompt for pre-placed
    // skeletons) but has no battle command -- the same markers CorpseSonar uses,
    // so the two systems stay in sync. Corpses are priority-0 ("below characters")
    // and so fail isNormalPriority(), but they are lootable/raisable and worth
    // including.
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
            if (c.code === 401 && c.parameters && c.parameters[0]) {
                var line = c.parameters[0];
                if (SOUL_STONE_RE.test(line) || NECRO_CORPSE_RE.test(stripCodes(line))) return true;
            }
        }
        return false;
    };

    // Hazard tiles that show text but are traps, not destinations: the floor-
    // collapse "crack" tiles fire on contact and would otherwise be listed (and
    // the beacon would guide the player straight onto them).
    var HAZARD_RE = /crack underneath your feet/i;

    // Interactables drawn below or above the player (priority 0 or 2) fail
    // isNormalPriority() and so never made the list, yet F&H implements much of
    // its content exactly that way: floor loot ("You pick up a Blue herb."),
    // diggable spots ("The wall feels soft around here."), the ritual and
    // sacrificial circles ("Create a Blood portal?"), statues, planting soil...
    // all invisible action triggers painted into the parallax. Admit an event of
    // ANY priority when its ACTIVE page is player-activatable and shows text --
    // the text doubles as the menu label, and requiring it keeps silent
    // priority-0 events (contact-transfer thresholds, DoorSonar's domain) out.
    // Battle pages (contact ambushes) and known hazards stay excluded: they are
    // threats to warn about (EnemySonar / TrapWarning), not places to guide to.
    Game_Event.prototype.isLowPriorityInteractable = function () {
        if (this._pageIndex < 0) return false;
        if (this.x <= 0 || this.y <= 0) return false;
        if (!this.isTriggerIn([0, 1, 2])) return false;
        var data = (typeof this.event === 'function') ? this.event() : null;
        if (data && data.name && /trap/i.test(data.name)) return false;
        var page;
        try { page = (typeof this.page === 'function') ? this.page() : null; } catch (e) { return false; }
        if (!page || !page.list) return false;
        var hasText = false;
        for (var i = 0; i < page.list.length; i++) {
            var c = page.list[i];
            if (c.code === 301) return false; // contact ambush: not a destination
            if (c.code === 401 && c.parameters && c.parameters[0] && c.parameters[0].trim()) {
                if (HAZARD_RE.test(stripCodes(c.parameters[0]))) return false;
                hasText = true;
            }
        }
        return hasText;
    };

    // "Mastery over insects" listening spots: invisible hidden-cockroach events
    // that whisper lore, but ONLY to a character who has learned that skill --
    // the game wraps the whole interaction in "if MASTERY_OVER_INSECTS switch is
    // ON" and does nothing otherwise. For a skill-less party they are phantom
    // interactables (press the button, nothing happens), so they are hidden
    // until the switch turns on.
    //
    // The switch id is resolved by NAME from the game's own switch list, not
    // hard-coded, so this survives data reshuffles and is simply inert in games
    // without such a switch.
    var insectSwitchId = null; // lazy: -1 = no such switch, feature off

    function insectMasterySwitchId() {
        if (insectSwitchId === null) {
            var switches = ($dataSystem && $dataSystem.switches) || [];
            insectSwitchId = switches.indexOf('MASTERY_OVER_INSECTS');
        }
        return insectSwitchId;
    }

    // A listening spot's active page has a precise shape (verified against all
    // 66 such pages in the game): every top-level command is an "if
    // MASTERY_OVER_INSECTS is ON" branch (code 111 on that switch), its Else is
    // empty, and nothing else sits at the top level. Any unconditional content,
    // any other branch condition, or any Else content means the event does
    // something without the skill, so it is NOT a pure listening spot and stays
    // listed.
    Game_Event.prototype.isInsectListeningSpot = function () {
        var switchId = insectMasterySwitchId();
        if (switchId <= 0) return false;
        if (this._pageIndex < 0) return false;
        var page;
        try { page = (typeof this.page === 'function') ? this.page() : null; } catch (e) { return false; }
        if (!page || !page.list) return false;
        var sawInsectBranch = false;
        var inElse = false;
        for (var i = 0; i < page.list.length; i++) {
            var c = page.list[i];
            if (c.indent === 0) {
                if (c.code === 111) {
                    // Branch must be exactly "switch MASTERY_OVER_INSECTS == ON".
                    if (c.parameters[0] !== 0 || c.parameters[1] !== switchId ||
                        c.parameters[2] !== 0) return false;
                    sawInsectBranch = true;
                    inElse = false;
                } else if (c.code === 411) {
                    inElse = true;
                } else if (c.code === 412) {
                    inElse = false;
                } else if (c.code !== 0) {
                    return false; // unconditional content: works without the skill
                }
            } else if (inElse && c.code !== 0) {
                return false; // Else content: does something without the skill
            }
        }
        return sawInsectBranch;
    };

    Game_Map.prototype.interactableElements = function () {
        return this.events().filter(function (event) {
            if (event.x <= 0 || event.y <= 0) return false;
            // Insect listening spots are silent to a skill-less party: hide
            // them until MASTERY_OVER_INSECTS is on.
            if (event.isInsectListeningSpot() &&
                !$gameSwitches.value(insectMasterySwitchId())) return false;
            return event.isInteractable() || event.isCorpseInteractable() ||
                event.isLowPriorityInteractable();
        });
    };

    Game_Event.prototype.isInteractable = function () {
        return this.isTriggerIn([0, 1, 2]) && this.isNormalPriority();
    };
})();
