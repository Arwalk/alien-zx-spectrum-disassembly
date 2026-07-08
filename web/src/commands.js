// Player command layer: translate UI intents (click crew, click room, pick
// item, fire fixture) into queued/immediate crew orders. Mirrors the action
// menu's move/use/special/fixture groups.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, MV = A.movement, MO = A.morale, JN = A.jones;
  var bonus = D.itemCourageBonus;
  function b(id) { return id === 255 ? 0 : (bonus[id] || 0); }

  // --- queued orders (fire on the countdown) -----------------------------
  function moveTo(s, slot, destByte) {           // door/duct move
    MV.setActionTimer(s, slot, D.K.MOVE_BASE);
    s.actors[slot].state = 1;
    s.actors[slot].dest = destByte;
  }
  function moveThroughGrille(s, slot) { MV.moveThroughGrille(s, slot); }
  function removeGrille(s, slot) {               // timed RmveGrille job
    MV.setActionTimer(s, slot, D.grilleTimeBySlot[slot]);
    s.actors[slot].state = 3;
  }
  function attackOrder(s, slot) {                // queue an ATTACK
    MV.setActionTimer(s, slot, 40);
    s.actors[slot].state = 4;
  }
  function cancelOrder(s, slot) {                // front-hand row: cancel pending job
    s.actors[slot].t = 0; s.actors[slot].state = 0;
  }

  // --- immediate item actions --------------------------------------------
  function swapHands(s, slot) {
    var a = s.actors[slot];
    a.t = 0;
    var front = JN.frontHandItem(s, slot), back = JN.backHandItem(s, slot);
    var delta = b(back) - b(front);
    a.courage = MO.clamp0(a.courage + delta);
    a.morale = MO.clamp0(a.morale + delta);
    if (front !== 255) s.items[front] -= 32; // 160+slot -> 128+slot
    if (back !== 255) s.items[back] += 32;   // 128+slot -> 160+slot
  }
  function getItem(s, slot, itemId) {
    var a = s.actors[slot];
    a.t = 0;
    if (JN.frontHandItem(s, slot) === 255) {   // front hand free
      a.courage += b(itemId);
      a.morale += b(itemId);
      s.items[itemId] = 160 + slot;
    } else {
      s.items[itemId] = 128 + slot;            // into the back hand
    }
  }
  function leaveItem(s, slot) {
    var a = s.actors[slot];
    a.t = 0;
    var back = JN.backHandItem(s, slot);
    if (back !== 255) { s.items[back] = a.room; return; } // drop back item (no bonus)
    var front = JN.frontHandItem(s, slot);
    if (front === 255) return;
    a.courage = MO.clamp0(a.courage - b(front));
    a.morale = MO.clamp0(a.morale - b(front));
    s.items[front] = a.room;
  }

  // --- helpers for the UI ------------------------------------------------
  // Items lying loose in the viewed room's floor (ids the player can Get).
  function roomFloorItems(s, roomByte) {
    var out = [];
    for (var i = 0; i < 22; i++) if (s.items[i] === roomByte) out.push(i);
    return out;
  }
  // Rooms a crew member can move to from their current spot (deduped door/duct
  // exits), plus a Grille toggle when this room's grille is removed.
  function moveOptions(s, slot) {
    var a = s.actors[slot];
    var room = a.room & 63, inDucts = (a.room & 64) !== 0;
    var map = inDucts ? D.roomAdjDucts : D.roomAdjCorridors;
    var base = room * 5, seen = {}, opts = [];
    for (var dir = 0; dir < 5; dir++) {
      var dest = map[base + dir];
      if (dest === undefined || dest === room) continue; // no exit that way
      var byte = inDucts ? (dest | 64) : dest;
      if (seen[byte]) continue;
      seen[byte] = 1;
      opts.push({ room: dest, byte: byte, grille: false });
    }
    if (room < 34 && s.roomGrille[room] === 0) opts.push({ grille: true });
    return opts;
  }
  // The special action available in the viewed room, if any.
  function specialFor(s, slot) {
    var a = s.actors[slot];
    var room = a.room & 63, inDucts = (a.room & 64) !== 0;
    // ATTACK when a hostile shares the spot
    var alien = s.actors[0];
    if (alien.room === a.room) return { kind: "attack" };
    if (s.alienActive && s.actors[s.alienTargetID].room === a.room && s.alienTargetID !== slot)
      return { kind: "attack" };
    if (!inDucts && room < 34 && s.roomGrille[room] === 255) return { kind: "grille" }; // can remove
    return null;
  }

  A.commands = {
    moveTo: moveTo, moveThroughGrille: moveThroughGrille, removeGrille: removeGrille,
    attackOrder: attackOrder, cancelOrder: cancelOrder,
    swapHands: swapHands, getItem: getItem, leaveItem: leaveItem,
    roomFloorItems: roomFloorItems, moveOptions: moveOptions, specialFor: specialFor
  };
  if (typeof module !== "undefined" && module.exports) module.exports = A.commands;
})(typeof window !== "undefined" ? window : this);
