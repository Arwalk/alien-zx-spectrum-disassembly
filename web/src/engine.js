// The turn engine + per-frame main loop + endgame/scoring. Ties the subsystems
// together in the exact order of MainLoop $8E81 (PORT_REFERENCE §5).
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, ST = A.state, MV = A.movement, MO = A.morale;

  // --- PreActionCheck (permission gate) ----------------------------------
  function requeue(s, slot) { MV.setActionTimer(s, slot, D.K.BLOCKED_REQUEUE); return false; }

  function panic(s, slot, rng) {
    var a = s.actors[slot];
    if (a.room & 64) {                    // panicking in the ducts
      if (a.state !== 1) return true;     // only a pending MOVE is replaced ($8F38)
      var room = a.room & 63;
      if (room < 34) s.roomGrille[room] = 0;
      MV.moveThroughGrille(s, slot);
      return false;
    }
    MO.dropHeldItems(s, slot);            // drop everything and flee
    MV.pickNextRoom(s, slot, rng);
    return moveGate(s, slot, rng);
  }

  function moveGate(s, slot, rng) {
    var a = s.actors[slot], dest = a.dest, occ = 0;
    for (var k = 1; k < 8; k++) if (s.actors[k].room === dest) occ++;
    if (dest & 64) {                      // entering / staying in the ducts
      if (a.morale < 2) return panic(s, slot, rng);
      if (occ > 0) return requeue(s, slot); // single-file
      return true;
    }
    if (occ >= D.K.ROOM_CAP) return requeue(s, slot); // 3-crew cap
    return true;
  }

  function preActionCheck(s, slot, rng) {
    var a = s.actors[slot];
    if (slot === 0) return true;          // the alien is always allowed
    if (a.state === 0) return false;      // parked, nothing to fire
    if (slot === s.alienTargetID) {       // the android
      if (a.state === 4) {                // silently refuses an ATTACK order
        MV.pickNextRoom(s, slot, rng); a.state = 1; a.t = 20; return false;
      }
      if (a.state >= 3) return true;
      return moveGate(s, slot, rng);
    }
    if (a.morale === 0) return panic(s, slot, rng); // Broken: panic
    if (a.state >= 3) return true;        // grille/combat fire unchecked
    return moveGate(s, slot, rng);        // moves go through the gate
  }

  // --- crew-action handlers ----------------------------------------------
  function arrive(s, slot) {
    var a = s.actors[slot];
    if (a.dest === a.room) return;        // idle
    a.room = a.dest;
    MO.recalcMorale(s, slot);             // at the arrival room, BEFORE any bounce
    if (a.room === 0 && (s.shipFlags & 2)) a.room = 13;      // vented Airlock #1
    else if (a.room === 1 && (s.shipFlags & 4)) a.room = 13; // vented Airlock #2
  }
  function ductTransit(s, slot) {
    var a = s.actors[slot];
    a.courage = MO.clamp0(a.courage + ((a.room & 64) ? 1 : -1)); // out +1 / in -1
    a.room ^= 64;
    MO.recalcMorale(s, slot);
  }
  function removeGrille(s, slot) {
    var room = s.actors[slot].room & 63;
    if (room < 34) s.roomGrille[room] = 0;
  }
  function attack(s, slot, rng) {
    var a = s.actors[slot];
    if (a.room === s.actors[0].room) A.combat.crewHitsAlien(s, slot, rng);
    else if (s.alienActive && s.actors[s.alienTargetID].room === a.room)
      A.android.crewHitsAndroid(s, slot, rng);
    a.state = 0;                          // ClearActionState
  }

  function dispatchCrewAction(s, slot, rng) {
    if (!preActionCheck(s, slot, rng)) return;
    switch (s.actors[slot].state) {
      case 1: arrive(s, slot); break;
      case 2: ductTransit(s, slot); break;
      case 3: removeGrille(s, slot); break;
      case 4: attack(s, slot, rng); break;
      case 5: A.combat.crewAction5(s, rng); break;      // alien attack tick
      case 6: A.ship.hypersleepComplete(s, slot); break;
      case 7: A.android.crewAction7(s); break;          // android attack tick
    }
  }

  function resetCrewTimers(s, rng) {
    for (var slot = 0; slot < 8; slot++) {
      var a = s.actors[slot];
      if (a.t === 0) continue;            // parked
      a.t -= 1;
      if (a.t === 0) dispatchCrewAction(s, slot, rng);
      if (s.gameOver) return;
    }
  }

  function checkCrewAlive(s) {
    if (ST.livingHumanCrew(s).length === 0) endgame(s, "crewLost");
  }

  // --- endgame + Competence Rating ---------------------------------------
  function mmss(sec) {
    if (sec < 0) sec = 0;
    var m = Math.floor(sec / 60), ss = sec % 60;
    return m + ":" + (ss < 10 ? "0" : "") + ss;
  }
  function crewTerm(s) {
    var t = 0, live = ST.livingHumanCrew(s);
    for (var i = 0; i < live.length; i++) t += 2 * s.actors[live[i]].strength;
    return t;
  }
  function roomTerm(s) {
    var t = 0;
    for (var r = 0; r < 34; r++) if (s.roomDamage[r] < 20) t += 1; // tens digit < '2'
    return t;
  }
  function oxyTerm(s) { return 2 * Math.floor(Math.max(s.oxygen, 0) / 1000); }

  function endgame(s, kind) {
    if (s.gameOver) return;
    var armed = s.destructArmed;
    // the destruct-armed second line shared by escape/crewLost/oxygenOut,
    // with the crew + oxygen score; unarmed = the alien reaches Earth, score 0.
    function destructSplit(text) {
      if (armed) {
        text.push("The Nostromo will explode in " + mmss(s.destructSeconds));
        return crewTerm(s) + oxyTerm(s);
      }
      text.push("The Alien will be unleashed upon the Earth");
      return 0;
    }
    var rating = 0, text = [];
    if (kind === "alienKilled") {
      rating = crewTerm(s) + roomTerm(s) + oxyTerm(s);
      text.push("The Alien has been killed");
    } else if (kind === "escape") {
      text.push("The Narcissus is launched");
      rating = destructSplit(text);
    } else if (kind === "crewLost") {
      text.push("Humanoid life levels minimal");
      rating = destructSplit(text);
    } else if (kind === "oxygenOut") {
      text.push("Life Support Systems exhausted");
      // Endgame_OxygenOut stamps ALL 7 crew status bytes to 2 — even removed
      // sleepers and the host — before the destruct split.
      for (var k = 1; k < 8; k++) s.actors[k].status = 2;
      rating = destructSplit(text);
    } else if (kind === "shipDestroyed") {
      // Endgame_Summary: the alien died with the ship — the original reuses
      // "The Alien has been killed" here, but scores the oxygen term only.
      text.push("The Alien has been killed");
      rating = oxyTerm(s);
    }
    // dead roster (status neither alive nor removed; the android excluded —
    // its reveal line follows separately) + android reveal
    for (var j = 1; j < 8; j++) {
      if (j === s.alienTargetID) continue;
      var st = s.actors[j].status;
      if (st !== 0 && st !== 255) text.push(D.crewNames[j] + " is dead");
    }
    if (s.alienTargetID < 8) text.push(D.crewNames[s.alienTargetID] + " was the Android");
    if (rating > 100) rating = 100;
    text.push("Competence Rating: " + rating);
    s.gameOver = { kind: kind, rating: rating, text: text };
  }

  // --- per-frame main loop (§5 order) ------------------------------------
  function step(s, rng) {
    if (s.gameOver) return;
    s.frame++;
    A.android.updateAlien(s, rng);                 // 3. android activation (one-shot/cycle)
    if (s.gameOver) return;
    A.android.triggerAlienEvent(s);                // 4. arm the android at >=6 alien wounds
    A.alienai.updateAlienAI(s, rng);               // 5. the alien's brain
    if (s.gameOver) return;
    A.jones.updateJones(s, rng);                   // 7. walk Jones
    resetCrewTimers(s, rng);                        // 8. the turn engine
    if (s.gameOver) return;
    A.ship.updateRoomActors(s, s.viewedSlot);      // 13. ship simulation
    if (s.gameOver) return;
    checkCrewAlive(s);                              // 14. end if no human survives
  }

  function startLongGame(seed) {
    var rng = new A.RNG(seed);
    var s = A.init.longGameInit(rng);
    s.viewedSlot = -1;
    return { state: s, rng: rng };
  }

  A.engine = {
    step: step, endgame: endgame, dispatchCrewAction: dispatchCrewAction,
    resetCrewTimers: resetCrewTimers, checkCrewAlive: checkCrewAlive,
    preActionCheck: preActionCheck, startLongGame: startLongGame, mmss: mmss,
    crewTerm: crewTerm, roomTerm: roomTerm, oxyTerm: oxyTerm
  };
  if (typeof module !== "undefined" && module.exports) module.exports = A.engine;
})(typeof window !== "undefined" ? window : this);
