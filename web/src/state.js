// The game state block — the whole "save state". Everything the simulation
// reads/writes each frame. Rendering is a pure function of this. Actor records
// mirror the 8-byte ActorRecords ($737E): fields named for offsets +0..+7.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var K = A.data.K;

  var HOST_MARKER = 255; // $FF in +1/+7 = removed from play (chestburster host)

  function makeActor() {
    // t0 is render-only: the countdown's starting value, so the map can show
    // order progress. The engine never reads it.
    return { t: 0, t0: 0, room: 0, dest: 0, state: 0, strength: 0, courage: 0, morale: 0, status: 0 };
  }

  function createState() {
    var s = {
      frame: 0,
      actors: [],
      items: new Array(22),          // ItemLocations
      itemCharges: new Array(16),    // ItemCharges
      roomDamage: new Array(35),     // per-room damage (multiple of 5, 0..100)
      roomGrille: new Array(34),     // 255 in place / 0 removed
      shipFlags: 0,                  // ShipSystemFlags
      oxygen: K.OXYGEN_START,        // 4-digit counter value
      oxygenTick: 10,                // frames until next drain (OxygenTickInit boots at 10)
      oxygenCritFired: false,
      shipTick: 50,                  // ship-systems tick (boots at 50, reloads with 100)
      eventPace: 0,                  // gates the tracker beep to every 8th pass
      engineFix: [0, 0, 0],          // per-engine fire-fighting progress
      destructArmed: false,
      destructSeconds: 0,            // countdown seconds left once armed (5:00 = 300)
      destructSub: 0,                // 20-frame sub-tick toward the next second
      alienTargetID: K.NO_ANDROID,   // android slot, or 9 = none
      alienActive: 0,                // 0 dormant / 255 hostile android
      androidActivated: false,       // one-shot activation guard
      hostSlot: -1,                  // chestburster host slot
      jonesRoom: 255,
      jonesMoveTimer: K.JONES_MOVE_FRAMES,
      nearRoomList: [255, 255, 255], // tracker "all-clear" rooms
      log: [],                       // status-message history
      lastLog: "",                   // duplicate-suppression marker
      trackerBeep: false,            // set when a viewed tracker beeps this frame
      encounterSlot: -1,             // crew slot the alien is currently mauling (view type 4)
      gameOver: null                 // { kind, text[], rating }
    };
    for (var i = 0; i < 8; i++) s.actors.push(makeActor());
    return s;
  }

  // --- actor helpers -----------------------------------------------------
  function roomId(a) { return a.room & 63; }
  function inDuct(a) { return (a.room & 64) !== 0; }
  function isHost(a) { return a.room === HOST_MARKER || a.status === HOST_MARKER; }
  // "live actor" for oxygen / occupancy: status byte +7 == 0 (alien included).
  function isLive(a) { return a.status === 0; }

  // Living human crew slots (1..7), excluding the android, for scoring / survivor check.
  function livingHumanCrew(s) {
    var out = [];
    for (var k = 1; k < 8; k++) {
      if (k === s.alienTargetID) continue;
      if (s.actors[k].status === 0) out.push(k);
    }
    return out;
  }

  // Count live actors over all 8 slots (status +7 == 0) — oxygen drain rate.
  function liveActorCount(s) {
    var n = 0;
    for (var k = 0; k < 8; k++) if (s.actors[k].status === 0) n++;
    return n;
  }

  A.state = {
    HOST_MARKER: HOST_MARKER,
    createState: createState,
    makeActor: makeActor,
    roomId: roomId,
    inDuct: inDuct,
    isHost: isHost,
    isLive: isLive,
    livingHumanCrew: livingHumanCrew,
    liveActorCount: liveActorCount
  };
  if (typeof module !== "undefined" && module.exports) module.exports = A.state;
})(typeof window !== "undefined" ? window : this);
