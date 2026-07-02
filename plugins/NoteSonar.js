/*:
 * @plugindesc Always-on spatial "sonar" for readable notes, diaries, documents
 * and inscriptions on the map: each readable event emits a positional ping
 * (pan = horizontal offset, pitch = vertical offset, volume = distance). Pings
 * every three seconds, or every two seconds within a few tiles. No toggle. Sibling of EnemySonar /
 * DoorSonar / CorpseSonar for written information.
 * Author: project_accessibility
 *
 * @param Note Sound
 * @desc SE played as the per-note sonar ping (file in audio/se, no extension).
 * @type text
 * @default needle_worm2_234679__tessaah__scissor-cutting-paper_01
 *
 * @param Far Interval
 * @desc Frames between pings for a distant note. 180 frames = 3 seconds.
 * @type number
 * @default 180
 *
 * @param Near Interval
 * @desc Frames between pings for a near note (<= Near Threshold). 120 = 2 seconds.
 * @type number
 * @default 120
 *
 * @param Near Threshold
 * @desc Manhattan distance (in tiles) at or below which the faster Near Interval
 * is used.
 * @type number
 * @default 5
 *
 * @param Max Range
 * @desc Only ping notes within this many tiles (Manhattan). 0 = no limit
 * (ping every note on the map).
 * @type number
 * @default 10
 *
 * @param Line Of Sight
 * @desc If true, do not ping notes hidden behind a wall (a wall tile sits on the
 * straight line between you and them).
 * @type boolean
 * @default true
 *
 * @param Min Gap
 * @desc Minimum frames between ANY two note pings, so they never overlap. 30 =
 * half a second. When several notes are due at once they queue and sound one
 * at a time, closest first.
 * @type number
 * @default 30
 *
 * @help
 * F&H hides important context in guest books, diaries, prisoner notes, scrolls,
 * maps, orders and written inscriptions. A sighted player sees the paper, book
 * or writing and can decide to read it; a blind player only discovered it by
 * bumping into every table or wall. This plugin gives those clearly-readable
 * events a continuous audio presence, the written-information counterpart of
 * ContainerSonar (loot), DoorSonar (exits), CorpseSonar (bodies) and AltarSonar
 * (ritual sites).
 *
 * It is ALWAYS ON (no toggle key). Every frame on the map it scans for readable
 * events and, on each one's own timer, plays a spatial ping:
 *   - Pan    = horizontal offset. Far to the right pans hard right; one tile
 *              to the side is almost centred (dx / 10 tiles -> full pan).
 *   - Pitch  = vertical offset. High above raises the pitch, far below lowers
 *              it, barely above is only slightly higher (dy / 10 tiles -> full).
 *   - Volume = distance. The closer the note, the louder the ping.
 * Cadence is per note: once every three seconds normally, once every two seconds when it is
 * within Near Threshold tiles.
 *
 * Detection (runtime, no hard-coded coordinates): a readable note is an ACTIVE
 * page, activable by the player (trigger 0), whose Show Text lines match the
 * concrete markers found in the real maps: guest books, "Someone has written..."
 * notes, old/explicit writing, diaries/journals, crude notebooks, empty scrolls
 * on tables, military maps/orders/documents and the Hexen lore inscriptions. The
 * text is the marker, not coordinates or event ids, so copied maps and duplicated
 * table tiles are detected automatically.
 *
 * Ambiguous book-like objects are deliberately left OUT for now: random/ambient
 * books, notice boards / Dungeon Nights meta notes, special Skin Bible shelves,
 * mockup-book puzzle shelves and generic "already searched" pages. Those can get
 * their own sound later if they prove useful; this sonar is only for the clear
 * written-note surface the player would expect to read.
 *
 * It reads positions straight from the engine, so it works regardless of how
 * dark the room is. It never speaks and never alters movement -- pure spatial
 * sound.
 *
 * Two filters keep it from leaking notes you could not actually perceive,
 * matching EnemySonar / DoorSonar / CorpseSonar:
 *   - Max Range: notes beyond this Manhattan distance are silent.
 *   - Line Of Sight: a note is silent if a solid wall tile sits on the straight
 *     line between you and it. Wall tiles are read from the map's passage flags
 *     (impassable in every direction), so this is exact and lighting-agnostic.
 *
 * Load order: place this after ScreenReaderAccess.js (kept with the other
 * accessibility plugins at the end of plugins.js).
 */

