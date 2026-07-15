// Ship simulation: damage meters, engine fires, oxygen, self-destruct, airlocks,
// hypersleep, motion trackers and the Narcissus launch gate.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, ST = A.state, MV = A.movement;
  var ROOM = D.ROOM;

  // --- damage ------------------------------------------------------------
  function roomAlarm(s, room) {
    if (room === 6) A.messages.enqueue(s, 22);
    else if (room === 7) A.messages.enqueue(s, 23);
    else if (room === 25) A.messages.enqueue(s, 24);
    else if (room === 34) A.messages.enqueue(s, 25);
    else if (room >= 17 && room <= 19) {
      s.shipFlags |= (4 << (room & 3)); // engine catches fire: bit 3/4/5
      A.messages.enqueue(s, 9, { room: room });
    }
  }
  // AddRoomDamage: add `points` half-steps (each = +5) to a room's meter, with
  // the tens-digit thresholds (30 alarm/fire, 70 structural, 100 hull loss).
  function addRoomDamage(s, roomByte, points) {
    if (roomByte & 64) return; // no meters in the ducts
    var room = roomByte & 63;
    for (var p = 0; p < points; p++) {
      var oldTens = Math.floor(s.roomDamage[room] / 10);
      s.roomDamage[room] += 5;
      var newTens = Math.floor(s.roomDamage[room] / 10);
      if (newTens !== oldTens) {
        if (newTens === 3) roomAlarm(s, room);
        else if (newTens === 7) A.messages.enqueue(s, 8, { room: room });
        else if (newTens >= 10) { A.engine.endgame(s, "shipDestroyed"); return; }
      }
    }
  }

  // --- oxygen ------------------------------------------------------------
  function oxygenTick(s) {
    if (--s.oxygenTick > 0) return;
    var live = ST.liveActorCount(s);
    s.oxygenTick = 2 * live || 1;          // period = 2 x live actors
    s.oxygen -= 1;
    if (s.oxygen === D.K.OXYGEN_CRITICAL && !s.oxygenCritFired) {
      A.messages.enqueue(s, 26); s.oxygenCritFired = true;
    }
    if (s.oxygen < 0) A.engine.endgame(s, "oxygenOut");
  }

  // --- self-destruct -----------------------------------------------------
  function destructToggle(s) {
    if (!s.destructArmed) {
      s.destructArmed = true; s.destructSeconds = D.K.DESTRUCT_SECONDS;
      s.destructSub = D.K.DESTRUCT_FRAMES_PER_SEC; s.shipFlags |= 1;
      A.messages.enqueue(s, 13);
    } else {
      s.destructArmed = false; s.shipFlags &= ~1;
      A.messages.enqueue(s, 14);
    }
  }
  function destructTicker(s) {
    if (!s.destructArmed) return;
    if (--s.destructSub > 0) return;
    s.destructSub = D.K.DESTRUCT_FRAMES_PER_SEC;
    s.destructSeconds -= 1;
    if (s.destructSeconds < 0) A.engine.endgame(s, "shipDestroyed"); // BOOM
  }

  // --- airlocks ----------------------------------------------------------
  // which: 0 = Airlock #1 (room 0), 1 = Airlock #2 (room 1). Operated from
  // Corridor#6. Blowing vents the room: everyone in it dies.
  function blowLock(s, which, rng) {
    var room = which; // 0 or 1
    s.shipFlags |= (which === 0 ? 2 : 4);
    for (var k = 0; k < 8; k++) {
      if (s.actors[k].room === room) { s.actors[k].room = 255; s.actors[k].status = 1; }
    }
    for (var i = 0; i < 22; i++) if (s.items[i] === room) s.items[i] = 255;
    A.messages.enqueue(s, 16, { room: room });
    // was the alien vented?
    if (s.actors[0].room === 255) {
      if (s.actors[0].strength >= 3) { A.engine.endgame(s, "alienKilled"); return; }
      if (rng.nibble() >= 2) { A.engine.endgame(s, "alienKilled"); return; } // 14/16
      // survived: crawls back in via the ShuttleBay. Its status byte STAYS 1
      // (the vent sweep marked it dead and $976F never resets it): the
      // returned alien is invisible to trackers and no longer counts in the
      // oxygen live-count. Authentic quirk, reproduced.
      s.actors[0].room = ROOM.SHUTTLEBAY; s.actors[0].t = 0;
      A.messages.enqueue(s, 18, { room: ROOM.SHUTTLEBAY });
    }
  }
  function sealLock(s, which) {
    s.shipFlags &= ~(which === 0 ? 2 : 4);
    A.messages.enqueue(s, 17, { room: which });
  }

  // --- hypersleep --------------------------------------------------------
  function hypersleepStart(s, slot) {
    s.actors[slot].state = 6; s.actors[slot].t = s.actors[slot].t0 = D.K.HYPERSLEEP_BASE;
    A.messages.enqueue(s, 11, { actor: slot });
  }
  function hypersleepComplete(s, slot) {
    A.messages.enqueue(s, 12, { actor: slot });
    s.actors[slot].status = 255; s.actors[slot].room = 255;
    for (var i = 0; i < 22; i++) {
      if (s.items[i] === 160 + slot || s.items[i] === 128 + slot) s.items[i] = ROOM.CRYO;
    }
  }

  // --- fire fighting -----------------------------------------------------
  function fightFire(s, slot, room) {
    var front = A.jones.frontHandItem(s, slot);
    if (front < 8 || front > 11) return;    // not an extinguisher
    if (s.itemCharges[front] > 0) {
      s.itemCharges[front]--;
      var idx = room - 17;
      if (idx >= 0 && idx < 3) s.engineFix[idx]++;
    } else {
      A.messages.enqueue(s, 6, { actor: slot });
    }
  }
  function engineStateScan(s) {
    var rooms = [17, 18, 19], bits = [8, 16, 32];
    for (var e = 0; e < 3; e++) {
      if (s.shipFlags & bits[e]) fireDamageTick(s, rooms[e], bits[e]);
    }
    if (--s.shipTick <= 0) s.shipTick = 100;
  }
  function fireDamageTick(s, room, bit) {
    var tens = Math.floor(s.roomDamage[room] / 10);
    var needed = 1 + (tens >= 6 ? 1 : 0) + (tens >= 8 ? 1 : 0);
    if (s.engineFix[room - 17] >= needed) {
      s.shipFlags &= ~bit;
      A.messages.enqueue(s, 15, { room: room });
    } else if (s.shipTick === 1) {
      addRoomDamage(s, room, 1); // the fire spreads
    }
  }

  // --- motion trackers ---------------------------------------------------
  function scanTracker(s, itemId, listIdx) {
    var loc = s.items[itemId];
    if (loc < 160 || loc > 167) return;      // not held in a front hand (160..167)
    var slot = loc - 160;
    var holderRoom = s.actors[slot].room;
    var map = (holderRoom & 64) ? D.roomAdjDucts : D.roomAdjCorridors;
    var base = (holderRoom & 63) * 5;
    var quiet = true;
    for (var dir = 0; dir < 5 && quiet; dir++) {
      var adj = map[base + dir];
      // The "own room = no exit" skip compares the UNMASKED holder byte
      // (TrackerHolderRoom $981D), so it never matches for a holder in the ducts — his own room
      // gets scanned, he detects himself, and a duct-held tracker always
      // reports motion. Authentic quirk, reproduced.
      if (adj === undefined || adj === holderRoom) continue;
      if (s.jonesRoom === adj) { quiet = false; break; }
      for (var k = 0; k < 8; k++) {
        if ((s.actors[k].room & 63) === adj && s.actors[k].status === 0) { quiet = false; break; }
      }
    }
    s.nearRoomList[listIdx] = quiet ? holderRoom : 255;
  }
  // NB: entries are only ever WRITTEN while their tracker is front-held — a
  // dropped tracker's last "all clear" room persists in the list (and keeps
  // granting its +1 morale) exactly as on the tape ($97F7 never clears).
  function findTrackerHolders(s) {
    scanTracker(s, 6, 0);
    scanTracker(s, 7, 1);
    scanTracker(s, 20, 2);
    scanTracker(s, 21, 2);
  }
  // Sound the viewed crew member's detector (beep) or "Jones uneasy" (msg #19).
  function viewedTrackerCheck(s, viewedSlot) {
    s.trackerBeep = false;
    if (viewedSlot == null || viewedSlot < 1) return;
    var front = A.jones.frontHandItem(s, viewedSlot);
    if (front === 6 || front === 7) {
      var idx = front === 6 ? 0 : 1;
      if (s.nearRoomList[idx] === 255 && (s.eventPace & 7) === 0) s.trackerBeep = true;
    } else if (front === 20 || front === 21) {
      if (s.nearRoomList[2] === 255) A.messages.enqueue(s, 19);
    }
  }

  // --- Narcissus launch (DEFINITIVE FIX §17: intended all-aboard rule) ----
  function launchGate(s) {
    for (var k = 1; k < 8; k++) {
      if (s.actors[k].status === 0 && s.actors[k].room !== ROOM.NARCISSUS) {
        A.messages.enqueue(s, 28); return false; // LAUNCH COUNTERMANDED
      }
    }
    var jonesOk = false;
    if (s.jonesRoom === ROOM.NARCISSUS) jonesOk = true;
    else if (s.jonesRoom === 255) {          // caught: is the cat item aboard/held?
      for (var c = 20; c <= 21; c++) {
        var loc = s.items[c];
        if (loc === 255) continue;
        if (loc === ROOM.NARCISSUS || loc >= 128) jonesOk = true;
      }
    }
    if (!jonesOk) { A.messages.enqueue(s, 27); A.messages.enqueue(s, 28); return false; }
    A.engine.endgame(s, "escape");
    return true;
  }

  // Per-frame ship systems (UpdateRoomActors), given the viewed slot for the beep.
  function updateRoomActors(s, viewedSlot) {
    if (s.gameOver) return;
    s.eventPace++;
    destructTicker(s);
    if (s.gameOver) return;
    findTrackerHolders(s);
    oxygenTick(s);
    if (s.gameOver) return;
    viewedTrackerCheck(s, viewedSlot);
    engineStateScan(s);
  }

  A.ship = {
    addRoomDamage: addRoomDamage,
    oxygenTick: oxygenTick,
    destructToggle: destructToggle,
    destructTicker: destructTicker,
    blowLock: blowLock,
    sealLock: sealLock,
    hypersleepStart: hypersleepStart,
    hypersleepComplete: hypersleepComplete,
    fightFire: fightFire,
    engineStateScan: engineStateScan,
    findTrackerHolders: findTrackerHolders,
    viewedTrackerCheck: viewedTrackerCheck,
    launchGate: launchGate,
    updateRoomActors: updateRoomActors
  };
  if (typeof module !== "undefined" && module.exports) module.exports = A.ship;
})(typeof window !== "undefined" ? window : this);
