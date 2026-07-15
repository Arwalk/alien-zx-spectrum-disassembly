// Long-Game initialization — LongGameInit -> CommonGameInit ($A524/$A58C).
// Reproduces the exact init sequence from PORT_REFERENCE §4.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, ST = A.state;

  function longGameInit(rng) {
    var s = ST.createState();

    // 1. reset script/message state (rng is our script stream) — nothing to do
    //    beyond a fresh state; the rng is already seeded.
    s.lastLog = "";

    // 2. copy the 64-byte crew template into the 8 actor records.
    var tpl = D.longGameCrewInit;
    for (var k = 0; k < 8; k++) {
      var a = s.actors[k], b = k * 8;
      a.t = a.t0 = tpl[b]; a.room = tpl[b + 1]; a.dest = tpl[b + 2]; a.state = tpl[b + 3];
      a.strength = tpl[b + 4]; a.courage = tpl[b + 5]; a.morale = tpl[b + 6]; a.status = tpl[b + 7];
    }

    // 3. pick the chestburster host (slot in {1,2,5}); reseat Brett into its seat.
    var host = D.hostSlotTable[rng.nibble()];
    s.hostSlot = host;
    s.actors[7].room = s.actors[host].room; // Brett takes the host's seat
    s.actors[host].room = ST.HOST_MARKER;   // $FF in +1
    s.actors[host].status = ST.HOST_MARKER; // $FF in +7 (removed)

    // 4. pick the android (slot in {1,2,4,6}), != host.
    var android;
    do { android = D.targetTable[rng.nibble()]; } while (android === host);
    s.alienTargetID = android;

    // 5. opening message #33 "Alien has hatched from {host}".
    A.messages.enqueue(s, 33, { actor: host });

    // 6. CommonGameInit.
    s.alienActive = 0;
    s.androidActivated = false;

    // place items
    for (var i = 0; i < 22; i++) s.items[i] = D.initialItemRooms[i];
    for (i = 0; i < 16; i++) s.itemCharges[i] = D.itemChargesInit[i];

    // grilles: rooms 0..32 in place, room 13 removed, room 33 always open.
    for (i = 0; i < 34; i++) s.roomGrille[i] = 255;
    s.roomGrille[13] = 0;
    s.roomGrille[33] = 0;

    s.shipFlags = 0;

    // Jones starts in a random room 0..15.
    s.jonesRoom = rng.nibble();
    s.jonesMoveTimer = D.K.JONES_MOVE_FRAMES;

    // alien lair: nibble -> AlienInitTable, then OR 64 (starts in the ducts above).
    s.actors[0].room = D.alienInitTable[rng.nibble()] | 64;
    s.actors[0].strength = 0; // wound counter starts at 0
    s.actors[0].courage = 0;  // dragged-corpse slot: none
    s.actors[0].status = 0;

    // damage meters all 0; oxygen 7500; deck 1 (UI).
    for (i = 0; i < 35; i++) s.roomDamage[i] = 0;
    s.oxygen = D.K.OXYGEN_START;
    s.oxygenTick = 10; // OxygenTickInit's boot value ($95D5)
    s.deck = 1;

    // GameEntry's one-time UpdateAllCrew pass ($B159), run before the main
    // loop: every same-room crew pair mutually adds (partner courage - 2) to
    // morale — the dinner-scene trios open around morale 6-7. No clamps (all
    // starting courage is 3+, so no underflow can occur).
    for (var p = 1; p < 8; p++) {
      for (var q = p + 1; q < 8; q++) {
        var ap = s.actors[p], aq = s.actors[q];
        if (ap.room !== aq.room) continue;
        aq.morale += ap.courage - 2;
        ap.morale += aq.courage - 2;
      }
    }

    return s;
  }

  A.init = { longGameInit: longGameInit };
  if (typeof module !== "undefined" && module.exports) module.exports = A.init;
})(typeof window !== "undefined" ? window : this);
