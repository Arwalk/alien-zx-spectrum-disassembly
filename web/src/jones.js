// Jones the cat — wander (UpdateJones) and the "Get Jones" catch roll.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, MO = A.morale;

  // Walk Jones one room when his timer expires. Re-rolls if he would step into
  // the alien's (floor) room; enqueues msg #0 when a live crew shares his room.
  function updateJones(s, rng) {
    if (s.jonesRoom === 255) return;        // caught / off-map
    if (--s.jonesMoveTimer !== 0) return;   // not due yet
    s.jonesMoveTimer = D.K.JONES_MOVE_FRAMES;

    var guard = 0;
    while (true) {
      var base = (s.jonesRoom % 35) * 5;
      var dir = rng.direction();
      s.jonesRoom = D.roomAdjCorridors[base + dir];
      // The cat refuses to share with the alien (on the floor): re-roll.
      if (s.actors[0].room === s.jonesRoom && ++guard < 8) continue;
      break;
    }

    // Any living crew member in Jones's new room notices him.
    for (var k = 1; k < 8; k++) {
      if (s.actors[k].room === s.jonesRoom && s.actors[k].status === 0) {
        A.messages.enqueue(s, 0, { actor: k });
        break;
      }
    }
  }

  // "Get Jones" (menu row 14): needs the Net (16) or Cat Box (17) in the front
  // hand. Roll a nibble against JonesCatchBySlot[slot]; the Net lowers the
  // threshold by 4. Succeeds when nibble >= threshold.
  function getJones(s, slot, rng) {
    var a = s.actors[slot];
    a.t = 0;
    var front = frontHandItem(s, slot);
    if (front !== 16 && front !== 17) return false; // no catching tool
    var thr = D.jonesCatchBySlot[slot];
    if (front === 16) thr -= 4;                       // Net is easier
    var roll = rng.nibble();
    if (roll < thr) {                                 // failed: the cat bolts
      A.messages.enqueue(s, 34, { actor: slot });     // port-only: log the escape
      s.jonesMoveTimer = 1;
      updateJones(s, rng);
      return false;
    }
    // caught: the tool becomes "Cat in Net"/"Cat in Box" (tool+4) in the front hand
    s.items[front] = 255;
    s.items[front + 4] = 160 + slot;
    s.jonesRoom = 255;
    a.courage = MO.clamp0(a.courage + 1);
    a.morale = MO.clamp0(a.morale + 1);
    A.messages.enqueue(s, 2, { actor: slot });
    return true;
  }

  // Item id in a slot's front hand (marker 160+slot), or 255 = empty hands.
  function frontHandItem(s, slot) {
    for (var i = 0; i < 22; i++) if (s.items[i] === 160 + slot) return i;
    return 255;
  }
  function backHandItem(s, slot) {
    for (var i = 0; i < 22; i++) if (s.items[i] === 128 + slot) return i;
    return 255;
  }

  A.jones = { updateJones: updateJones, getJones: getJones,
              frontHandItem: frontHandItem, backHandItem: backHandItem };
  if (typeof module !== "undefined" && module.exports) module.exports = A.jones;
})(typeof window !== "undefined" ? window : this);