(function () {
    var parameters = PluginManager.parameters('NoteSonar');
    var noteSound = parameters['Note Sound'] || 'needle_worm2_234679__tessaah__scissor-cutting-paper_01';
    var farInterval = parseInt(parameters['Far Interval']) || 180;
    var nearInterval = parseInt(parameters['Near Interval']) || 120;
    var nearThreshold = parseInt(parameters['Near Threshold']) || 5;
    // 0 means unlimited, so respect an explicit 0 instead of falling back.
    var maxRangeParam = parameters['Max Range'];
    var maxRange = (maxRangeParam === undefined || maxRangeParam === '') ? 10 : parseInt(maxRangeParam);
    if (isNaN(maxRange)) maxRange = 10;
    var lineOfSight = parameters['Line Of Sight'] !== 'false'; // default on
    var minGap = parseInt(parameters['Min Gap']);
    if (isNaN(minGap)) minGap = 30;

    // Global throttle: frames remaining before any note may ping again. Ticks
    // down each frame; a ping resets it to minGap so two pings are never closer
    // than half a second and so never overlap, even in rooms with repeated note
    // tiles (the guest-book tables are four events side by side).
    var globalCooldown = 0;

    // Per-note ping timers, keyed by event id: frames elapsed since the last ping
    // for that note. Rebuilt every frame so absent notes drop out, and cleared on
    // a map change so ids are never carried across maps.
    var pingTimers = {};
    var timersMapId = 0;

    // Strong readable markers from the map data. Kept concrete on purpose: this
    // includes notes/diaries/documents/inscriptions, while leaving ambiguous book
    // piles and puzzle books out until they get their own design pass.
    var NOTE_RE = /guest book|written notes here|someone has written|there is something written here|there is some old writing|journal of a long-lost prisoner|random diary|captain's diary|diary of an unknown guard|crude notebook|empty scroll on the table|documents and papers|list of inmates|captain's orders|map showing distribution|hexen creates|writing consists of random symbols/i;
    var EXCLUDE_RE = /notice board|random books|dusty old books|mockup bookshelf|you search the bookshelf|book is calling|already searched|nothing left here|soul stone|devour the remains|demon seed/i;

    function stripCodes(text) {
        return text.replace(/\\[a-z]+\[\d+\]/gi, '').replace(/<[^>]+>/g, ' ');
    }

    function pageText(page) {
        var joined = '';
        var list = page.list;
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (c.code === 401 && c.parameters && c.parameters[0]) {
                joined += ' ' + stripCodes(c.parameters[0]);
            }
        }
        return joined;
    }

    // A readable note is a player-activatable ACTIVE page whose visible text hits
    // one of the strong written-note markers and does not hit the explicit
    // "leave this for later" exclusions above. Reading the active page means a
    // note can naturally stop pinging if the event flips to a non-note page.
    function isNoteEvent(event) {
        if (event._pageIndex < 0) return false;
        if (event.x <= 0 || event.y <= 0) return false;
        var page;
        try {
            page = (typeof event.page === 'function') ? event.page() : null;
        } catch (e) {
            return false;
        }
        if (!page || !page.list) return false;
        if (page.trigger !== 0) return false;
        var text = pageText(page);
        return NOTE_RE.test(text) && !EXCLUDE_RE.test(text);
    }

    function noteEvents() {
        return $gameMap.events().filter(isNoteEvent);
    }

    // A solid wall for line-of-sight purposes: a tile impassable from every
    // direction. 0x0f = all four passage bits; checkPassage returns false when
    // the tile blocks them all (a wall), true for open floor.
    function isWallTile(x, y) {
        return !$gameMap.checkPassage(x, y, 0x0f);
    }

    // True unless a wall tile sits strictly between player and note. Walks the
    // straight line (Bresenham) and checks every intermediate tile, skipping the
    // two endpoints (the player's own tile and the note's own tile).
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
            if (x === x1 && y === y1) break;   // reached the note: clear path
            if (isWallTile(x, y)) return false; // a wall blocks the view
        }
        return true;
    }

    // Spatial ping for one note: pan from horizontal offset, pitch from vertical
    // offset, volume from distance. Mirrors the EnemySonar encoding.
    function ping(dx, dy, dist) {
        // Pan: full left/right at ~10 tiles of horizontal offset; ~10 per tile
        // close in, so one step to the side is nearly centred.
        var pan = Math.max(-100, Math.min(100, Math.round(dx / 10 * 100)));
        // Pitch: above raises, below lowers (+/- 50 over ~10 tiles).
        var pitchOffset = Math.max(-50, Math.min(50, Math.round(-dy / 10 * 50)));
        var pitch = 100 + pitchOffset;
        // Volume: readable notes are useful but not urgent, so they sit below
        // doors/containers in the mix (max 30).
        var d = Math.min(dist, 30);
        var volume = Math.round(30 - (d / 30) * 20);
        if (volume < 10) volume = 10;

        AudioManager.playSe({ name: noteSound, volume: volume, pitch: pitch, pan: pan });
    }

    function updateSonar() {
        if ($gameMap.mapId() !== timersMapId) {
            timersMapId = $gameMap.mapId();
            pingTimers = {};
            globalCooldown = 0;
        }

        if (globalCooldown > 0) globalCooldown--;

        var px = $gamePlayer.x;
        var py = $gamePlayer.y;
        var notes = noteEvents();
        var seen = {};
        var due = []; // notes whose own timer is up and that want to ping now

        for (var i = 0; i < notes.length; i++) {
            var ev = notes[i];
            var id = ev._eventId;
            seen[id] = true;

            var dx = ev.x - px; // + = note to the right
            var dy = ev.y - py; // + = note below (south)
            var dist = Math.abs(dx) + Math.abs(dy);

            // Out of range or hidden behind a wall: stay silent, and drop the
            // timer so it pings at once when it next comes into view/range
            // rather than mid-interval.
            if (maxRange > 0 && dist > maxRange) {
                delete pingTimers[id];
                continue;
            }
            if (lineOfSight && !hasLineOfSight(px, py, ev.x, ev.y)) {
                delete pingTimers[id];
                continue;
            }

            var interval = (dist <= nearThreshold) ? nearInterval : farInterval;

            // New notes are due immediately; existing ones tick toward their
            // interval. A note that is due but blocked by the global gap keeps
            // its raised timer (>= interval) so it stays due and pings as soon as
            // the gap opens, rather than restarting its wait.
            var t = (pingTimers[id] === undefined) ? interval : pingTimers[id] + 1;
            pingTimers[id] = t;
            if (t >= interval) due.push({ dx: dx, dy: dy, dist: dist, id: id });
        }

        // Only one note may ping per Min Gap frames, so pings never overlap.
        // When several are due at once, the closest sounds first; the rest wait
        // their turn on the next opening.
        if (due.length > 0 && globalCooldown <= 0) {
            due.sort(function (a, b) { return (a.dist - b.dist) || (a.id - b.id); });
            var pick = due[0];
            ping(pick.dx, pick.dy, pick.dist);
            pingTimers[pick.id] = 0;
            globalCooldown = minGap;
        }

        // Drop timers for notes that left range or no longer exist so they ping
        // immediately again next time they reappear.
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
