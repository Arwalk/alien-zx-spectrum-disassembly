// Movement + a handful of shared low-level helpers used across subsystems.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data;

  // SetActionTimer: countdown = base + ActionTimeBySlot[slot] + ActionTimeByStrength[str&7].
  function setActionTimer(s, slot, base) {
    var str = s.actors[slot].strength & 7;
    s.actors[slot].t = base + D.actionTimeBySlot[slot] + D.actionTimeByStrength[str];
  }

  // Slots among `slots` whose current-room byte (+1) equals `spot` (room+duct bit).
  function occupantsAt(s, spot, slots) {
    var out = [];
    for (var i = 0; i < slots.length; i++) {
      if (s.actors[slots[i]].room === spot) out.push(slots[i]);
    }
    return out;
  }
  var CREW = [1, 2, 3, 4, 5, 6, 7];
  var ALL = [0, 1, 2, 3, 4, 5, 6, 7];

  // PickNextRoom: choose a destination for actor `slot` and write it to +2.
  // Uses the corridor graph, or the duct graph when the current-room bit6 is set.
  function pickNextRoom(s, slot, rng) {
    var a = s.actors[slot];
    var cur = a.room;
    var inDucts = (cur & 64) !== 0;
    var base = (cur & 63) * 5;
    var map = inDucts ? D.roomAdjDucts : D.roomAdjCorridors;
    var dir = rng.direction();
    var dest = map[base + dir];
    if (dest === undefined) dest = cur & 63; // duct graph has no room 34
    if (inDucts) dest |= 64;
    a.dest = dest;
    return dest;
  }

  // MoveThroughGrille: queue a duct transit — same room, bit6 flipped.
  function moveThroughGrille(s, slot) {
    setActionTimer(s, slot, D.K.MOVE_BASE);
    s.actors[slot].state = 2;
    s.actors[slot].dest = s.actors[slot].room ^ 64;
  }

  A.movement = {
    setActionTimer: setActionTimer,
    occupantsAt: occupantsAt,
    pickNextRoom: pickNextRoom,
    moveThroughGrille: moveThroughGrille,
    CREW: CREW, ALL: ALL
  };
  if (typeof module !== "undefined" && module.exports) module.exports = A.movement;
})(typeof window !== "undefined" ? window : this);
