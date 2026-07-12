/*:
 * @plugindesc Sonar sounds tutorial menu (Shift+S): a browsable list of every
 * accessibility sonar sound. Arrow through the entries to hear what each sound
 * is called and what it marks on the map; press OK to play the sound itself.
 * Bilingual (English / community Spanish translation), auto-detected.
 * Author: project_accessibility
 *
 * @param Trigger Key
 * @desc Keycode that opens the tutorial menu (with Shift held). Default 83 = S,
 * so the shortcut is Shift+S.
 * @type text
 * @default 83
 *
 * @param Require Shift
 * @desc If true, the trigger key only opens the menu while Shift is held
 * (Shift+S). Plain S stays the quick-select key of InteractableElementsMenu.
 * @type boolean
 * @default true
 *
 * @param Volume
 * @desc Volume the sample sounds are played at (0-100). Played centred
 * (pan 0) at normal pitch, louder than in-game so each sound is heard clearly.
 * @type number
 * @default 90
 *
 * @help
 * The accessibility mod surrounds the player with sonar pings: enemies,
 * doors, containers, corpses, fires, notes... each has its own sound, but a
 * new player has no way to learn WHICH sound means WHAT except by trial and
 * error in a game that punishes error with death. This menu is the missing
 * legend: a tutorial listing every sonar sound with a spoken explanation of
 * what it marks on the map, and the sound itself on demand.
 *
 * Press Shift+S on the map to open it (press again, or Escape, to close).
 * Up / Down arrows move through the entries; each announces its title and
 * what it represents (e.g. fire marks the furnace, candles, bonfires and
 * torches; containers are crates, barrels, urns, bookshelves...). Press
 * Enter, Space or Z on an entry to play its actual sonar sound, centred and
 * at a clear volume. Play it as many times as you like; the menu stays open.
 *
 * The list covers the whole sound vocabulary of the mod, including the two
 * plugins that carry TWO sounds each: DoorSonar (visible door vs invisible
 * passage threshold) and WallBump (plain wall vs interactable object), plus
 * the A/S tracking beacon of InteractableElementsMenu, so every distinct
 * sound has its own entry.
 *
 * SOUNDS STAY IN SYNC WITH YOUR SETTINGS. Each entry reads the sound file
 * from the source plugin's own parameters at play time (falling back to that
 * plugin's shipped default), so if you retune a sonar's sound in the plugin
 * manager the tutorial automatically plays the new one.
 *
 * BILINGUAL. Titles, descriptions and the opening instructions exist in
 * English and Spanish. Which language speaks is decided by the game data
 * actually installed, not the OS locale (System.json's locale stays en_US
 * under the Spanish patch): the community Spanish translation changes the
 * first combat command to "Luchar", the same signal ScreenReaderAccess keys
 * off for the character-select transcriptions. Add a language by adding
 * another text block plus a signal here and in ScreenReaderAccess.
 *
 * Load order: place this after ScreenReaderAccess.js (kept with the other
 * accessibility plugins at the end of plugins.js). InteractableElementsMenu's
 * A/S quick-select ignores shifted presses, so Shift+S is exclusively this
 * menu's shortcut.
 */

