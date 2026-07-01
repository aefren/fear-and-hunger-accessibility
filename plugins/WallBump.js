/**
 * WallBump sound plugin
 * Makes a wall bump noise when your character tries to pass through impassable terrain
 * Author: Craig Brett
 * 
 * @param wallBumpSound
 * @desc The sound to play when the player bumps into a wall
 * @type text
 * @default Earth3
 * 
 * @param interactSound
 * @desc The sound to play when the player bumps into an interactable element
 * @type text
 * @default Saint5
 */

(function() {
    var parameters = PluginManager.parameters('WallBump');
    var wallBumpSoundName = parameters['wallBumpSound'];
    if (!wallBumpSoundName) {
        wallBumpSoundName = 'Earth3';
    }
    var interactSoundName = parameters['interactSound'];
    if (!interactSoundName) {
        interactSoundName = 'Saint5';
    }
    var wallBumpSound = { name: wallBumpSoundName, pan: 0, pitch: 100, volume: 30 };
    var interactSound = { name: interactSoundName, pan: 0, pitch: 100, volume: 30 };

    var soundDelay = 500;
    var pauseSound = false;

    var overrides = {
        Game_Player_moveStraight: Game_Player.prototype.moveStraight
    };

    // override the moveStraight to check if the player canPass. If cannot pass, play the sound
    Game_Player.prototype.moveStraight = function(d) {
        if (!pauseSound && !this.canPass(this.x, this.y, d)) {
            // Check if there's an event at the destination and if it can be activated
            if (isBumpingInteractable(this.x, this.y, d)) {
                AudioManager.playStaticSe(interactSound);
            } else {
                AudioManager.playStaticSe(wallBumpSound);
            }

            pauseSound = true;

            setTimeout(() => {
                pauseSound = false;
            }, soundDelay);
        }

        overrides.Game_Player_moveStraight.call(this, d);
    }

    function isBumpingInteractable(x, y, d) {
        let x2 = $gameMap.roundXWithDirection(x, d);
        let y2 = $gameMap.roundYWithDirection(y, d);
        const targetIsCounter = $gameMap.isCounter(x2, y2);

        if (targetIsCounter) {
            // increment by another tile to account for the counter
            x2 = $gameMap.roundXWithDirection(x2, d);
            y2 = $gameMap.roundYWithDirection(y2, d);
        }

        const events = $gameMap.eventsXy(x2, y2);
        for (const event of events) {
            // 0 = Action Button, 1 = Player Touch, 2 = Event Touch. Player Touch
            // (1) was missing here, so a solid Player-Touch event (e.g. a locked
            // door or an examine-only prop with "same as characters" priority)
            // sounded like a plain wall on bump instead of announcing there was
            // something there. Matches the [0, 1, 2] set used everywhere else in
            // this codebase for "interactable" (InteractableElementsMenu).
            if (event.isTriggerIn([0, 1, 2])) {
                return true;
            }
        }

        return false;
    }
})();