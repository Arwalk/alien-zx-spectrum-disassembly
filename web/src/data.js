// Static game data — transcribed byte-for-byte from the Alien (BUGFIX 1.7)
// disassembly (alien.skool). See PORT_REFERENCE_LongGame.md Data Appendix A.
// Do not "tidy" these numbers — they are hand-authored ship topology & balance.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});

  // --- rooms -------------------------------------------------------------
  var roomNames = [
    "Airlock #1", "Airlock #2", "Armoury", "Cargopod#1", "Cargopod#2",
    "Cargopod#3", "CommdCentr", "Computer", "Corridor#1", "Corridor#2",
    "Corridor#3", "Corridor#4", "Corridor#5", "Corridor#6", "Corridor#7",
    "Cryo Vault", "Engineerng", "Engine #1", "Engine #2", "Engine #3",
    "Eng Stores", "Infirmary", "Inf Stores", "Laboratory", "Lab Stores",
    "Life Suppt", "Livng Qtrs", "Mess", "RecrtnArea", "Stores #1",
    "Stores #2", "Stores #3", "ShuttleBay", "Shttlstore", "Narcissus"
  ];

  // Door adjacency graph — 35 rooms x 5 direction slots (slot==own id = no exit).
  var roomAdjCorridors = [
    13,13,0,0,0,   13,13,1,1,1,   10,10,10,2,2,   4,4,3,3,3,     32,3,14,5,9,
    4,4,5,5,5,     8,8,8,6,6,      13,13,30,30,7,  6,21,9,23,26,  8,4,10,15,12,
    9,22,2,17,11,  10,10,12,12,18, 9,24,29,19,11,  27,0,7,31,1,   4,4,25,25,14,
    9,9,15,15,15,  32,32,20,20,16, 10,10,17,17,17, 11,11,18,18,18,12,12,19,19,19,
    16,16,16,20,20,8,8,8,21,21,    10,10,10,22,22, 8,8,8,23,23,    12,12,12,24,24,
    14,14,25,25,25,28,8,27,27,26,  26,28,13,27,27, 26,26,27,27,28,12,12,12,29,29,
    7,7,30,30,30,  13,13,31,31,31, 33,34,4,16,32,  32,32,32,33,33,32,32,32,34,34
  ];

  // Air-duct adjacency graph — 34 rooms (0..33) x 5 slots (no Narcissus).
  var roomAdjDucts = [
    0,30,27,26,0,   27,3,1,28,27,  2,11,11,22,22,  33,14,14,3,3,   4,14,14,14,4,
    5,14,20,20,5,   6,8,8,6,6,      7,18,18,13,13,  21,8,23,6,8,    10,10,12,12,9,
    22,10,9,21,10,  2,18,29,15,2,   9,9,24,23,23,   30,7,31,27,13,  3,25,5,4,14,
    15,11,11,15,15, 16,16,20,32,32, 17,18,18,17,17, 17,7,19,11,25,  19,18,18,19,19,
    16,5,5,20,20,   21,10,8,8,21,   2,10,10,22,22,  8,12,12,23,23,  24,12,29,29,24,
    25,25,14,18,18, 26,0,28,28,26,  0,13,1,27,27,   26,1,1,28,28,   29,11,11,24,29,
    30,30,13,0,13,  13,13,31,1,31,  33,33,16,32,32, 33,3,3,32,32
  ];

  // Per-room view/deck type: 0/1/2 = deck map, 3 = Narcissus, (4 = encounter).
  var roomTypeTable = [
    0,0,1,2,2,2,1,0,1,1,1,1,1,0,2,1,2,1,1,1,2,1,1,1,1,2,0,0,0,1,0,0,2,2,3
  ];

  // --- crew --------------------------------------------------------------
  var crewNames = ["ALIEN", "Dallas", "Kane", "Ripley", "Ash", "Lambert", "Parker", "Brett"];

  // Long-Game 64-byte crew template: 8 slots x [t,room,dest,state,str,cour,mor,status]
  var longGameCrewInit = [
    0,0,0,0,0,0,0,0,   0,6,0,0,6,4,4,0,   0,6,0,0,5,4,4,0,   0,6,0,0,4,3,3,0,
    0,27,0,0,5,4,4,0,  0,27,0,0,6,4,4,0,  0,27,0,0,6,4,4,0,  0,0,0,0,5,3,3,0
  ];

  // Nibble-indexed pick tables (host in {1,2,5}, android in {1,2,4,6}).
  var hostSlotTable = [1,2,5,1,2,5,1,2,5,1,2,5,1,2,5,2];
  var targetTable = [1,2,4,6,1,2,4,6,1,2,4,6,1,2,4,6];
  // Alien lair rooms (looked-up value | 64 = starts in the ducts above the room).
  var alienInitTable = [3,4,5,9,10,11,13,14,18,19,20,20,22,24,25,30];

  // --- items -------------------------------------------------------------
  // The tape's own 10-char strings (ItemIdToString $7C71 -> entries 35-43,
  // 68/69), trailing padding trimmed.
  var itemNames = [
    "Elctrc Prd", "Elctrc Prd", "Elctrc Prd", "Incineratr",
    "Incineratr", "Incineratr", "Tracker", "Tracker", "Fire Extng",
    "Fire Extng", "Fire Extng", "Fire Extng", "Harpn Gun", "Laser Pist",
    "Laser Pist", "Laser Pist", "Net", "Cat Box", "Spanner", "Spanner",
    "Cat in Net", "Cat in Box"
  ];
  var initialItemRooms = [24,21,20,6,6,16,6,16,27,17,18,19,32,2,2,2,24,23,31,20,255,255];
  var itemChargesInit = [0,0,0,0,0,0,0,0,3,3,3,3,1,8,8,8];
  var itemCourageBonus = [1,1,1,2,2,2,0,0,1,1,1,1,2,2,2,2,0,0,1,1,1,1];

  // --- timers / thresholds ----------------------------------------------
  var actionTimeBySlot = [0,7,5,0,7,3,10,5];
  var actionTimeByStrength = [0,0,48,16,0,0,0,0];
  var grilleTimeBySlot = [0,100,120,180,100,180,80,80];
  var jonesCatchBySlot = [0,14,14,13,13,13,15,14];

  var K = {
    ALIEN_KILL_THRESHOLD: 15,
    ANDROID_TRIGGER_WOUNDS: 6,
    MOVE_BASE: 64,
    HYPERSLEEP_BASE: 255,
    BLOCKED_REQUEUE: 32,
    ALIEN_ATTACK_T: 60,
    ALIEN_WANDER_T: 80,
    ALIEN_GRILLE_T: 50,
    ANDROID_ATTACK_T: 40,
    ANDROID_WANDER_T: 60,
    OXYGEN_START: 7500,
    OXYGEN_CRITICAL: 500,
    DESTRUCT_SECONDS: 300,      // 5:00
    DESTRUCT_FRAMES_PER_SEC: 20,
    ROOM_CAP: 3,
    JONES_MOVE_FRAMES: 255,
    NO_ANDROID: 9               // AlienTargetID sentinel (Short Game)
  };

  // Injury/morale display bands.
  // DrawCrewCondition $7E81: strength 0/1/2 index as-is, 3 ALSO shows
  // "Wounded" — only 4+ reads "OK".
  var injuryText = ["Dead", "Collapsed", "Wounded", "OK"];
  var moraleText = ["Broken", "Shaken", "Uneasy", "Stable", "Confident"]; // by morale 0..4

  // Room ids referenced by rules.
  var ROOM = {
    AIRLOCK1: 0, AIRLOCK2: 1, ARMOURY: 2, COMMD: 6, COMPUTER: 7,
    CORRIDOR6: 13, CRYO: 15, ENGINEERNG: 16, ENGINE1: 17, ENGINE2: 18,
    ENGINE3: 19, LIFE_SUPPT: 25, SHUTTLEBAY: 32, SHTTLSTORE: 33, NARCISSUS: 34
  };

  // Map an item id to its display-name index (mirrors ItemIdToString CP-chain).
  function itemName(id) {
    if (id >= 0 && id < itemNames.length) return itemNames[id];
    return "";
  }

  A.data = {
    roomNames: roomNames,
    roomAdjCorridors: roomAdjCorridors,
    roomAdjDucts: roomAdjDucts,
    roomTypeTable: roomTypeTable,
    crewNames: crewNames,
    longGameCrewInit: longGameCrewInit,
    hostSlotTable: hostSlotTable,
    targetTable: targetTable,
    alienInitTable: alienInitTable,
    itemNames: itemNames,
    initialItemRooms: initialItemRooms,
    itemChargesInit: itemChargesInit,
    itemCourageBonus: itemCourageBonus,
    actionTimeBySlot: actionTimeBySlot,
    actionTimeByStrength: actionTimeByStrength,
    grilleTimeBySlot: grilleTimeBySlot,
    jonesCatchBySlot: jonesCatchBySlot,
    injuryText: injuryText,
    moraleText: moraleText,
    K: K,
    ROOM: ROOM,
    itemName: itemName
  };

  if (typeof module !== "undefined" && module.exports) module.exports = A.data;
})(typeof window !== "undefined" ? window : this);
