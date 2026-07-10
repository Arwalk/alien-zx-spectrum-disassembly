// Status-message table (MessageTextTable $8464). Substitution tokens:
//   %A = actor name (code 254), %T = target name (253), %R = room name (252).
// Apostrophe glyph (code 145) is written as a literal '.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});

  var MESSAGES = [
    "%A Sees Jones the Cat",               // 0
    "The ALIEN is attacking %A",           // 1
    "%A has captured Jones",               // 2
    "%A nets the ALIEN",                   // 3
    "%A hits the ALIEN",                   // 4
    "%A's Tracker is broken",              // 5
    "%A's extinguisher is empty",          // 6
    "%A's Laser is exhausted",             // 7
    "Structural Damage in %R",             // 8
    "WARNING:Fire in %R",                  // 9
    "%A is being wounded",                 // 10
    "%A prepares for hypersleep",          // 11
    "%A enters hypersleep",                // 12
    "DESTRUCT SEQUENCE INITIATED",         // 13
    "DESTRUCT SEQUENCE ABORTED",           // 14
    "Fire extinguished in %R",             // 15
    "WARNING:%RDEPRESSURISED",             // 16 (jammed on the tape — sic)
    "%R PRESSURE RESTORED",                // 17
    "INTRUDER ENTERING %R",                // 18
    "Jones is looking uneasy",             // 19
    "%A finds %T's body",                  // 20
    "%A has collapsed",                    // 21
    "Partial loss of control systems",     // 22
    "Computer Malfunction detected",       // 23
    "Environmental irregularities",        // 24
    "Narcissus status RED",                // 25
    "Oxygen status CRITICAL",              // 26
    "BioUnit Jones not present",           // 27
    "LAUNCH COUNTERMANDED",                // 28
    "%T is attacking %A",                  // 29
    "%A is attacking %T",                  // 30
    "%A nets %T",                          // 31
    "%A hits the Android",                 // 32
    "Alien has hatched from %A"            // 33
  ];

  // Resolve a message id + context {actor, target, room} (slot ids / room id).
  function render(id, ctx) {
    ctx = ctx || {};
    var names = A.data.crewNames;
    var rooms = A.data.roomNames;
    var s = MESSAGES[id] || "";
    if (ctx.actor != null) s = s.replace(/%A/g, names[ctx.actor] || "");
    if (ctx.target != null) s = s.replace(/%T/g, names[ctx.target] || "");
    if (ctx.room != null) s = s.replace(/%R/g, rooms[ctx.room & 63] || "");
    return s;
  }

  // Enqueue a rendered message into the state log (with simple dup suppression).
  function enqueue(state, id, ctx) {
    var text = render(id, ctx);
    if (text === state.lastLog) return text; // collapse immediate repeats
    state.lastLog = text;
    state.log.push({ frame: state.frame, id: id, text: text });
    if (state.log.length > 200) state.log.shift();
    return text;
  }

  A.messages = { table: MESSAGES, render: render, enqueue: enqueue };
  if (typeof module !== "undefined" && module.exports) module.exports = A.messages;
})(typeof window !== "undefined" ? window : this);
