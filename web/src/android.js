// The traitor Android (Long Game). Arming, one-per-cycle activation, its attack
// tick, and the anti-android combat handler.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, MV = A.movement, MO = A.morale, JN = A.jones;

  // TriggerAlienEvent: arm the android once the alien has taken >= 6 wounds.
  function triggerAlienEvent(s) {
    var id = s.alienTargetID;
    if (s.actors[0].strength >= D.K.ANDROID_TRIGGER_WOUNDS &&
        id < 8 && s.actors[id].status === 0) {
      s.alienActive = 255;
    }
  }

  // Up to two OTHER crew standing in the android's room (its victim pool).
  function roomMates(s, exclude) {
    var spot = s.actors[exclude].room, out = [];
    for (var k = 1; k < 8; k++) {
      if (k === exclude) continue;
      if (s.actors[k].room === spot && out.length < 2) out.push(k);
    }
    return out;
  }

  // UpdateAlien: activation. Fires whenever the android's timer is parked and it
  // is still active & undefeated — which recurs each attack cycle, so the
  // android keeps hunting until stopped.
  function updateAlien(s, rng) {
    if (s.alienActive === 0) return;
    var id = s.alienTargetID;
    var android = s.actors[id];
    if (android.t !== 0) return;      // still mid-action
    if (android.status !== 0) return; // dead / defeated (lockout)
    s.androidActivated = true;

    var mates = roomMates(s, id), target = -1;
    for (var i = 0; i < mates.length; i++) {
      if (s.actors[mates[i]].status === 0) { target = mates[i]; break; }
    }
    if (target >= 0) {
      A.messages.enqueue(s, 30, { actor: id, target: target });
      android.state = 7; android.t = D.K.ANDROID_ATTACK_T;
    } else {
      MV.pickNextRoom(s, id, rng);
      android.state = 1; android.t = D.K.ANDROID_WANDER_T;
    }
  }

  // CrewAction7_Handler: the android's attack tick — wound the first live room-mate.
  function crewAction7(s) {
    var id = s.alienTargetID;
    var mates = roomMates(s, id), target = -1;
    for (var i = 0; i < mates.length; i++) {
      if (s.actors[mates[i]].status === 0) { target = mates[i]; break; }
    }
    if (target < 0) return;
    var v = s.actors[target];
    v.strength -= 1;
    // Witnesses = the android itself + the other room-mate: the android is a
    // live status-0 actor, so its kills are always "seen" (insta-found + decay).
    if (v.strength < 2) { MO.collapseVictim(s, target, [id].concat(mates)); }
    else if (v.strength >= 4) { /* shrugs it off silently */ }
    else { A.messages.enqueue(s, 29, { actor: target, target: id }); }
  }

  function woundAndroid(s) {
    var id = s.alienTargetID, android = s.actors[id];
    android.strength -= 1;
    if (android.strength < 2) collapseAndroid(s);
  }
  function collapseAndroid(s) {
    var id = s.alienTargetID, android = s.actors[id];
    android.status = 2;   // defeated: permanent re-activation lockout
    android.t = 0;
    A.messages.enqueue(s, 21, { actor: id });
    s.alienActive = 0;
  }

  // Anti-android combat (CrewHitsAndroid). Same guards/weapon dispatch as
  // CrewHitsAlien but aimed at the android (msgs #31/#32). DEFINITIVE FIX (§17):
  // the harpoon path mirrors the alien-side harpoon instead of the shipped
  // inverted-wipe bug.
  function crewHitsAndroid(s, attacker, rng) {
    var a = s.actors[attacker];
    if (a.strength < 2 || a.morale < 2) return;
    var id = s.alienTargetID, android = s.actors[id];
    var front = JN.frontHandItem(s, attacker);
    if (front === 17 || front >= 20) return; // cat box / cat items / bare hands
    if (front === 16) {                      // net: disable it
      android.t = 255;
      s.items[16] = 255;
      A.messages.enqueue(s, 31, { actor: attacker, target: id });
      return;
    }
    A.messages.enqueue(s, 32, { actor: attacker });
    if ((front >= 0 && front <= 5) || front === 18 || front === 19) {
      woundAndroid(s);
    } else if (front === 6 || front === 7) {  // tracker: shatters but wounds
      s.items[front] = 255;
      A.messages.enqueue(s, 5, { actor: attacker });
      woundAndroid(s);
    } else if (front >= 8 && front <= 11) {   // extinguisher: no effect
      if (s.itemCharges[front] > 0) s.itemCharges[front]--;
      else A.messages.enqueue(s, 6, { actor: attacker });
    } else if (front === 12) {                // harpoon (fixed)
      androidHarpoon(s, attacker);
    } else if (front >= 13 && front <= 15) {  // laser
      if (s.itemCharges[front] > 0) {
        s.itemCharges[front]--;
        A.ship.addRoomDamage(s, android.room, 6);
        woundAndroid(s);
      } else A.messages.enqueue(s, 7, { actor: attacker });
    }
  }

  // Fixed harpoon-vs-android: mirror the alien-side kill primitive.
  function androidHarpoon(s, attacker) {
    var id = s.alienTargetID, android = s.actors[id];
    var spot = android.room;
    var gathered = [attacker];
    var mates = roomMates(s, id);
    for (var m = 0; m < mates.length && gathered.length < 3; m++) {
      if (mates[m] !== attacker) gathered.push(mates[m]);
    }
    for (var g = 0; g < gathered.length; g++) {
      var slot = gathered[g];
      for (var i = 0; i < 22; i++) {
        var loc = s.items[i];
        if (loc === 160 + slot || loc === 128 + slot || loc === spot) s.items[i] = 255;
      }
      if (s.actors[slot].status === 0) { s.actors[slot].status = 1; s.actors[slot].strength = 0; }
    }
    A.ship.addRoomDamage(s, spot, 15);
    android.strength -= 5;
    if (android.strength < 2) collapseAndroid(s);
  }

  A.android = {
    triggerAlienEvent: triggerAlienEvent,
    updateAlien: updateAlien,
    crewAction7: crewAction7,
    crewHitsAndroid: crewHitsAndroid
  };
  if (typeof module !== "undefined" && module.exports) module.exports = A.android;
})(typeof window !== "undefined" ? window : this);
