// Morale & courage. RecalcMorale / MoraleFromCompanion / DecayCrewCourage and
// the shared "actor dies / collapses" helpers.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data;

  function clamp0(v) { return v < 0 ? 0 : v; }

  // DecayCrewCourage: grim events cost the whole crew -1 courage and -1 morale.
  function decayCrewCourage(s) {
    for (var k = 1; k < 8; k++) {
      s.actors[k].courage = clamp0(s.actors[k].courage - 1);
      s.actors[k].morale = clamp0(s.actors[k].morale - 1);
    }
  }

  // Drop everything slot `k` carries onto its current-room floor.
  function dropHeldItems(s, k) {
    var room = s.actors[k].room;
    for (var i = 0; i < 22; i++) {
      var loc = s.items[i];
      if (loc === 160 + k || loc === 128 + k) s.items[i] = room;
    }
  }

  // KillActorMoraleHit ($B211): stamp the victim dead (+7 = 1) and shake the
  // witnesses — each live one loses 1 morale. With at least one live witness
  // the death is seen at once: the body is already "found" (+7 = 2), msg #20
  // fires (actor = the last live witness scanned) and the whole crew's courage
  // decays. Unwitnessed, the body stays at status 1 for a later discovery via
  // moraleFromCompanion. Strength stays as drained (a status-1 corpse can
  // still read "Collapsed" on the condition line — authentic).
  function killActorMoraleHit(s, victim, witnesses) {
    s.actors[victim].status = 1;
    var lastLive = -1;
    for (var i = 0; i < witnesses.length; i++) {
      var w = witnesses[i];
      if (w === 255 || w === victim) continue;
      var wa = s.actors[w];
      if (wa.status !== 0) continue;
      wa.morale = clamp0(wa.morale - 1);
      lastLive = w;
    }
    if (lastLive >= 0) {
      s.actors[victim].status = 2;
      A.messages.enqueue(s, 20, { actor: lastLive, target: victim });
      decayCrewCourage(s);
    }
  }

  // A victim collapses under attack (VictimItemDrop $99E8): the witness morale
  // hit, park the countdown, drop everything, msg #21. (The original logs #21
  // only when the victim is the viewed crew member; the port's log shows
  // everything — a documented UI adaptation.)
  function collapseVictim(s, k, witnesses) {
    killActorMoraleHit(s, k, witnesses || []);
    s.actors[k].t = 0;
    dropHeldItems(s, k);
    A.messages.enqueue(s, 21, { actor: k });
  }

  // Compute one crew member's morale from courage + up to two companions.
  function moraleFromCompanion(s, cSlot, companions) {
    if (cSlot === 255) return;
    var c = s.actors[cSlot];
    if (c.status !== 0) return; // dead/removed: no morale to compute
    var acc = 0;
    for (var i = 0; i < companions.length; i++) {
      var comp = companions[i];
      if (comp === 255) continue;
      var cc = s.actors[comp];
      if (cc.status === 0) {
        acc += cc.courage - 2;           // brave friend reassures, coward unnerves
      } else if (cc.status === 1) {       // a freshly dead body: "found"
        decayCrewCourage(s);
        A.messages.enqueue(s, 20, { actor: cSlot, target: comp });
        cc.status = 2;                    // found once
        acc -= 1;
      } else {
        acc -= 1;                         // already-found corpse / removed
      }
    }
    // standing in a tracker "all clear" room is worth +1
    for (var j = 0; j < 3; j++) if (s.nearRoomList[j] === c.room) { acc += 1; break; }
    c.morale = clamp0(c.courage + acc);
  }

  // RecalcMorale: after an actor moves, find its room-mates (same spot) and
  // recompute the (self, mateA, mateB) trio's morale, each with the other two
  // as companions. The alien (slot 0) has no morale.
  function recalcMorale(s, slot) {
    if (slot === 0) return;
    var spot = s.actors[slot].room;
    var mates = [255, 255];
    var n = 0;
    for (var k = 1; k < 8; k++) {
      if (k === slot) continue;
      if (s.actors[k].room === spot && n < 2) { mates[n++] = k; }
    }
    var trio = [slot, mates[0], mates[1]];
    // each member's companions = the other two of the trio
    moraleFromCompanion(s, trio[0], [trio[1], trio[2]]);
    moraleFromCompanion(s, trio[1], [trio[2], trio[0]]);
    moraleFromCompanion(s, trio[2], [trio[0], trio[1]]);
  }

  A.morale = {
    clamp0: clamp0,
    decayCrewCourage: decayCrewCourage,
    dropHeldItems: dropHeldItems,
    killActorMoraleHit: killActorMoraleHit,
    collapseVictim: collapseVictim,
    moraleFromCompanion: moraleFromCompanion,
    recalcMorale: recalcMorale
  };
  if (typeof module !== "undefined" && module.exports) module.exports = A.morale;
})(typeof window !== "undefined" ? window : this);
