/**
 * ScreenReaderAccess plugin
 * Provides screen readers access to text in the game
 * Author: Craig Brett
 */

(function() {
    var maxNumOfLogEntries = 20;

    var lastLogMessage = null;

    var _srMapPaused = false;

    // New Game character-select screen (Map010) is built entirely from Show Picture
    // commands: each class name + description is an image (text_<class>.rpgmvp) shown
    // as Picture ID 7, with no Window text, so nothing is announced. We map the
    // picture name to the text transcribed verbatim from those images and announce it
    // from the Game_Picture.prototype.show hook below.
    //
    // A translation mod (see isSpanishTranslation) replaces those images with
    // translated ones but keeps the same picture filenames, so the picture name we
    // key off is unchanged -- we just pick the matching transcription per language.
    // Detection is by the INSTALLED game data (System.json terms), not the OS/system
    // locale: a player on an English Windows running the Spanish patch gets Spanish
    // here. Add a new language by adding another map plus a signal in the helper.
    var characterSelectDescriptionsEn = {
        "text_mercenary": "Mercenary. Mercenary, thief, assassin... Whatever brings the silver to the table. Mercenary is known for his dirty tactics in battle and crafty ways of gaining the advantage.",
        "text_knight": "Knight. Knight with pure and righteous ways of the warrior. Having been trained for combat since a child, knight excels in close combat and with different weaponry.",
        "text_darkpriest": "Dark Priest. Bearing no burden on such things as morality and ethics, gives dark priest an edge in blood magic. However, devoting oneself to magic has left his physical body weak.",
        "text_outlander": "Outlander. Hardened in the freezing winds of the north, outlander is an epitome of survival. He knows all the tricks to stay alive even in the most impossible of situations."
    };

    var characterSelectDescriptionsEs = {
        "text_mercenary": "Mercenario. Mercenario, ladrón, asesino... Cualquier cosa que le de ganancias de plata. El mercenario es conocido por sus tácticas sucias en la batalla y sus astutas formas de obtener ventaja.",
        "text_knight": "Caballero. Un caballero con una senda pura y justa de guerrero. Ha sido entrenada para el combate desde niña, lo que le permite destacar en el combate cuerpo a cuerpo con diferentes tipos de armas.",
        "text_darkpriest": "Sacerdote Oscuro. Sin preocuparse por cuestiones de moralidad o ética, el sacerdote oscuro obtiene ventaja con su magia de sangre. Sin embargo, entregarse por completo a la magia ha debilitado su cuerpo físico.",
        "text_outlander": "Forastero. Forjado en los vientos helados del norte, el forastero es el epítome de la supervivencia. Conoce todos los trucos para mantenerse con vida incluso en las situaciones más difíciles e imposibles."
    };

    // Which transcription to speak depends on the game data actually installed, not
    // the OS locale. System.json's `locale` stays en_US even under the Spanish patch,
    // but the translated combat commands do change: terms.commands[0] is "Fight" in
    // the original and "Luchar" in the Spanish translation. $dataSystem is loaded
    // (and never changes) by the time this screen can appear, so we cache the check.
    var _isSpanishTranslation = null;
    function isSpanishTranslation() {
        if (_isSpanishTranslation === null) {
            _isSpanishTranslation = !!($dataSystem && $dataSystem.terms &&
                $dataSystem.terms.commands && $dataSystem.terms.commands[0] === 'Luchar');
        }
        return _isSpanishTranslation;
    }

    // nice easy way to specify the css
    var srOnlyCss = `position: absolute; 
        width: 1px; 
        height: 1px; 
        position: absolute; 
        padding: 0; 
        margin: -1px; 
        overflow: hidden; 
        border: 0;`;

    function createSrAnnounceElement() {
        var srOnlyElement = document.createElement('div');
        srOnlyElement.id = "sr-announce";
        srOnlyElement.setAttribute('aria-live', 'polite');
        srOnlyElement.setAttribute('aria-atomic', 'true');
        srOnlyElement.setAttribute('style', srOnlyCss);
        document.body.appendChild(srOnlyElement);
    }

    // a second live region that interrupts whatever the screen reader is currently
    // saying, for fast navigation where waiting for the previous text to finish is
    // too slow (e.g. arrowing quickly through the character-select screen).
    function createSrAssertiveElement() {
        var srOnlyElement = document.createElement('div');
        srOnlyElement.id = "sr-announce-assertive";
        srOnlyElement.setAttribute('aria-live', 'assertive');
        srOnlyElement.setAttribute('aria-atomic', 'true');
        srOnlyElement.setAttribute('style', srOnlyCss);
        document.body.appendChild(srOnlyElement);
    }

    function createSrLogElement() {
        var logElement = document.createElement('div');
        logElement.id = "sr-log";
        logElement.setAttribute('style', srOnlyCss);
        document.body.appendChild(logElement);
    }

    function getSrElement() {
        return document.getElementById('sr-announce');
    }

    function getSrAssertiveElement() {
        return document.getElementById('sr-announce-assertive');
    }

    function getSrLogElement() {
        return document.getElementById('sr-log');
    }

    function sanitizeForScreenReader(text) {
        // a bunch of these may be Yanfly only, will need a non-Yanfly game to verify
        var displayEscapeCharactersRegex = /[\{\}^]/g;
        var colourOnlyRegex = /\\*c\[\d+\]/g;
        var resetColorRegex = /RESETCOLOR/g;
        var unprintableSymbolsRegex = /[]/g;
        return text
            .replace("<WordWrap>", " ")
            .replace("<SIMPLE>", " ")
            .replace("<CENTER>", " ")
            .replace("<br>", " ")
            .replace("<BR>", " ")
            .replace(resetColorRegex, "")
            .replace(unprintableSymbolsRegex, "")
            .replace(displayEscapeCharactersRegex, "")
            .replace(colourOnlyRegex, "");
    }

    function sanitizeNameBoxText(text) {
        // Yanfly nameboxes come with their own weird formats and no convenient way of just having the plaintext
        var colourOnlyRegex = /\\{1,2}c\[\d+\]/g;
        // have spotted these in the wild where an unprintable character takes over from the "\"
        var malformedColourRegex = /[^ -~]{1,2}c\[\d+\]/g;
        var loneColourRegex = /\\{1,2}c/g;
        var resetColourRegex = /RESETCOLOR/g;
        var nonAlphaNumericOrPunctuationRegex = /[^\w.,?!*_ -]+/g;
        return text
            .replace(colourOnlyRegex, "")
            .replace(malformedColourRegex, "")
            .replace(loneColourRegex, "")
            .replace(resetColourRegex, "")
            .replace(nonAlphaNumericOrPunctuationRegex, "");
    }

    function replaceIconsWithNames(text) {
        var iconRegex = /\\{1,2}[iI]\[(\d+)\]/g;
        return text
            .replace(iconRegex, function (match, iconIndex) {
                var name = findNameByIconIndex(iconIndex);
                if (name) {
                    return name + " ";
                } else {
                    return "";
                }
            });
    }

    function findNameByIconIndex(iconIndex) {
        // since a call to icon will often just rely on the icon's position in the sprite sheet
        // and not necessarily come with any useful context, we have to do a reverse lookup in all the databases
        // to see if we can find the name of the item that the icon is for
        var databases = [
            $dataItems,
            $dataWeapons,
            $dataArmors,
            $dataSkills,
            $dataStates
        ];

        for (var db of databases) {
            var match = db.find(function(item) { return item != null && item.iconIndex == iconIndex });

            if (match) {
                return match.name;
            }
        }

        return null;
    }

    function addToLog(text) {
        var logContainer = getSrLogElement();
        if (logContainer.childElementCount >= maxNumOfLogEntries) {
            // remove the last log entry
            logContainer.removeChild(logContainer.childNodes.item(logContainer.childElementCount - 1));
        }

        if (text == lastLogMessage) {
            return; // duplicate log, possibly caused by override hierarchy
        }

        var entry = document.createElement('div');
        entry.innerText = text;
        logContainer.insertBefore(entry, logContainer.firstChild);
        lastLogMessage = text;
    }

    // Bug fix: a single shared pendingAnnounceTimer used to mean that any two
    // setTextTo() calls landing within the same 10ms window would have the
    // first cancelled by clearTimeout() before it ever reached the live
    // region — it was logged (addToLog) but never spoken. This is not
    // theoretical: RPG Maker's Game_Interpreter runs a synchronous while-loop
    // over event commands within one frame, so e.g. two "Change Items"
    // battle-loot commands in a row (killing a guard for a coin + a weapon,
    // 4.8) fire two setTextTo() calls back to back with zero delay between
    // them — only the second ("Received Meat cleaver") was ever announced,
    // silently swallowing the first ("Received Silver coin"). Same issue for
    // a hit that applies multiple states in one forEach (displayAddedStates).
    //
    // Fix: the polite region gets a real FIFO queue, so every distinct
    // message is eventually spoken in order — nothing is silently dropped.
    // Each queued message still gets the space-reset + 10ms-later-write cycle
    // (see below) so NVDA treats it as its own transition even if the text
    // happens to repeat. The assertive/interrupt region keeps the original
    // "newest wins, cancel whatever's pending" behaviour: it is used
    // deliberately for fast cursor navigation (character select, options,
    // menu status...) where jumping straight to the currently-focused entry
    // is the desired UX, not a queue of everything arrowed past.
    var politeQueue = [];
    var politeTimer = null;

    // Set when a save is loaded so the next fresh Scene_Map announces the area
    // name (the map-name window only opens on transfers, not on load). See the
    // DataManager.loadGame / Scene_Map.onMapLoaded hooks below.
    var pendingAreaAnnounceOnLoad = false;

    function drainPoliteQueue() {
        if (politeQueue.length === 0) {
            politeTimer = null;
            return;
        }
        var message = politeQueue.shift();
        var target = getSrElement();
        target.innerText = " ";
        politeTimer = setTimeout(function() {
            target.innerText = message;
            // Give NVDA a tick to observe this transition before the next
            // queued message overwrites it, so back-to-back announcements
            // are not coalesced into just the last one.
            politeTimer = setTimeout(drainPoliteQueue, 10);
        }, 10);
    }

    function queuePolite(formattedMessage) {
        politeQueue.push(formattedMessage);
        if (politeTimer === null) {
            drainPoliteQueue();
        }
    }

    // Drop anything queued/in-flight in the polite region so it can't speak
    // over (or after) an assertive interrupt.
    function stopPoliteQueue() {
        politeQueue = [];
        if (politeTimer) {
            clearTimeout(politeTimer);
            politeTimer = null;
        }
        getSrElement().innerText = "";
    }

    var assertiveTimer = null;
    function setTextTo(message, interrupt) {
        var formattedMessage = sanitizeForScreenReader(message);
        addToLog(formattedMessage);

        if (interrupt) {
            stopPoliteQueue();
            if (assertiveTimer) {
                clearTimeout(assertiveTimer);
            }
            var target = getSrAssertiveElement();
            // Reset to a single space, then write the real text ~10ms later.
            // NVDA only re-announces a polite/atomic live region when its
            // content actually transitions; a same-tick clear+set (or an
            // empty-string reset) collapses to no net change, so identical
            // text — e.g. re-opening the status menu on the same actor —
            // stays silent. Resetting to a non-empty placeholder and writing
            // on a later tick guarantees two distinct transitions NVDA will
            // speak.
            target.innerText = " ";
            assertiveTimer = setTimeout(function() {
                target.innerText = formattedMessage;
                assertiveTimer = null;
            }, 10);
            return;
        }

        queuePolite(formattedMessage);
    }

    // Public announce API so sibling accessibility plugins (e.g. TrapWarning)
    // can speak through the same sanitize + aria-live path instead of writing to
    // the DOM themselves. interrupt=true routes through the assertive region.
    window.ScreenReaderAccess = window.ScreenReaderAccess || {};
    window.ScreenReaderAccess.announce = function(message, interrupt) {
        setTextTo(message, interrupt);
    };

    // attempted core engine overrides

    // an object containing the original functions
    // used in the override functions to call the underlying code
    var overrides = {
        Game_Picture_show: Game_Picture.prototype.show,
        Window_Message_startMessage: Window_Message.prototype.startMessage,
        Window_ScrollText_startMessage: Window_ScrollText.prototype.startMessage,
        Window_MapName_open: Window_MapName.prototype.open,
        Window_Command_select: Window_Command.prototype.select,
        Window_SkillList_select: Window_SkillList.prototype.select,
        Window_Options_select: Window_Options.prototype.select,
        Window_BattleLog_addText: Window_BattleLog.prototype.addText,
        Window_BattleActor_select: Window_BattleActor.prototype.select,
        Window_BattleEnemy_select: Window_BattleEnemy.prototype.select,
        Window_MenuStatus_select: Window_MenuStatus.prototype.select,
        Window_ItemList_select: Window_ItemList.prototype.select,
        Window_EquipSlot_select: Window_EquipSlot.prototype.select,
        Window_EquipItem_select: Window_EquipItem.prototype.select,
        Window_ShopBuy_select: Window_ShopBuy.prototype.select,
        Window_ShopBuy_select: Window_ShopBuy.prototype.select,
        Window_ShopNumber_changeNumber: Window_ShopNumber.prototype.changeNumber,
        Window_SavefileList_select: Window_SavefileList.prototype.select,
        Window_OptionsCategory_select: typeof Window_OptionsCategory !== 'undefined' ? Window_OptionsCategory.prototype.select : null,
        Window_BattleLog_displayHpDamage: Window_BattleLog.prototype.displayHpDamage,
        Window_BattleLog_displayMpDamage: Window_BattleLog.prototype.displayMpDamage,
        Window_BattleLog_displayTpDamage: Window_BattleLog.prototype.displayTpDamage,
        Window_BattleLog_displayCurrentState: Window_BattleLog.prototype.displayCurrentState,
        Window_BattleLog_displayAddedStates: Window_BattleLog.prototype.displayAddedStates,
        Window_BattleLog_displayRemovedStates: Window_BattleLog.prototype.displayRemovedStates,
        Window_BattleLog_displayAction: Window_BattleLog.prototype.displayAction,
        Window_BattleLog_displayCritical: Window_BattleLog.prototype.displayCritical,
        Window_BattleLog_displayMiss: Window_BattleLog.prototype.displayMiss,
        Window_BattleLog_displayEvasion: Window_BattleLog.prototype.displayEvasion,
        Window_BattleLog_displayFailure: Window_BattleLog.prototype.displayFailure,
        Window_NameInput_select: Window_NameInput.prototype.select,
        Window_NameInput_processCursorMove: Window_NameInput.prototype.processCursorMove,
        Window_NameInput_refresh: Window_NameInput.prototype.refresh,
        Window_NameEdit_initialize: Window_NameEdit.prototype.initialize,
        Window_NameEdit_add: Window_NameEdit.prototype.add,
        Window_NameEdit_back: Window_NameEdit.prototype.back,
        Scene_Map_updateMain: Scene_Map.prototype.updateMain,
        Scene_Map_onMapLoaded: Scene_Map.prototype.onMapLoaded,
        DataManager_loadGame: DataManager.loadGame,
        Game_Interpreter_command126: Game_Interpreter.prototype.command126,
        Game_Interpreter_command127: Game_Interpreter.prototype.command127,
        Game_Interpreter_command128: Game_Interpreter.prototype.command128
    };

    Game_Picture.prototype.show = function(name, origin, x, y, scaleX, scaleY, opacity, blendMode) {
        overrides.Game_Picture_show.call(this, name, origin, x, y, scaleX, scaleY, opacity, blendMode);
        var descriptions = isSpanishTranslation() ? characterSelectDescriptionsEs : characterSelectDescriptionsEn;
        if (descriptions.hasOwnProperty(name)) {
            // interrupt: moving the cursor across classes should jump straight to the
            // newly focused one instead of waiting for the previous description
            setTextTo(descriptions[name], true);
        }
    }

    Window_Message.prototype.startMessage = function() {
        overrides.Window_Message_startMessage.call(this);
        var allText = $gameMessage.allText();
        var output = this.convertEscapeCharacters(allText);
        // in Yanfly message windows, name is separate
        if (typeof Yanfly !== 'undefined' && Yanfly && typeof Yanfly.nameWindow !== 'undefined' && Yanfly.nameWindow && 
                typeof this.hasDifferentNameBoxText !== 'undefined' && this.hasDifferentNameBoxText()) {
            // the _text indicates that it should be private/internal, however, there's no public field for the text, so we'll take it
            var name = sanitizeNameBoxText(Yanfly.nameWindow._text);
            output = `${name}: ${output}`;
        } else if ($gameMessage.faceName()) {
            var actorWithFace = $dataActors.find(function(a) { return a != null && a.faceName == $gameMessage.faceName() });
            var faceText = (actorWithFace) ? actorWithFace.name : $gameMessage.faceName();
            output = `${faceText}: ${output}`;
        }

        setTextTo(output);
    }

    Window_ScrollText.prototype.startMessage = function() {
        overrides.Window_ScrollText_startMessage.call(this);
        var allText = $gameMessage.allText();
        var output = this.convertEscapeCharacters(allText);
        setTextTo(output);
    }

    // Resolve the spoken name of the current area. Prefer the map's editor
    // displayName (123 of 169 F&H maps set a clean, player-facing one like
    // "Level 1 - Entrance"). For the ~46 maps that leave it blank, fall back to
    // the internal MapInfos name (grand_library, The_Void...) cleaned up, but
    // reject obvious placeholders that would read as noise (MAP064, A_set,
    // ---center_square). Returns '' when there is nothing worth announcing.
    function mapAreaName() {
        var display = $gameMap.displayName();
        if (display) return display;
        var info = (typeof $dataMapInfos !== 'undefined' && $dataMapInfos) ? $dataMapInfos[$gameMap.mapId()] : null;
        var internal = info && info.name ? info.name : '';
        if (!internal) return '';
        // placeholder filters: bare "MAP123", tileset stubs "A_set", divider "---foo"
        if (/^map\d+$/i.test(internal)) return '';
        if (/_set$/i.test(internal)) return '';
        if (/^-+/.test(internal)) return '';
        var clean = internal.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
        if (!clean) return '';
        return clean.charAt(0).toUpperCase() + clean.slice(1);
    }

    Window_MapName.prototype.open = function() {
        overrides.Window_MapName_open.call(this);
        var name = mapAreaName();
        if (name) {
            setTextTo(name);
        }
    }

    // The map-name window only opens on a transfer, so loading a save (Continue)
    // would never announce the area you resume in until you next changed maps.
    // Flag the load here and let the next Scene_Map fresh-load speak the name.
    DataManager.loadGame = function(savefileId) {
        var result = overrides.DataManager_loadGame.call(this, savefileId);
        if (result) pendingAreaAnnounceOnLoad = true;
        return result;
    };

    Scene_Map.prototype.onMapLoaded = function() {
        overrides.Scene_Map_onMapLoaded.call(this);
        // Only on a genuine load (not a transfer, where Window_MapName.open
        // already speaks, and not a menu/battle return, which never sets the
        // flag). Consume the flag unconditionally so it can't leak forward.
        if (pendingAreaAnnounceOnLoad) {
            pendingAreaAnnounceOnLoad = false;
            if (!this._transfer) {
                var name = mapAreaName();
                if (name) setTextTo(name);
            }
        }
    };

    // F&H uses abbreviated command names in System.json to save screen space.
    // Expand the known short forms so the screen reader reads the full word.
    var commandNameExpansions = {
        'Q':  'Quit',
        'Sk': 'Skills',
        'Eq': 'Equipment',
        'St': 'Status'
    };

    // DreamX_ChoiceHelp attaches a per-choice explanation (ChoiceMessage /
    // ChoiceHelp comments) that it draws into a separate help/message window the
    // screen reader never sees — e.g. the difficulty-select screen, where each
    // mode ("Fear & Hunger", "Terror & Starvation"…) has a paragraph explaining
    // it. Surface that text so the description is announced with the choice, not
    // just the bare name. Prefer the ChoiceMessage (the real description) and
    // fall back to the ChoiceHelp; ignore the shared prompt otherwise repeated.
    function choiceHelpTextFor(win) {
        if (typeof Window_ChoiceList === 'undefined' || !(win instanceof Window_ChoiceList)) {
            return "";
        }
        if (typeof $gameMessage === 'undefined' || !$gameMessage) {
            return "";
        }
        var idx = win.index();
        var messages = $gameMessage._choiceMessages;
        var helps = $gameMessage._choiceHelps;
        var text = (messages && messages[idx]) || (helps && helps[idx]) || "";
        return text ? win.convertEscapeCharacters(text) : "";
    }

    Window_Command.prototype.select = function(index) {
        overrides.Window_Command_select.call(this, index);
        var command = this.currentData();
        if (command) {
            // Window_ChoiceList entries can contain \N[n] (actor name) and other
            // escape codes, which render correctly on screen via drawTextEx but
            // would otherwise reach the screen reader as literal "\N[4]" text.
            var rawName = this.convertEscapeCharacters(command.name);
            var name = commandNameExpansions[rawName] || rawName;
            var help = choiceHelpTextFor(this);
            setTextTo(help ? name + ". " + help : name);
        }
    }

    Window_SkillList.prototype.select = function(index) {
        overrides.Window_SkillList_select.call(this, index);
        var item = this.item();
        if (item) {
            if (item.description) {
                var description = replaceIconsWithNames(item.description);
                setTextTo(item.name + ": " + description);
            } else {
                setTextTo(item.name);
            }
        }
    }

    // YEP_OptionsCore stores each option's help text (the line shown in the help
    // window at the top of the menu) as a JSON-stringified HelpDesc inside
    // this._symbolData[symbol]. The help window is drawn straight to a bitmap, so a
    // screen reader never sees it; pull the description out here and read it after
    // the option name and value. No-op in vanilla games (no _symbolData).
    function getOptionHelpDesc(optionsWindow) {
        if (!optionsWindow._symbolData) {
            return "";
        }
        var symbol = optionsWindow.commandSymbol(optionsWindow.index());
        var data = symbol ? optionsWindow._symbolData[symbol] : null;
        if (data && data.HelpDesc) {
            try {
                return JSON.parse(data.HelpDesc);
            } catch (e) {
                return "";
            }
        }
        return "";
    }

    Window_Options.prototype.select = function(index) {
        overrides.Window_Options_select.call(this, index);
        var command = this.currentData();
        if (command) {
            var optionText = `${this.commandName(index)}: ${this.statusText(index)}`;
            var helpDesc = getOptionHelpDesc(this);
            if (helpDesc) {
                optionText += ". " + helpDesc;
            }
            // interrupt so arrowing quickly through options jumps straight to the
            // focused one instead of queueing each name + description
            setTextTo(optionText, true);
        }
    }

    // Main menu actor list (Window_MenuStatus). Selecting an actor — when choosing
    // a target for Skill / Equip / Status etc. — is pure cursor movement over face
    // images and drawn stats, nothing a screen reader can read. GALV_BustMenu's
    // cursorUp/cursorDown call this.select(), so hooking select announces whichever
    // actor the cursor lands on: name, level, class, HP/MP and any active states,
    // mirroring drawActorSimpleStatus.
    // Fear & Hunger repurposes each actor's EXP as their Hunger meter: the per-class
    // HUNGER_* common events mirror `actor.EXP` into game variables and trigger the
    // starvation states off it, and GALV_BustMenu draws the EXP gauge relabeled
    // "Hunger" (its `Exp Text` param) above the HP/MP bars. The number the panel shows
    // is `actor.nextRequiredExp()` (exp left inside the level band, e.g. 157 - currentExp
    // for a level-2 Dark Priest), and the gauge fill is that over the band width. Mirror
    // the exact value so the screen reader announces the same "Hunger N" the sighted
    // panel shows. Gated on the bust menu being present; at max level GALV prints its
    // (empty) Max Exp Text instead of a number, so skip it then.
    function describeHunger(actor) {
        if (typeof Galv === "undefined" || !Galv.BM || !Galv.BM.xpText) return null;
        if (actor.isMaxLevel()) return null;
        var label = Galv.BM.xpLabel || "Hunger";
        return label + " " + actor.nextRequiredExp();
    }

    function describeActorStatus(actor) {
        var parts = [actor.name()];
        parts.push("Level " + actor.level);
        if (actor.currentClass()) {
            parts.push(actor.currentClass().name);
        }
        var hunger = describeHunger(actor);
        if (hunger) {
            parts.push(hunger);
        }
        parts.push(TextManager.hp + " " + actor.hp + " of " + actor.mhp);
        parts.push(TextManager.mp + " " + actor.mp + " of " + actor.mmp);
        var states = actor.states();
        if (states && states.length > 0) {
            var stateNames = states
                .map(function(state) { return state.name; })
                .filter(function(name) { return name; });
            if (stateNames.length > 0) {
                parts.push("States: " + stateNames.join(", "));
            }
        }
        return parts.join(". ");
    }

    // The 6 battle params shown in the equip / status panels (params 2..7 =
    // Attack, Defense, M.Attack, M.Defense, Agility, Luck). Those panels are
    // draw-only and never receive focus, so they're read on demand via Tab.
    function describeActorParams(actor) {
        var parts = [];
        for (var p = 2; p <= 7; p++) {
            parts.push($dataSystem.terms.params[p] + " " + actor.param(p));
        }
        return parts.join(". ");
    }

    // Compact party readout for on-demand reading during battle (Tab). The battle
    // status window (Window_BattleStatus) is draw-only and never receives focus,
    // so the only way to hear the whole party's HP/MP/states without spamming on
    // every redraw is to read it on a key, the same way Tab reads the equip panel.
    // Drops level/class/hunger (menu-only context) and keeps the combat-relevant
    // HP, MP and active states for each living battle member.
    function describePartyBattleStatus() {
        var members = $gameParty.battleMembers();
        if (!members || members.length === 0) return "No party members.";
        return members.map(function(actor) {
            var parts = [actor.name()];
            parts.push(TextManager.hp + " " + actor.hp + " of " + actor.mhp);
            parts.push(TextManager.mp + " " + actor.mp + " of " + actor.mmp);
            return parts.join(", ") + describeBattlerStates(actor);
        }).join(". ");
    }

    // Compact enemy readout, the mirror of describePartyBattleStatus for the
    // enemy side (read on demand with Shift+Tab). F&H is front-view: enemies are
    // just sprites with no persistent status panel (OctoBattle's Weakness Display
    // is off and there's no HP-gauge plugin), so the only on-screen enemy info is
    // the target-selection list (Window_BattleEnemy, read on select). The data is
    // still exposed via $gameTroop, so we surface every living enemy's HP and
    // states. Uses enemy.name(), which YEP makes unique per duplicate ("bat A",
    // "bat B"); F&H splits each foe into separately-targetable body parts, each its
    // own member, so this reads e.g. "head: 20 of 20. torso: 35 of 35".
    function describeEnemiesBattleStatus() {
        var members = $gameTroop.aliveMembers();
        if (!members || members.length === 0) return "No enemies.";
        return members.map(function(enemy) {
            return enemy.name() + ": " + enemy.hp + " of " + enemy.mhp + describeBattlerStates(enemy);
        }).join(". ");
    }

    Window_MenuStatus.prototype.select = function(index) {
        overrides.Window_MenuStatus_select.call(this, index);
        var actor = $gameParty.members()[this.index()];
        if (actor) {
            // interrupt so arrowing across actors jumps straight to the focused one
            setTextTo(describeActorStatus(actor), true);
        }
    };

    Window_BattleLog.prototype.addText = function(text) {
        overrides.Window_BattleLog_addText.call(this, text);
        // Yanfly's "simple" action line (BEC, Show Action Text off) pushes the
        // item name tagged <SIMPLE> but drops the actor; our displayAction hook
        // re-announces it with the actor prefixed, so skip the bare line here to
        // avoid speaking the skill name twice.
        if (text && text.indexOf("<SIMPLE>") === 0) return;
        setTextTo(text);
    }

    // Current states on a battler (poison, a severed/disabled limb, etc.), as a
    // trailing clause for the target-select readouts. F&H's enemies are split
    // into separately targetable body parts, so this is often the only extra
    // info on a part beyond its HP.
    function describeBattlerStates(battler) {
        var names = battler.states()
            .filter(function(s) { return s && s.name; })
            .map(function(s) { return s.name; });
        return names.length ? ". " + names.join(", ") : "";
    }

    Window_BattleActor.prototype.select = function(index) {
        overrides.Window_BattleActor_select.call(this, index);
        var actor = this.actor();
        if (actor) {
            // interrupt so arrowing across targets jumps straight to the focused
            // one instead of queueing every target arrowed past (1.6 made the
            // polite region a FIFO queue; without interrupt, holding the cursor
            // key across body parts in battle reads each one in order instead of
            // the one currently under the cursor).
            setTextTo(`${actor.name()}: ${actor.hp} / ${actor.mhp}${describeBattlerStates(actor)}`, true);
        }
    }

    Window_BattleEnemy.prototype.select = function(index) {
        overrides.Window_BattleEnemy_select.call(this, index);
        var enemy = this.enemy();
        if (enemy) {
            // interrupt: same reasoning as Window_BattleActor.select above.
            setTextTo(`${enemy.name()}: ${enemy.hp} / ${enemy.mhp}${describeBattlerStates(enemy)}`, true);
        }
    }

    // Victory loot (4.8). F&H awards no standard rewards: every enemy has exp 0,
    // gold 0 and no drop items, so the vanilla displayExp/Gold/DropItems sequence
    // adds nothing and "X was victorious!" (read via the Window_Message hook) is
    // the whole default victory output. Battle loot is instead handed out by troop
    // battle events via the "Change Items / Weapons / Armors" event commands
    // (codes 126/127/128) — which are silent in vanilla, so a blind player never
    // hears what they picked up after a fight. Announce those gains, gated on
    // $gameParty.inBattle() so map chests (which carry their own Show Text) and
    // item use are untouched. We recompute operateValue after the original ran;
    // it reads the same params/variable so the value matches, and we only speak
    // increases (value > 0).
    function announceBattleItemGain(interpreter, dataArray) {
        if (!$gameParty.inBattle()) return;
        var params = interpreter._params;
        var item = dataArray[params[0]];
        if (!item || !item.name) return;
        var value = interpreter.operateValue(params[1], params[2], params[3]);
        if (value <= 0) return;
        setTextTo("Received " + item.name + (value > 1 ? ", " + value : ""));
    }

    Game_Interpreter.prototype.command126 = function() {
        var result = overrides.Game_Interpreter_command126.call(this);
        announceBattleItemGain(this, $dataItems);
        return result;
    };

    Game_Interpreter.prototype.command127 = function() {
        var result = overrides.Game_Interpreter_command127.call(this);
        announceBattleItemGain(this, $dataWeapons);
        return result;
    };

    Game_Interpreter.prototype.command128 = function() {
        var result = overrides.Game_Interpreter_command128.call(this);
        announceBattleItemGain(this, $dataArmors);
        return result;
    };

    Window_ItemList.prototype.select = function(index) {
        overrides.Window_ItemList_select.call(this, index);
        var item = this.item();

        if (item) {
            var output = `${item.name} 
                ${this.needsNumber() ? ": " + $gameParty.numItems(item) : ""}. 
                ${item.description ? replaceIconsWithNames(item.description) : ""}`;
            setTextTo(output);
        }
    }

    // Equip screen slot list (Weapon / Shield / Head / Body / Accessory). It extends
    // Window_Selectable, so the generic Window_Command hook doesn't reach it. Announce
    // the slot name plus whatever is currently equipped there.
    Window_EquipSlot.prototype.select = function(index) {
        overrides.Window_EquipSlot_select.call(this, index);
        if (this._actor && this.index() >= 0) {
            var equipped = this._actor.equips()[this.index()];
            var output = this.slotName(this.index()) + ": " + (equipped ? equipped.name : "empty");
            if (equipped && equipped.description) {
                output += ". " + replaceIconsWithNames(equipped.description);
            }
            setTextTo(output);
        }
    }

    // Equip item list. Window_EquipItem inherits select from Window_ItemList, but the
    // generic hook only reads the name; on the equip screen the actionable info is how
    // the item changes the actor's stats (the Window_EquipStatus panel is draw-only).
    // Replicate the engine's temp-actor diff (see Window_EquipItem.updateHelp) and read
    // the name plus any params that change. params 2..7 = Attack..Luck.
    Window_EquipItem.prototype.select = function(index) {
        overrides.Window_EquipItem_select.call(this, index);
        if (!this._data || this.index() < 0) {
            return;
        }
        var item = this.item();
        if (!item) {
            // the list includes a null "remove equipment" row
            setTextTo("Remove equipment");
            return;
        }
        var parts = [item.name];
        if (item.description) {
            parts.push(replaceIconsWithNames(item.description));
        }
        if (this._actor && typeof JsonEx !== 'undefined') {
            var tempActor = JsonEx.makeDeepCopy(this._actor);
            tempActor.forceChangeEquip(this._slotId, item);
            for (var p = 2; p <= 7; p++) {
                var oldVal = this._actor.param(p);
                var newVal = tempActor.param(p);
                if (oldVal !== newVal) {
                    parts.push($dataSystem.terms.params[p] + " " + oldVal + " to " + newVal);
                }
            }
        }
        setTextTo(parts.join(". "));
    }

    // Optimize / Clear stay on the command window and only play a sound, so to a
    // screen-reader user they seem to do nothing. Announce the action plus the
    // resulting attributes to confirm the change took effect.
    var _origCommandOptimize = Scene_Equip.prototype.commandOptimize;
    Scene_Equip.prototype.commandOptimize = function() {
        _origCommandOptimize.call(this);
        var actor = this.actor();
        if (actor) {
            setTextTo("Optimized. " + describeActorParams(actor), true);
        }
    };

    var _origCommandClear = Scene_Equip.prototype.commandClear;
    Scene_Equip.prototype.commandClear = function() {
        _origCommandClear.call(this);
        var actor = this.actor();
        if (actor) {
            setTextTo("Equipment cleared. " + describeActorParams(actor), true);
        }
    };

    Window_ShopBuy.prototype.select = function(index) {
        overrides.Window_ShopBuy_select.call(this, index);
        // seems to be a bug in the implementation of ShopBuy.item where it doesn't check for valid index
        var item = this._data && index >= 0 ? this.item() : null;

        if (item) {
            var output = `${item.name}, 
                ${this.price(item)} ${TextManager.currencyUnit}, 
                ${this.isCurrentItemEnabled() ? "" : "unavailable, "}
                ${item.description ? replaceIconsWithNames(item.description) : ""}`;
            setTextTo(output);
        }
    }

    Window_ShopNumber.prototype.changeNumber = function(amount) {
        overrides.Window_ShopNumber_changeNumber.call(this, amount);
        var number = this.number();

        if (number >= 0) {
            var output = `${number}, 
                ${this._price * number} ${TextManager.currencyUnit}`;
            setTextTo(output);
        }
    }

    // YEP_OptionsCore category list (Window_OptionsCategory). Each category (All,
    // General, Audio…) has a HelpDesc stored in its ext data, shown in the help
    // window at the top of the screen — bitmap-only, silent for screen readers.
    // Hook select to append that description after the category name.
    if (typeof Window_OptionsCategory !== 'undefined' && overrides.Window_OptionsCategory_select) {
        Window_OptionsCategory.prototype.select = function(index) {
            overrides.Window_OptionsCategory_select.call(this, index);
            var name = this.currentData() ? this.currentData().name : null;
            if (!name) return;
            var helpDesc = "";
            var ext = this.currentExt ? this.currentExt() : null;
            if (ext && ext.HelpDesc) {
                try { helpDesc = JSON.parse(ext.HelpDesc); } catch(e) {}
            }
            setTextTo(helpDesc ? name + ". " + helpDesc : name, true);
        };
    }

    // Save / load screen (Scene_File). Fear & Hunger's AltSaveScreen builds the slot
    // list with Window_SavefileList, which inherits select from Window_Selectable and
    // draws its contents (file id, title, party faces, playtime) straight to the
    // bitmap — nothing a screen reader can read. Hooking select announces whichever
    // slot the cursor lands on, mirroring Window_SavefileStatus.drawContents.
    function describeSavefile(id) {
        var parts = ["File " + id];
        var info = DataManager.loadSavefileInfo(id);
        if (info) {
            if (info.title) {
                parts.push(info.title);
            }
            if (info.playtime) {
                parts.push("Play time " + info.playtime);
            }
        } else {
            parts.push("Empty");
        }
        return parts.join(". ");
    }

    Window_SavefileList.prototype.select = function(index) {
        overrides.Window_SavefileList_select.call(this, index);
        if (index >= 0) {
            // interrupt so arrowing quickly through slots jumps straight to the
            // focused one instead of queueing each description
            setTextTo(describeSavefile(index + 1), true);
        }
    };

    // Name-entry screen (Scene_Name). Two windows cooperate, neither emits Window
    // text a screen reader can read: Window_NameInput is the character grid the
    // cursor moves over, Window_NameEdit holds the name being assembled.

    // Describe whatever the Window_NameInput cursor is currently sitting on: the
    // "Page" (case-toggle) button, the "OK" confirm button, or a literal character.
    function describeNameInputChar(inputWindow) {
        if (inputWindow.isPageChange && inputWindow.isPageChange()) {
            return "Page";
        }
        if (inputWindow.isOk && inputWindow.isOk()) {
            return "OK";
        }
        // Read the table directly rather than calling character(): the engine's
        // character() throws (Cannot read property '-1' of undefined) when select
        // fires with _index === -1, or before the page row exists.
        var table = (typeof inputWindow.table === 'function') ? inputWindow.table() : null;
        var page = inputWindow._page;
        var index = inputWindow._index;
        if (!table || index == null || index < 0 || !table[page]) {
            return "";
        }
        var ch = table[page][index];
        if (ch === ' ') {
            return "space";
        }
        return ch; // may be '' / undefined for blank cells; caller guards
    }

    Window_NameInput.prototype.select = function(index) {
        overrides.Window_NameInput_select.call(this, index);
        var text = describeNameInputChar(this);
        if (text) {
            // interrupt so arrowing quickly across the grid jumps straight to the
            // newly focused character instead of queueing each one
            setTextTo(text, true);
        }
    };

    // Window_NameInput overrides cursorUp/Down/Left/Right to move _index directly
    // without calling select(), so the select hook above never fires during arrow
    // navigation. processCursorMove runs every frame and is where the engine itself
    // detects a moved cursor, so we announce the newly focused cell (character, or
    // the "Page" / "OK" buttons) here whenever the index actually changes.
    Window_NameInput.prototype.processCursorMove = function() {
        var lastIndex = this._index;
        overrides.Window_NameInput_processCursorMove.call(this);
        if (this._index !== lastIndex) {
            var text = describeNameInputChar(this);
            if (text) {
                setTextTo(text, true);
            }
        }
    };

    Window_NameInput.prototype.refresh = function() {
        overrides.Window_NameInput_refresh.call(this);
        // refresh fires once during initialize (skip it; the edit window announces
        // the opening name) and again on each Page/case toggle, where the cursor
        // stays put but the character underneath it changes and must be re-read.
        if (this._srRefreshReady) {
            // refresh here means a Page toggle happened: the cursor stayed put but
            // the whole character set under it changed, so call out the new page
            // (e.g. the accented-letters page) before reading the focused character.
            var text = describeNameInputChar(this);
            var table = (typeof this.table === 'function') ? this.table() : null;
            var pageInfo = (table && table.length > 1)
                ? "Page " + (this._page + 1) + " of " + table.length + ". "
                : "";
            if (text) {
                setTextTo(pageInfo + text, true);
            }
        }
        this._srRefreshReady = true;
    };

    Window_NameEdit.prototype.initialize = function(actor, maxLength) {
        overrides.Window_NameEdit_initialize.call(this, actor, maxLength);
        if (this._name) {
            setTextTo("Enter name. Current name: " + this._name);
        } else {
            setTextTo("Enter name.");
        }
    };

    Window_NameEdit.prototype.add = function(ch) {
        var added = overrides.Window_NameEdit_add.call(this, ch);
        if (added) {
            setTextTo(this._name, true);
        } else {
            setTextTo("Name is full.", true);
        }
        return added;
    };

    Window_NameEdit.prototype.back = function() {
        var removed = overrides.Window_NameEdit_back.call(this);
        if (removed) {
            setTextTo("Deleted. " + (this._name ? this._name : "Name is empty."), true);
        }
        return removed;
    };

    // Exploration pause (P key). Blind players need time to scan the environment
    // with the interactables menu and decide where to go; sighted players get that
    // time "for free" by seeing the whole screen. P freezes enemies (events) and the
    // encounter counter while leaving the screen reader and the interactables menu
    // fully usable. The pause is blocked during running events so it cannot interrupt
    // cutscenes or dialogue.
    Scene_Map.prototype.updateMain = function() {
        if (_srMapPaused) {
            return;
        }
        overrides.Scene_Map_updateMain.call(this);
    };

    if (typeof Yanfly !== 'undefined' && typeof Imported !== 'undefined' && Imported) {
        // Yanfly overrides

        if (Imported.YEP_BattleEngineCore) {
            // Yanfly's BattleEngineCore allows people to turn off the BattleLog text changes that explain what's happened in a battle
            // which is great visually (I think), but we need that info, so we'll re-implement it here, but only output it to screen readers (if set)
            //
            // Yanfly stores these "Show X Text" params as the *strings* "true" /
            // "false" and reads them with eval() (see YEP_BattleEngineCore). A bare
            // `!Yanfly.Param.BECShowHpText` is therefore always false ("false" is a
            // truthy non-empty string), so these re-emit hooks never installed in
            // F&H (which turns every battle-log text off) — i.e. damage was silent.
            // becShowsText() evaluates the flag the same way Yanfly does.
            function becShowsText(param) {
                return /^\s*true\s*$/i.test(String(param));
            }

            if (!becShowsText(Yanfly.Param.BECShowHpText)) {
                // hp text suppressed
                Window_BattleLog.prototype.displayHpDamage = function (target) {
                    overrides.Window_BattleLog_displayHpDamage.call(this, target);
                    if (target.result().hpAffected) {
                        setTextTo(this.makeHpDamageText(target));
                    }
                }
            }

            if (!becShowsText(Yanfly.Param.BECShowMpText)) {
                // mp text suppressed
                Window_BattleLog.prototype.displayMpDamage = function (target) {
                    overrides.Window_BattleLog_displayMpDamage.call(this, target);
                    if (target.isAlive() && target.result().mpDamage !== 0) {
                        setTextTo(this.makeMpDamageText(target));
                    }
                }
            }

            if (!becShowsText(Yanfly.Param.BECShowTpText)) {
                // tp text suppressed
                Window_BattleLog.prototype.displayTpDamage = function (target) {
                    overrides.Window_BattleLog_displayTpDamage.call(this, target);
                    if (target.isAlive() && target.result().tpDamage !== 0) {
                        setTextTo(this.makeTpDamageText(target));
                    }
                }
            }

            if (!becShowsText(Yanfly.Param.BECShowStateText)) {
                // state text suppressed
                Window_BattleLog.prototype.displayCurrentState = function (subject) {
                    overrides.Window_BattleLog_displayCurrentState.call(this, subject);
                    var stateText = subject.mostImportantStateText();
                    if (stateText) {
                        setTextTo(subject.name() + stateText);
                    }
                }

                Window_BattleLog.prototype.displayAddedStates = function (target) {
                    overrides.Window_BattleLog_displayAddedStates.call(this, target);
                    target.result().addedStateObjects().forEach(function (state) {
                        var stateMsg = target.isActor() ? state.message1 : state.message2;
                        if (stateMsg) {
                            setTextTo(target.name() + stateMsg);
                        }
                    }, this);
                }

                Window_BattleLog.prototype.displayRemovedStates = function (target) {
                    overrides.Window_BattleLog_displayRemovedStates.call(this, target);
                    target.result().removedStateObjects().forEach(function (state) {
                        if (state.message4) {
                            setTextTo(target.name() + state.message4);
                        }
                    }, this);
                }
            }

            // "Show Action Text" off: Yanfly's simple path announces only the item
            // name (tagged <SIMPLE>, which addText now skips) and drops the actor.
            // Re-announce it as "<actor>: <action>" so the user hears who acts and
            // with what. Item name covers both the basic attack and skills/items.
            if (!becShowsText(Yanfly.Param.BECFullActText)) {
                Window_BattleLog.prototype.displayAction = function (subject, item) {
                    overrides.Window_BattleLog_displayAction.call(this, subject, item);
                    if (subject && item) {
                        setTextTo(subject.name() + ": " + item.name);
                    }
                };
            }

            // Critical / miss / evasion / no-effect are all suppressed by F&H's
            // config too. These outcomes are decisive for a blind player (did I
            // land the hit? did it crit?), so re-emit each. The originals stashed
            // in `overrides` are Yanfly's guarded versions (they no-op when the
            // flag is off), so we call them for side effects then speak the result.
            if (!becShowsText(Yanfly.Param.BECShowCritText)) {
                Window_BattleLog.prototype.displayCritical = function (target) {
                    overrides.Window_BattleLog_displayCritical.call(this, target);
                    if (target.result().critical) {
                        setTextTo(target.isActor() ? TextManager.criticalToActor : TextManager.criticalToEnemy);
                    }
                };
            }

            if (!becShowsText(Yanfly.Param.BECShowMissText)) {
                Window_BattleLog.prototype.displayMiss = function (target) {
                    overrides.Window_BattleLog_displayMiss.call(this, target);
                    var fmt = target.result().physical
                        ? (target.isActor() ? TextManager.actorNoHit : TextManager.enemyNoHit)
                        : TextManager.actionFailure;
                    setTextTo(fmt.format(target.name()));
                };
            }

            if (!becShowsText(Yanfly.Param.BECShowEvaText)) {
                Window_BattleLog.prototype.displayEvasion = function (target) {
                    overrides.Window_BattleLog_displayEvasion.call(this, target);
                    var fmt = target.result().physical ? TextManager.evasion : TextManager.magicEvasion;
                    setTextTo(fmt.format(target.name()));
                };
            }

            if (!becShowsText(Yanfly.Param.BECShowFailText)) {
                Window_BattleLog.prototype.displayFailure = function (target) {
                    overrides.Window_BattleLog_displayFailure.call(this, target);
                    if (target.result().isHit() && !target.result().success) {
                        setTextTo(TextManager.actionFailure.format(target.name()));
                    }
                };
            }
        }

        if (Imported.YEP_ItemSynthesis) {
            // Announce the synthesis stats panel (Collected Recipes, Crafted Items…)
            // when the scene opens. Window_SynthesisStatus extends Window_Base so it
            // has no select(); hook refresh() which fires once on scene creation.
            var _origSynthStatusRefresh = Window_SynthesisStatus.prototype.refresh;
            Window_SynthesisStatus.prototype.refresh = function() {
                _origSynthStatusRefresh.call(this);
                var parts = [];
                if (Yanfly.Param.ISColRecipes && Yanfly.Param.ISColRecipes.length > 0) {
                    parts.push(Yanfly.Param.ISColRecipes + ": " +
                        $gameSystem.totalRecipes() + " of " + Yanfly.IS.SynthesisRecipeCount);
                }
                if (Yanfly.Param.ISCraftedItems && Yanfly.Param.ISCraftedItems.length > 0) {
                    parts.push(Yanfly.Param.ISCraftedItems + ": " +
                        $gameSystem.synthedItems().length + " of " + Yanfly.IS.SynthesisItemTotal);
                }
                if (Yanfly.Param.ISCraftedWeapons && Yanfly.Param.ISCraftedWeapons.length > 0) {
                    parts.push(Yanfly.Param.ISCraftedWeapons + ": " +
                        $gameSystem.synthedWeapons().length + " of " + Yanfly.IS.SynthesisWeaponTotal);
                }
                if (Yanfly.Param.ISCraftedArmors && Yanfly.Param.ISCraftedArmors.length > 0) {
                    parts.push(Yanfly.Param.ISCraftedArmors + ": " +
                        $gameSystem.synthedArmors().length + " of " + Yanfly.IS.SynthesisArmorTotal);
                }
                if (parts.length > 0) {
                    setTextTo(parts.join(". "));
                }
            };

            // Announce each recipe as the player navigates the synthesis item list.
            // Window_SynthesisList extends Window_Selectable (not Window_Command) so
            // the generic Window_Command hook doesn't reach it.
            var _origSynthListSelect = Window_SynthesisList.prototype.select;
            Window_SynthesisList.prototype.select = function(index) {
                _origSynthListSelect.call(this, index);
                // Guard: select can fire during scene setup before makeItemList()
                // has populated _data, and with index -1, which would otherwise blow
                // up in item() (this._data[-1] on an undefined _data).
                var item = (this._data && this.index() >= 0) ? this.item() : null;
                if (item) {
                    var text = item.name;
                    if (item.description) {
                        text += ": " + replaceIconsWithNames(item.description);
                    }
                    if (!this.isCurrentItemEnabled()) {
                        text += ". Cannot craft yet.";
                    }
                    setTextTo(text);
                }
            };
        }

        if (Imported.YEP_GabWindow) {
            var originalDrawText = Window_Gab.prototype.drawGabText;
            Window_Gab.prototype.drawGabText = function () {
                originalDrawText.call(this);
                if (this._text && this._text.length > 0) {
                    // GabText events (e.g. HUNGER_of_* common events) embed raw
                    // \N[n] actor-name escape codes; resolve them the same way
                    // drawTextEx does visually, or NVDA reads "N1" literally.
                    setTextTo(this.convertEscapeCharacters(this._text));
                }
            }
        }
    }

    // actually add the sr elements to the game document

    if (document) {
        createSrAnnounceElement();
        createSrAssertiveElement();
        createSrLogElement();

        document.addEventListener('keydown', function(event) {
            if (event.keyCode !== 80) return; // P
            if (!(SceneManager._scene instanceof Scene_Map)) return;
            if ($gameMap && $gameMap.isEventRunning()) return;
            event.preventDefault();
            _srMapPaused = !_srMapPaused;
            setTextTo(_srMapPaused ? "Paused. Enemies frozen." : "Resumed.", true);
        });

        // Tab reads draw-only status panels on demand. In battle Tab reads the whole
        // party's HP/MP/states and Shift+Tab reads every living enemy's HP/states
        // (neither side has a focusable status panel — Window_BattleStatus is
        // draw-only and enemies are sprite-only in this front-view setup, so this is
        // the only way to hear them without spamming on every redraw). In the menu
        // actor scenes Tab reads the current actor's attributes (the equip/status
        // attribute panel is also draw-only). Works in any scene exposing actor()
        // (Equip, Status, Skill — all extend Scene_MenuBase).
        document.addEventListener('keydown', function(event) {
            if (event.keyCode !== 9) return; // Tab
            var scene = SceneManager._scene;
            if (scene instanceof Scene_Battle) {
                event.preventDefault();
                setTextTo(event.shiftKey ? describeEnemiesBattleStatus() : describePartyBattleStatus(), true);
                return;
            }
            if (!scene || typeof scene.actor !== 'function') return;
            var actor = scene.actor();
            if (!actor) return;
            event.preventDefault();
            setTextTo(actor.name() + ". " + describeActorParams(actor), true);
        });

        if (process.versions.chromium) {
            var majorVersionRegex = /^\d+/;
            var majorVersion = parseInt(process.versions.chromium.match(majorVersionRegex));
            if (majorVersion < 65) {
                addToLog(`Warning: The game you are playing is built using an old version of Chromium, ${process.versions.chromium}, which is less than the recommended version, 65. You may face degraded or no support from the screen reader access plugin.`);
            }
        }
    } else {
        console.log("Unable to create sr-only elements: Cannot find document.");
    }
})();
