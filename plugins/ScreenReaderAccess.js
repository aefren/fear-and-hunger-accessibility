/**
 * ScreenReaderAccess plugin
 * Provides screen readers access to text in the game
 * Author: Craig Brett
 */

(function() {
    var maxNumOfLogEntries = 20;

    var lastLogMessage = null;

    // New Game character-select screen (Map010) is built entirely from Show Picture
    // commands: each class name + description is an image (text_<class>.rpgmvp) shown
    // as Picture ID 7, with no Window text, so nothing is announced. We map the
    // picture name to the text transcribed verbatim from those images and announce it
    // from the Game_Picture.prototype.show hook below.
    var characterSelectDescriptions = {
        "text_mercenary": "Mercenary. Mercenary, thief, assassin... Whatever brings the silver to the table. Mercenary is known for his dirty tactics in battle and crafty ways of gaining the advantage.",
        "text_knight": "Knight. Knight with pure and righteous ways of the warrior. Having been trained for combat since a child, knight excels in close combat and with different weaponry.",
        "text_darkpriest": "Dark Priest. Bearing no burden on such things as morality and ethics, gives dark priest an edge in blood magic. However, devoting oneself to magic has left his physical body weak.",
        "text_outlander": "Outlander. Hardened in the freezing winds of the north, outlander is an epitome of survival. He knows all the tricks to stay alive even in the most impossible of situations."
    };

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

    function setTextTo(message, interrupt) {
        var formattedMessage = sanitizeForScreenReader(message);
        if (interrupt) {
            // drop anything queued in the polite region so it can't speak over us,
            // then write to the assertive region to cut off current speech
            getSrElement().innerText = "";
            getSrAssertiveElement().innerText = "";
            getSrAssertiveElement().innerText = formattedMessage;
        } else {
            getSrElement().innerText = "";
            getSrElement().innerText = formattedMessage;
        }
        addToLog(formattedMessage);
    }

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
        Window_ItemList_select: Window_ItemList.prototype.select,
        Window_ShopBuy_select: Window_ShopBuy.prototype.select,
        Window_ShopBuy_select: Window_ShopBuy.prototype.select,
        Window_ShopNumber_changeNumber: Window_ShopNumber.prototype.changeNumber,
        Window_BattleLog_displayHpDamage: Window_BattleLog.prototype.displayHpDamage,
        Window_BattleLog_displayMpDamage: Window_BattleLog.prototype.displayMpDamage,
        Window_BattleLog_displayTpDamage: Window_BattleLog.prototype.displayTpDamage,
        Window_BattleLog_displayCurrentState: Window_BattleLog.prototype.displayCurrentState,
        Window_BattleLog_displayAddedStates: Window_BattleLog.prototype.displayAddedStates,
        Window_BattleLog_displayRemovedStates: Window_BattleLog.prototype.displayRemovedStates,
        Window_NameInput_select: Window_NameInput.prototype.select,
        Window_NameInput_processCursorMove: Window_NameInput.prototype.processCursorMove,
        Window_NameInput_refresh: Window_NameInput.prototype.refresh,
        Window_NameEdit_initialize: Window_NameEdit.prototype.initialize,
        Window_NameEdit_add: Window_NameEdit.prototype.add,
        Window_NameEdit_back: Window_NameEdit.prototype.back
    };

    Game_Picture.prototype.show = function(name, origin, x, y, scaleX, scaleY, opacity, blendMode) {
        overrides.Game_Picture_show.call(this, name, origin, x, y, scaleX, scaleY, opacity, blendMode);
        if (characterSelectDescriptions.hasOwnProperty(name)) {
            // interrupt: moving the cursor across classes should jump straight to the
            // newly focused one instead of waiting for the previous description
            setTextTo(characterSelectDescriptions[name], true);
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

    Window_MapName.prototype.open = function() {
        overrides.Window_MapName_open.call(this);
        if ($gameMap.displayName()) {
            setTextTo($gameMap.displayName());
        }
    }

    Window_Command.prototype.select = function(index) {
        overrides.Window_Command_select.call(this, index);
        var command = this.currentData();
        if (command) {
            setTextTo(command.name);
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

    Window_Options.prototype.select = function(index) {
        overrides.Window_Options_select.call(this, index);
        var command = this.currentData();
        if (command) {
            var optionText = `${this.commandName(index)}: ${this.statusText(index)}`;
            setTextTo(optionText);
        }
    }

    Window_BattleLog.prototype.addText = function(text) {
        overrides.Window_BattleLog_addText.call(this, text);
        setTextTo(text);
    }

    Window_BattleActor.prototype.select = function(index) {
        overrides.Window_BattleActor_select.call(this, index);
        var actor = this.actor();
        if (actor) {
            setTextTo(`${actor.name()}: ${actor.hp} / ${actor.mhp}`);
        }
    }

    Window_BattleEnemy.prototype.select = function(index) {
        overrides.Window_BattleEnemy_select.call(this, index);
        var enemy = this.enemy();
        if (enemy) {
            setTextTo(`${enemy.name()}: ${enemy.hp} / ${enemy.mhp}`);
        }
    }

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

    if (typeof Yanfly !== 'undefined' && typeof Imported !== 'undefined' && Imported) {
        // Yanfly overrides

        if (Imported.YEP_BattleEngineCore) {
            // Yanfly's BattleEngineCore allows people to turn off the BattleLog text changes that explain what's happened in a battle
            // which is great visually (I think), but we need that info, so we'll re-implement it here, but only output it to screen readers (if set)
            if (!Yanfly.Param.BECShowHpText) {
                // hp text suppressed
                Window_BattleLog.prototype.displayHpDamage = function (target) {
                    overrides.Window_BattleLog_displayHpDamage.call(this, target);
                    if (target.result().hpAffected) {
                        setTextTo(this.makeHpDamageText(target));
                    }
                }
            }

            if (!Yanfly.Param.BECShowMpText) {
                // mp text suppressed
                Window_BattleLog.prototype.displayMpDamage = function (target) {
                    overrides.Window_BattleLog_displayMpDamage.call(this, target);
                    if (target.isAlive() && target.result().mpDamage !== 0) {
                        setTextTo(this.makeMpDamageText(target));
                    }
                }
            }

            if (!Yanfly.Param.BECShowTpText) {
                // tp text suppressed
                Window_BattleLog.prototype.displayTpDamage = function (target) {
                    overrides.Window_BattleLog_displayTpDamage.call(this, target);
                    if (target.isAlive() && target.result().tpDamage !== 0) {
                        setTextTo(this.makeTpDamageText(target));
                    }
                }
            }

            if (!Yanfly.Param.BECShowStateText) {
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
        }

        if (Imported.YEP_GabWindow) {
            var originalDrawText = Window_Gab.prototype.drawGabText;
            Window_Gab.prototype.drawGabText = function () {
                originalDrawText.call(this);
                if (this._text && this._text.length > 0) {
                    setTextTo(this._text);
                }
            }
        }
    }

    // actually add the sr elements to the game document

    if (document) {
        createSrAnnounceElement();
        createSrAssertiveElement();
        createSrLogElement();

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
