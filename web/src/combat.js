// Combat: crew-vs-alien weapon dispatch, the harpoon kill primitive, the scare
// check, and the alien's own attack tick (incl. corpse-dragging).
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, MV = A.movement, MO = A.morale, JN = A.jones;

  function foldDir(n) {           // fold 0-15 -> 0-4 (same weighting as rng.direction)
    if (n < 3) return 0; if (n < 6) return 1; if (n < 9) return 2;
    if (n < 12) return 3; return 4;
  }
  // "serious weapon" for the scare bonus (definitive fix, §17.3): incinerators,
  // harpoon and lasers make well-armed crew scarier to the alien. The original
  // bonus is unreachable dead code; its compare shape hints at a 6-12 range
  // (trackers/extinguishers/harpoon) instead — this port's chosen
  // interpretation is the semantic one, documented in PORT_REFERENCE §11.3.
  function isSeriousWeapon(id) {
    return id === 3 || id === 4 || id === 5 || id === 12 || id === 13 || id === 14 || id === 15;
  }

  function afterAlienWound(s, rng) {
    if (s.actors[0].strength >= D.K.ALIEN_KILL_THRESHOLD) { A.engine.endgame(s, "alienKilled"); return; }
    alienScareCheck(s, rng);
  }
  function woundAlien(s, amount, rng) {
    s.actors[0].strength += amount;
    afterAlienWound(s, rng);
  }

  // CrewHitsAlien: dispatched from an ATTACK order when the attacker shares the
  // alien's room. Guards: strength >= 2 and morale >= 2. Then the front-hand
  // weapon decides the effect.
  function crewHitsAlien(s, attacker, rng) {
    var alien = s.actors[0], a = s.actors[attacker];
    if (a.room !== alien.room) return; // the alien slipped away
    if (a.strength < 2 || a.morale < 2) return;
    var front = JN.frontHandItem(s, attacker);
    if (front === 17 || front >= 20) return; // cat box / cat items / bare hands
    if (front === 16) {                      // net: disable the alien
      alien.t = 255;
      s.items[16] = 255;
      A.messages.enqueue(s, 3, { actor: attacker });
      return;
    }
    A.messages.enqueue(s, 4, { actor: attacker });
    if ((front >= 0 && front <= 5) || front === 18 || front === 19) {
      woundAlien(s, 1, rng);                 // prod / incinerator / spanner
    } else if (front === 6 || front === 7) { // tracker: shatters but still wounds
      s.items[front] = 255;
      A.messages.enqueue(s, 5, { actor: attacker });
      woundAlien(s, 1, rng);
    } else if (front >= 8 && front <= 11) {  // extinguisher: scare only
      if (s.itemCharges[front] > 0) { s.itemCharges[front]--; alienScareCheck(s, rng); }
      else A.messages.enqueue(s, 6, { actor: attacker });
    } else if (front === 12) {               // harpoon
      alienKillPrimitive(s, attacker, rng);
    } else if (front >= 13 && front <= 15) { // laser
      if (s.itemCharges[front] > 0) {
        s.itemCharges[front]--;
        A.ship.addRoomDamage(s, alien.room, 6);
        woundAlien(s, 2, rng);
      } else A.messages.enqueue(s, 7, { actor: attacker });
    }
  }

  // Harpoon: gather the attacker + up to two crew in the alien's room; destroy
  // every item they hold or lying in the room; kill the survivors; +15 room
  // damage; alien wound counter +5 (likely lethal).
  function alienKillPrimitive(s, attacker, rng) {
    var alien = s.actors[0], spot = alien.room;
    var gathered = MV.occupantsAt(s, spot, MV.CREW).slice(0, 3);
    if (gathered.indexOf(attacker) < 0) gathered.unshift(attacker);
    for (var g = 0; g < gathered.length; g++) {
      var slot = gathered[g];
      for (var i = 0; i < 22; i++) {
        var loc = s.items[i];
        if (loc === 160 + slot || loc === 128 + slot || loc === spot) s.items[i] = 255;
      }
      if (s.actors[slot].status === 0) { s.actors[slot].status = 1; s.actors[slot].strength = 0; }
    }
    A.ship.addRoomDamage(s, spot, 15);
    alien.strength += 5;
    if (alien.strength >= D.K.ALIEN_KILL_THRESHOLD) { A.engine.endgame(s, "alienKilled"); return; }
    alienScareCheck(s, rng);
  }

  // AlienScareCheck: after most successful crew attacks, will the alien flee?
  function alienScareCheck(s, rng) {
    if (s.gameOver) return;
    var alien = s.actors[0];
    var gathered = MV.occupantsAt(s, alien.room, MV.CREW).slice(0, 3);
    var total = 0;
    for (var i = 0; i < gathered.length; i++) {
      var a = s.actors[gathered[i]];
      if (a.strength < 3) continue;          // not fit to fight
      if (a.state !== 4) continue;           // not actually attacking
      if (a.morale >= 4) total += 1;         // Confident: +1
      if (isSeriousWeapon(JN.frontHandItem(s, gathered[i]))) total += 1; // fixed bonus
      total += alien.strength >> 2;          // a hurt alien is easier to drive off
    }
    var roll = rng.nibble();
    if (roll === 15 || roll >= total) return; // stands firm
    // flees to a random adjacent room (re-rolled until it actually leaves)
    var guard = 0;
    do { MV.pickNextRoom(s, 0, rng); } while (alien.dest === alien.room && ++guard < 16);
    alien.room = alien.dest;
    alien.t = 0;
    for (i = 0; i < gathered.length; i++) {
      var f = s.actors[gathered[i]];
      f.courage = Math.min(f.courage + 1, 8);
      f.morale = f.morale + 1;
    }
  }

  // CrewAction5_AlienAttack: the alien's attack tick.
  function crewAction5(s, rng) {
    var alien = s.actors[0];
    var gathered = MV.occupantsAt(s, alien.room, MV.CREW);
    if (gathered.length === 0) return;
    var idx;
    if (gathered.length === 1) idx = 0;
    else if (gathered.length === 2) idx = rng.nibble() & 1;
    else idx = foldDir(rng.nibble() & 7);      // 3 victims -> 0..2

    while (gathered.length > 0) {
      var victim = gathered[idx];
      var v = s.actors[victim];
      if (v.status === 0) {                    // a live victim: drain a strength point
        v.strength -= 1;
        if (v.strength < 2) MO.collapseVictim(s, victim, gathered); // room-mates witness it
        else if (v.strength < 4) A.messages.enqueue(s, 10, { actor: victim });
        else A.messages.enqueue(s, 1, { actor: victim });
        return;
      }
      // a corpse: maybe drag it off-ship (only if not already carrying one)
      if (alien.courage === 0 && rng.nibble() < 4) {  // 4-in-16
        v.room = 255;
        alien.courage = victim;                // remember the dragged slot
        return;
      }
      gathered.splice(idx, 1);                  // try another gathered slot
      if (gathered.length === 0) {             // nobody left: move on
        MV.pickNextRoom(s, 0, rng);
        alien.state = 1; alien.t = 40;
        return;
      }
      idx = idx % gathered.length;
    }
  }

  A.combat = {
    crewHitsAlien: crewHitsAlien,
    alienKillPrimitive: alienKillPrimitive,
    alienScareCheck: alienScareCheck,
    crewAction5: crewAction5
  };
  if (typeof module !== "undefined" && module.exports) module.exports = A.combat;
})(typeof window !== "undefined" ? window : this);