(function () {
    var parameters = PluginManager.parameters('SonarTutorialMenu');
    var triggerKey = parseInt(parameters['Trigger Key']) || 83;
    var requireShift = parameters['Require Shift'] !== 'false'; // default on
    var volume = parseInt(parameters['Volume']);
    if (isNaN(volume)) volume = 90;

    // Which language to speak depends on the game data actually installed, not
    // the OS locale. Same detection (and caching) as ScreenReaderAccess:
    // terms.commands[0] is "Fight" in the original and "Luchar" in the
    // community Spanish translation. $dataSystem is loaded by the time the map
    // (and so this menu) can appear.
    var _isSpanishTranslation = null;
    function isSpanishTranslation() {
        if (_isSpanishTranslation === null) {
            _isSpanishTranslation = !!($dataSystem && $dataSystem.terms &&
                $dataSystem.terms.commands && $dataSystem.terms.commands[0] === 'Luchar');
        }
        return _isSpanishTranslation;
    }

    // The sound legend. One entry per DISTINCT sound in the mod's vocabulary:
    // DoorSonar and WallBump each contribute two. `plugin` + `param` name the
    // source plugin's sound parameter so a retuned sound is picked up live;
    // `fallback` mirrors that plugin's shipped @default for when the parameter
    // is untouched or the plugin is absent. Descriptions summarise each
    // plugin's own detection rules (see their @plugindesc headers).
    var ENTRIES = [
        {
            plugin: 'AltarSonar', param: 'Altar Sound', fallback: 'scissors1',
            en: 'Altar sonar: ritual circles, blood portals and the altar of darkness.',
            es: 'Sonar de altares: círculos rituales, portales de sangre y el altar de la oscuridad.'
        },
        {
            plugin: 'CageSonar', param: 'Cage Sound', fallback: 'chainwrapping_01_richardemoore',
            en: 'Cage sonar: cages holding a captive you can free.',
            es: 'Sonar de jaulas: jaulas con un cautivo al que puedes liberar.'
        },
        {
            plugin: 'ContainerSonar', param: 'Container Sound', fallback: 'Decision2',
            en: 'Container sonar: searchable furniture with loot: crates, barrels, urns, bookshelves, shelves and kitchen tables.',
            es: 'Sonar de contenedores: muebles registrables con botín: cajas, barriles, urnas, estanterías y mesas de cocina.'
        },
        {
            plugin: 'CorpseSonar', param: 'Corpse Sound', fallback: 'kaaw_deathd_01_michel88',
            en: 'Corpse sonar: dead bodies you can examine or loot.',
            es: 'Sonar de cadáveres: cuerpos que puedes examinar o saquear.'
        },
        {
            plugin: 'DoorSonar', param: 'Door Sound', fallback: 'Transceiver',
            en: 'Door sonar: visible doors you can open.',
            es: 'Sonar de puertas: puertas visibles que puedes abrir.'
        },
        {
            plugin: 'DoorSonar', param: 'Passage Sound', fallback: 'Switch2',
            en: 'Passage sonar: invisible thresholds that carry you to the next room when you step on them.',
            es: 'Sonar de pasajes: umbrales invisibles que te llevan a la siguiente sala al pisarlos.'
        },
        {
            plugin: 'EnemySonar', param: 'Enemy Sound', fallback: 'Cursor2',
            en: 'Enemy sonar: living enemies roaming the map.',
            es: 'Sonar de enemigos: enemigos vivos que recorren el mapa.'
        },
        {
            plugin: 'FireSonar', param: 'Fire Sound', fallback: 'fireball_334234__liamg-sfx__fireball-cast-1_01_01',
            en: 'Fire sonar: fire and light sources: the furnace, and the candles, beacons, bonfires and torches you can light.',
            es: 'Sonar de fuego: fuentes de fuego y luz: el horno, y las velas, faros, hogueras y antorchas que puedes encender.'
        },
        {
            plugin: 'ItemSonar', param: 'Item Sound', fallback: 'grind2',
            en: 'Item sonar: loose loot on the ground: herbs, dried mushrooms and shining objects.',
            es: 'Sonar de objetos: botín suelto en el suelo: hierbas, setas secas y objetos brillantes.'
        },
        {
            plugin: 'NoteSonar', param: 'Note Sound', fallback: 'needle_worm2_234679__tessaah__scissor-cutting-paper_01',
            en: 'Note sonar: readable notes, diaries, guest books, documents and inscriptions.',
            es: 'Sonar de notas: notas legibles, diarios, libros de visitas, documentos e inscripciones.'
        },
        {
            plugin: 'SacrificeSonar', param: 'Sacrifice Sound', fallback: 'Magic1',
            en: 'Sacrifice sonar: sacrificial circles for the older gods, the big red circles with the instruction stand.',
            es: 'Sonar de sacrificios: círculos de sacrificio para los dioses antiguos, los grandes círculos rojos con atril de instrucciones.'
        },
        {
            plugin: 'SecretSonar', param: 'Secret Sound', fallback: 'Knock',
            en: 'Secret sonar: hidden diggable or breakable spots: soft walls, soft ground and loose rocks.',
            es: 'Sonar de secretos: puntos ocultos que puedes excavar o abrir: paredes blandas, suelo blando y rocas sueltas.'
        },
        {
            plugin: 'SecretSonar', param: 'Secret Sound', fallback: 'Knock',
            en: 'Trap sonar: armed floor traps. It shares the secret sonar sound.',
            es: 'Sonar de trampas: trampas de suelo armadas. Comparte el sonido del sonar de secretos.'
        },
        {
            plugin: 'WallBump', param: 'wallBumpSound', fallback: 'Earth3',
            en: 'Wall bump: walking into a wall or impassable terrain.',
            es: 'Choque de pared: al caminar contra una pared o terreno infranqueable.'
        },
        {
            plugin: 'WallBump', param: 'interactSound', fallback: 'Saint5',
            en: 'Interactable bump: walking into something you can interact with, instead of a plain wall.',
            es: 'Choque de interactuable: al caminar contra algo con lo que puedes interactuar, en lugar de una simple pared.'
        },
        {
            plugin: 'InteractableElementsMenu', param: 'Beacon Sound', fallback: 'Cursor1',
            en: 'Tracking beacon: the guide sound of the interactable focused with A, S or the I menu; it repeats, faster and louder as you get closer, until you reach the target.',
            es: 'Baliza de seguimiento: el sonido que guía hacia el interactuable enfocado con A, S o el menú I; se repite, más rápido y más fuerte cuanto más cerca, hasta llegar al objetivo.'
        }
    ];

    var OPENING = {
        en: 'Sonar tutorial. Up/down: move. Space/Enter: play sound.',
        es: 'Tutorial de sonar. Arriba/abajo: moverse. Espacio/Enter: reproducir sonido.'
    };

    function entryLabel(entry) {
        return isSpanishTranslation() ? entry.es : entry.en;
    }

    // The sound file to play for an entry: the source plugin's CURRENT
    // parameter value when set, its shipped default otherwise. Reading at play
    // time keeps the tutorial in sync with any retuning done in the plugin
    // manager without restarting.
    function entrySound(entry) {
        var params = PluginManager.parameters(entry.plugin);
        return (params && params[entry.param]) || entry.fallback;
    }

    function playEntrySound(entry) {
        AudioManager.playSe({ name: entrySound(entry), volume: volume, pitch: 100, pan: 0 });
    }

    function announce(message) {
        if (window.ScreenReaderAccess && window.ScreenReaderAccess.announce) {
            window.ScreenReaderAccess.announce(message);
        }
    }

    // Shift+S opens the menu from the map (not during a running event or
    // message) and closes it again from inside, so the shortcut is a toggle.
    // keydown, not keypress: keydown reports the physical key regardless of
    // the Shift state, and lets us preventDefault before the engine sees it.
    document.addEventListener('keydown', function (event) {
        if (event.keyCode !== triggerKey) return;
        if (requireShift && !event.shiftKey) return;
        var scene = SceneManager._scene;
        if (scene instanceof Scene_SonarTutorialMenu) {
            event.preventDefault();
            SoundManager.playCancel();
            SceneManager.pop();
            return;
        }
        if (!(scene instanceof Scene_Map)) return;
        if ($gameMap && $gameMap.isEventRunning()) return;
        if ($gameMessage && $gameMessage.isBusy()) return;
        event.preventDefault();
        SceneManager.push(Scene_SonarTutorialMenu);
    });

    function Scene_SonarTutorialMenu() {
        this.initialize.apply(this, arguments);
    }

    Scene_SonarTutorialMenu.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_SonarTutorialMenu.prototype.constructor = Scene_SonarTutorialMenu;

    Scene_SonarTutorialMenu.prototype.initialize = function () {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_SonarTutorialMenu.prototype.create = function () {
        Scene_MenuBase.prototype.create.call(this);
        // Queue the title/instructions BEFORE the window exists: creating the
        // window selects entry 0, whose announcement then queues right behind
        // these instructions in ScreenReaderAccess's polite FIFO, so the
        // player hears "Sonar sounds tutorial... " and then the first entry.
        announce(isSpanishTranslation() ? OPENING.es : OPENING.en);
        this.createTutorialWindow();
    };

    Scene_SonarTutorialMenu.prototype.createTutorialWindow = function () {
        var tutorialWindow;
        if (Utils.RPGMAKER_NAME === 'MV') {
            tutorialWindow = new Window_SonarTutorialMenu();
        } else {
            var height = Math.min(Graphics.boxHeight, 24 + ENTRIES.length * 40);
            tutorialWindow = new Window_SonarTutorialMenu(new Rectangle(0, 0, Graphics.boxWidth, height));
        }
        tutorialWindow.setHandler('cancel', tutorialWindow.processCancel.bind(tutorialWindow));
        this.addWindow(tutorialWindow);
    };

    function Window_SonarTutorialMenu() {
        this.initialize.apply(this, arguments);
    }

    Window_SonarTutorialMenu.prototype = Object.create(Window_Command.prototype);
    Window_SonarTutorialMenu.prototype.constructor = Window_SonarTutorialMenu;

    Window_SonarTutorialMenu.prototype.initialize = function (rect) {
        if (Utils.RPGMAKER_NAME === 'MV') {
            // MV's Window_Command.initialize already selects entry 0, which
            // queues its announcement right behind the opening instructions.
            Window_Command.prototype.initialize.call(this, 0, 0);
        } else {
            Window_Command.prototype.initialize.call(this, rect);
            this.refresh();
            this.activate();
        }
    };

    // Full-width window: the labels are whole sentences (title + what the
    // sound marks) and double as the screen-reader announcement, so sighted
    // players should be able to read as much of them as the screen allows.
    Window_SonarTutorialMenu.prototype.windowWidth = function () {
        return Graphics.boxWidth;
    };

    Window_SonarTutorialMenu.prototype.numVisibleRows = function () {
        return ENTRIES.length;
    };

    Window_SonarTutorialMenu.prototype.makeCommandList = function () {
        for (var i = 0; i < ENTRIES.length; i++) {
            // The command NAME is what ScreenReaderAccess's Window_Command
            // select hook announces, so it carries the full sentence.
            this.addCommand(entryLabel(ENTRIES[i]), 'entry', true, ENTRIES[i]);
        }
    };

    // OK plays the entry's sonar sound and keeps the menu open (no handler,
    // no deactivation). The stock OK beep is deliberately skipped so the
    // sample is heard clean.
    Window_SonarTutorialMenu.prototype.processOk = function () {
        var entry = this.currentExt();
        if (entry) playEntrySound(entry);
    };

    Window_SonarTutorialMenu.prototype.processCancel = function () {
        SoundManager.playCancel();
        SceneManager.pop();
    };

    // Expose the scene under a stable name for anything (tests, other
    // plugins) that wants to check whether the tutorial is open.
    window.Scene_SonarTutorialMenu = Scene_SonarTutorialMenu;
})();
