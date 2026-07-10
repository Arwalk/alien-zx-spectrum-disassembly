// Headless engine parity tests: assert the exact constants & rules the game
// relies on. Run: node web/test/parity.js
const { loadEngine } = require("./harness.js");
const A = loadEngine();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; console.log("  FAIL:", name, detail != null ? "-> " + detail : ""); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// Deterministic RNG stub: feed a fixed nibble sequence for combat tests.
function fixedRng(seq) {
  let i = 0;
  return {
    nibble() { return seq[i++ % seq.length]; },
    direction() { const n = this.nibble(); return n < 3 ? 0 : n < 6 ? 1 : n < 9 ? 2 : n < 12 ? 3 : 4; },
    reseed() {}
  };
}

// 1. init sanity
(function () {
  const r = new A.RNG(999);
  const s = A.init.longGameInit(r);
  ok("host removed", s.actors[s.hostSlot].status === 255 && s.actors[s.hostSlot].room === 255);
  ok("android != host", s.alienTargetID !== s.hostSlot && [1,2,4,6].includes(s.alienTargetID));
  ok("brett reseated", s.actors[7].room === 6 || s.actors[7].room === 27);
  ok("alien in ducts", (s.actors[0].room & 64) !== 0);
  ok("jones 0-15", s.jonesRoom >= 0 && s.jonesRoom <= 15);
  ok("opening msg", s.log[0].id === 33);
  ok("items placed", s.items[12] === 32 && s.items[0] === 24);
})();

// 2. weighted 5-way direction ~ 3:3:3:3:4 over many rolls
(function () {
  const r = new A.RNG(4242);
  const c = [0,0,0,0,0];
  const N = 160000;
  for (let i = 0; i < N; i++) c[r.direction()]++;
  const exp3 = N * 3 / 16, exp4 = N * 4 / 16;
  ok("dir 0 ~3/16", approx(c[0], exp3, exp3 * 0.05), c[0]);
  ok("dir 4 ~4/16", approx(c[4], exp4, exp4 * 0.05), c[4]);
  ok("dir4 > dir0", c[4] > c[0]);
})();

// helper: fresh game with alien on the floor of room 8, one attacker there
function combatSetup(weaponId, attacker) {
  const r = new A.RNG(1);
  const s = A.init.longGameInit(r);
  s.alienActive = 0;
  s.actors[0].room = 8; s.actors[0].strength = 0;
  const a = s.actors[attacker];
  a.room = 8; a.strength = 5; a.morale = 4; a.state = 0; a.status = 0;
  // clear all item locations, then arm the attacker's front hand
  for (let i = 0; i < 22; i++) s.items[i] = 255;
  s.itemCharges[8] = 3; s.itemCharges[9] = 3; s.itemCharges[10] = 3; s.itemCharges[11] = 3;
  s.itemCharges[12] = 1; s.itemCharges[13] = 8; s.itemCharges[14] = 8; s.itemCharges[15] = 8;
  if (weaponId != null) s.items[weaponId] = 160 + attacker;
  return { s, r };
}

// 3. alien dies at 15 wounds (prod hits). state != 4 so it never scares/flees.
(function () {
  const { s } = combatSetup(0, 3);           // Electric Prod in Ripley's front hand
  const rng = fixedRng([0]);                 // scare rolls: nibble 0 (total 0 -> stays)
  for (let i = 0; i < 14; i++) A.combat.crewHitsAlien(s, 3, rng);
  ok("14 wounds not dead", s.actors[0].strength === 14 && !s.gameOver, s.actors[0].strength);
  A.combat.crewHitsAlien(s, 3, rng);         // 15th
  ok("15 wounds -> alien killed", s.gameOver && s.gameOver.kind === "alienKilled");
})();

// 4. laser: +2 wound, +6 room damage (30 -> tens 3), uses a charge
(function () {
  const { s } = combatSetup(13, 3);          // Laser Pistol
  s.actors[0].room = 17;                     // Engine #1 (so damage-30 lights a fire)
  s.actors[3].room = 17;
  const rng = fixedRng([0]);
  A.combat.crewHitsAlien(s, 3, rng);
  ok("laser +2 wound", s.actors[0].strength === 2, s.actors[0].strength);
  ok("laser +6 dmg = 30", s.roomDamage[17] === 30, s.roomDamage[17]);
  ok("laser used a charge", s.itemCharges[13] === 7, s.itemCharges[13]);
  ok("engine on fire (bit3)", (s.shipFlags & 8) !== 0);
})();

// 5. harpoon kills firer + bystanders, wipes items, +5 alien wound, +15 dmg
(function () {
  const { s } = combatSetup(12, 3);          // Harpoon Gun to Ripley
  s.actors[2].room = 8; s.actors[2].status = 0; s.actors[2].strength = 5; // Kane bystander
  s.items[5] = 8;                            // a floor item in the alien's room
  s.items[13] = 128 + 2;                     // Kane holds a laser (back hand)
  const rng = fixedRng([0]);
  A.combat.crewHitsAlien(s, 3, rng);
  ok("harpoon killed firer", s.actors[3].status === 1 && s.actors[3].strength === 0);
  ok("harpoon killed bystander", s.actors[2].status === 1);
  ok("harpoon wiped floor item", s.items[5] === 255);
  ok("harpoon wiped held item", s.items[13] === 255);
  ok("harpoon alien +5", s.actors[0].strength === 5, s.actors[0].strength);
  ok("harpoon +15 dmg", s.roomDamage[8] === 75, s.roomDamage[8]);
})();

// 6. oxygen period = 2 x live actors
(function () {
  const r = new A.RNG(7);
  const s = A.init.longGameInit(r);
  const live = A.state.liveActorCount(s);
  s.oxygen = 7500; s.oxygenTick = 1; s.oxygenCritFired = false;
  A.ship.oxygenTick(s);                       // first drop, reload = 2*live
  ok("oxygen dropped 1", s.oxygen === 7499, s.oxygen);
  ok("period = 2*live", s.oxygenTick === 2 * live, s.oxygenTick + " vs " + 2 * live);
  for (let i = 0; i < 2 * live; i++) A.ship.oxygenTick(s);
  ok("second drop after period", s.oxygen === 7498, s.oxygen);
})();

// 7. LaunchGate (fixed): needs ALL living crew + Jones aboard
(function () {
  const r = new A.RNG(11);
  const s = A.init.longGameInit(r);
  const crew = A.state.livingHumanCrew(s);
  // everyone (incl. android if alive) aboard, Jones aboard
  for (let k = 1; k < 8; k++) if (s.actors[k].status === 0) s.actors[k].room = 34;
  s.jonesRoom = 34;
  ok("launch succeeds all aboard", A.ship.launchGate(s) === true && s.gameOver.kind === "escape");

  const s2 = A.init.longGameInit(new A.RNG(11));
  for (let k = 1; k < 8; k++) if (s2.actors[k].status === 0) s2.actors[k].room = 34;
  s2.jonesRoom = 34;
  // one living crew NOT aboard -> countermanded (bug would let this launch)
  s2.actors[crew[crew.length - 1]].room = 0;
  ok("launch countermanded if one crew missing", A.ship.launchGate(s2) === false && !s2.gameOver);
})();

// 8. android arms at 6 alien wounds, then activates & attacks
(function () {
  const r = new A.RNG(3);
  const s = A.init.longGameInit(r);
  const id = s.alienTargetID;
  s.actors[0].strength = 6;                   // alien has 6 wounds
  A.android.triggerAlienEvent(s);
  ok("android armed at 6 wounds", s.alienActive === 255);
  // put a victim in the android's room
  s.actors[id].room = 12; s.actors[id].t = 0; s.actors[id].strength = 5;
  const victim = (id === 3) ? 5 : 3;
  s.actors[victim].room = 12; s.actors[victim].status = 0; s.actors[victim].strength = 5;
  A.android.updateAlien(s, new A.RNG(1));
  ok("android activated -> state 7", s.actors[id].state === 7 && s.actors[id].t === 40);
  ok("android attack msg #30", s.log.some(m => m.id === 30));
})();

// 9. competence rating = 2*strength(live human) + rooms<20 + 2*oxygen-leading
(function () {
  const r = new A.RNG(5);
  const s = A.init.longGameInit(r);
  // known state: all rooms 0 damage, oxygen 7500 -> leading 7
  const crew = A.state.livingHumanCrew(s);
  const expCrew = crew.reduce((t, k) => t + 2 * s.actors[k].strength, 0);
  const expRooms = 34;                        // all < 20 damage
  const expOxy = 14;                          // 2 * 7
  A.engine.endgame(s, "alienKilled");
  const exp = Math.min(expCrew + expRooms + expOxy, 100);
  ok("rating formula", s.gameOver.rating === exp, s.gameOver.rating + " vs " + exp);
  ok("rating clamped <=100", s.gameOver.rating <= 100);
})();

// 10. a full game runs many frames without throwing
(function () {
  const { state, rng } = A.engine.startLongGame(123);
  let threw = null;
  try { for (let i = 0; i < 20000 && !state.gameOver; i++) A.engine.step(state, rng); }
  catch (e) { threw = e; }
  ok("20k frames no crash", threw === null, threw && threw.stack);
})();

// 11. GameEntry's one-time UpdateAllCrew pass: same-room crew pairs mutually
//     add (partner courage - 2) to morale — the dinner trios open above template
(function () {
  const s = A.init.longGameInit(new A.RNG(31));
  const tpl = A.data.longGameCrewInit;
  let allMatch = true;
  for (let k = 1; k < 8; k++) {
    const a = s.actors[k];
    if (a.status !== 0) continue;                    // the host is out of play
    let exp = tpl[k * 8 + 6];
    for (let j = 1; j < 8; j++) {
      if (j === k || s.actors[j].status !== 0) continue;
      if (s.actors[j].room === a.room) exp += s.actors[j].courage - 2;
    }
    if (a.morale !== exp) { allMatch = false; console.log("   slot", k, a.morale, "vs", exp); }
  }
  ok("opening UpdateAllCrew morale", allMatch);
  ok("trio morale above template", s.actors[7].morale > tpl[7 * 8 + 6], s.actors[7].morale);
})();

// 12. movement kernel: PickNextRoom via both graphs + SetActionTimer formula
(function () {
  const s = A.init.longGameInit(new A.RNG(1));
  s.actors[3].room = 8; s.actors[3].status = 0;
  A.movement.pickNextRoom(s, 3, fixedRng([0]));      // dir 0 -> corridor slot 0
  ok("pickNextRoom floor dir0", s.actors[3].dest === A.data.roomAdjCorridors[8 * 5], s.actors[3].dest);
  s.actors[3].room = 8 | 64;
  A.movement.pickNextRoom(s, 3, fixedRng([15]));     // dir 4 -> duct slot 4, keeps bit 6
  ok("pickNextRoom duct dir4", s.actors[3].dest === (A.data.roomAdjDucts[8 * 5 + 4] | 64), s.actors[3].dest);
  s.actors[6].strength = 2;                          // Wounded: +48; Parker slot: +10
  A.movement.setActionTimer(s, 6, 64);
  ok("setActionTimer 64+10+48", s.actors[6].t === 122, s.actors[6].t);
})();

// 13. PreActionCheck: 3-cap, single-file ducts, panic paths, android disobey
(function () {
  const mk = () => A.init.longGameInit(new A.RNG(9));
  let s = mk();
  [1, 2, 3].forEach(k => { s.actors[k].room = 20; s.actors[k].status = 0; });
  s.actors[7].room = 21; s.actors[7].status = 0; s.actors[7].morale = 4;
  s.actors[7].state = 1; s.actors[7].dest = 20; s.actors[7].strength = 5;
  ok("3-cap blocks the move", A.engine.preActionCheck(s, 7, fixedRng([0])) === false && s.actors[7].t === 37, s.actors[7].t);

  s = mk();
  s.actors[1].room = 64 | 20; s.actors[1].status = 0;
  s.actors[7].room = 20; s.actors[7].status = 0; s.actors[7].morale = 4;
  s.actors[7].state = 1; s.actors[7].dest = 64 | 20; s.actors[7].strength = 5;
  ok("ducts are single-file", A.engine.preActionCheck(s, 7, fixedRng([0])) === false && s.actors[7].t === 37);

  s = mk();                                          // too shaken for the ducts: panic
  for (let i = 0; i < 22; i++) s.items[i] = 255;
  s.items[0] = 160 + 7;
  s.actors[7].room = 20; s.actors[7].status = 0; s.actors[7].morale = 1;
  s.actors[7].state = 1; s.actors[7].dest = 64 | 20;
  const fled = A.engine.preActionCheck(s, 7, fixedRng([0]));
  ok("duct fright -> drop + flee", fled === true && s.items[0] === 20 && (s.actors[7].dest & 64) === 0, s.actors[7].dest);

  s = mk();                                          // Broken in the ducts, mid-transit: proceeds
  s.actors[7].room = 64 | 20; s.actors[7].status = 0; s.actors[7].morale = 0;
  s.actors[7].state = 2; s.actors[7].dest = 20;
  ok("duct panic keeps a transit", A.engine.preActionCheck(s, 7, fixedRng([0])) === true);

  s = mk();                                          // Broken in the ducts, pending move: bail out
  s.actors[7].room = 64 | 20; s.actors[7].status = 0; s.actors[7].morale = 0;
  s.actors[7].state = 1; s.actors[7].dest = 64 | 16;
  const bailed = A.engine.preActionCheck(s, 7, fixedRng([0]));
  ok("duct panic opens the grille", bailed === false && s.roomGrille[20] === 0 && s.actors[7].state === 2 && s.actors[7].dest === 20);

  s = mk();                                          // the android quietly disobeys ATTACK
  const id = s.alienTargetID;
  s.actors[id].status = 0; s.actors[id].room = 20; s.actors[id].state = 4;
  ok("android disobeys attack", A.engine.preActionCheck(s, id, fixedRng([0])) === false && s.actors[id].state === 1 && s.actors[id].t === 20);
})();

// 14. collapse: witnessed = insta-found + witness morale + crew decay; unwitnessed = neither
(function () {
  let { s } = combatSetup(null, 3);
  s.actors[3].strength = 2;                          // one drain -> collapse
  s.actors[5].room = 8; s.actors[5].status = 0; s.actors[5].strength = 5; s.actors[5].morale = 4;
  const cBefore = s.actors[6].courage;               // an absent crew member's courage
  A.combat.crewAction5(s, fixedRng([0]));            // 2 victims: nibble&1 = 0 -> slot 3
  ok("witnessed collapse -> found", s.actors[3].status === 2, s.actors[3].status);
  ok("witness lost morale", s.actors[5].morale === 2, s.actors[5].morale); // -1 witness hit, then -1 crew-wide decay
  ok("witnessed kill decays crew", s.actors[6].courage === Math.max(cBefore - 1, 0));
  ok("msg #20 fired", s.log.some(m => m.id === 20));
  ok("victim strength stays drained", s.actors[3].strength === 1, s.actors[3].strength);

  ({ s } = combatSetup(null, 3));                    // victim alone with the alien
  s.actors[3].strength = 2;
  const c6 = s.actors[6].courage;
  A.combat.crewAction5(s, fixedRng([0]));
  ok("unwitnessed stays status 1", s.actors[3].status === 1);
  ok("no decay unwitnessed", s.actors[6].courage === c6);
  ok("no msg #20 unwitnessed", !s.log.some(m => m.id === 20));
})();

// 15. UpdateAlienAI: attack/grille/duct/wander decisions, timers, stay-put damage
(function () {
  const mk = () => { const s = A.init.longGameInit(new A.RNG(17)); s.actors[0].t = 0; return s; };
  let s = mk();
  s.actors[0].room = 20; s.actors[2].room = 20; s.actors[2].status = 0;
  A.alienai.updateAlienAI(s, fixedRng([0]));
  ok("AI: crew here -> attack 5/60", s.actors[0].state === 5 && s.actors[0].t === 60);
  s = mk(); s.actors[0].room = 20; s.roomGrille[20] = 255;
  A.alienai.updateAlienAI(s, fixedRng([0]));         // dir 0 (3/16) -> rip the grille
  ok("AI: rip grille 3/50", s.actors[0].state === 3 && s.actors[0].t === 50);
  s = mk(); s.actors[0].room = 20; s.roomGrille[20] = 0;
  A.alienai.updateAlienAI(s, fixedRng([3]));         // dir 1 (<2, 6/16) -> slip through
  ok("AI: duct slip 2/50", s.actors[0].state === 2 && s.actors[0].t === 50 && s.actors[0].dest === (20 | 64));
  s = mk(); s.actors[0].room = 0; s.roomGrille[0] = 255;
  A.alienai.updateAlienAI(s, fixedRng([6]));         // grille roll dir2; wander dir2 -> room 0 itself
  ok("AI: stay-put damages room", s.actors[0].state === 1 && s.actors[0].t === 80 && s.roomDamage[0] === 5, s.roomDamage[0]);
})();

// 16. Jones: timer expiry moves him (reset 255); the Net catch at threshold-4
(function () {
  const s = A.init.longGameInit(new A.RNG(23));
  s.jonesRoom = 8; s.jonesMoveTimer = 1;
  s.actors[0].room = 64 | 20;                        // alien in the ducts: never blocks
  A.jones.updateJones(s, fixedRng([0]));             // dir 0 from room 8
  ok("jones moves on expiry", s.jonesRoom === A.data.roomAdjCorridors[8 * 5], s.jonesRoom);
  ok("jones timer resets 255", s.jonesMoveTimer === 255);
  for (let i = 0; i < 22; i++) s.items[i] = 255;
  s.items[16] = 160 + 3;                             // the Net in Ripley's front hand
  s.actors[3].room = s.jonesRoom; s.actors[3].status = 0;
  const c = s.actors[3].courage, m = s.actors[3].morale;
  ok("getJones success at roll>=thr-4", A.jones.getJones(s, 3, fixedRng([13])) === true);
  ok("net -> cat-in-net in hand", s.items[16] === 255 && s.items[20] === 160 + 3);
  ok("jones off-map + comfort", s.jonesRoom === 255 && s.actors[3].courage === c + 1 && s.actors[3].morale === m + 1);
})();

// 17. trackers: floor scan + duct-lurker detection, the duct-holder quirk,
//     stale entries after a drop, and the vented "ghost" alien
(function () {
  const mk = () => {
    const s = A.init.longGameInit(new A.RNG(29));
    for (let i = 0; i < 22; i++) s.items[i] = 255;
    s.jonesRoom = 255;
    s.actors[0].room = 64 | 30;
    return s;
  };
  let s = mk();
  s.actors[7].room = 20; s.actors[7].status = 0; s.items[6] = 160 + 7;
  A.ship.findTrackerHolders(s);                      // room 20 adj = {16}; nobody there
  ok("tracker all clear", s.nearRoomList[0] === 20, s.nearRoomList[0]);
  s.actors[0].room = 64 | 16;                        // alien in the ducts NEXT DOOR
  A.ship.findTrackerHolders(s);
  ok("tracker hears duct motion", s.nearRoomList[0] === 255);
  s.actors[0].room = 64 | 30;
  s.actors[7].room = 64 | 20;                        // holder climbs into the ducts
  A.ship.findTrackerHolders(s);
  ok("duct-held tracker always beeps", s.nearRoomList[0] === 255);
  s.actors[7].room = 20;
  A.ship.findTrackerHolders(s);
  ok("all clear again on the floor", s.nearRoomList[0] === 20);
  s.items[6] = 20;                                   // tracker dropped on the floor
  s.actors[0].room = 64 | 16;                        // real motion next door now
  A.ship.findTrackerHolders(s);
  ok("dropped tracker entry is stale", s.nearRoomList[0] === 20);

  s = mk();                                          // the tracker-ghost alien
  s.actors[7].room = 20; s.actors[7].status = 0; s.items[6] = 160 + 7;
  s.actors[0].room = 0; s.actors[0].strength = 0;
  A.ship.blowLock(s, 0, fixedRng([0]));              // roll 0 < 2: it survives the void
  ok("vented alien returns at ShuttleBay", s.actors[0].room === 32 && s.actors[0].status === 1);
  s.actors[0].room = 16;                             // on the floor right next door
  A.ship.findTrackerHolders(s);
  ok("returned alien is a tracker-ghost", s.nearRoomList[0] === 20, s.nearRoomList[0]);
})();

// 18. self-destruct: 5:00 arm, 20-frame seconds, abort, BOOM text + oxygen-only score
(function () {
  const s = A.init.longGameInit(new A.RNG(37));
  A.ship.destructToggle(s);
  ok("destruct armed 5:00", s.destructArmed && s.destructSeconds === 300 && (s.shipFlags & 1) !== 0);
  for (let i = 0; i < 20; i++) A.ship.destructTicker(s);
  ok("one game-second per 20 frames", s.destructSeconds === 299, s.destructSeconds);
  A.ship.destructToggle(s);
  ok("destruct aborted", !s.destructArmed && (s.shipFlags & 1) === 0 && s.log.some(m => m.id === 14));
  A.ship.destructToggle(s);
  s.destructSeconds = 0; s.destructSub = 1;
  A.ship.destructTicker(s);
  ok("BOOM -> ship lost", s.gameOver && s.gameOver.kind === "shipDestroyed");
  ok("BOOM reuses the alien-killed line", s.gameOver.text[0] === "The Alien has been killed");
  ok("BOOM scores oxygen only", s.gameOver.rating === 14, s.gameOver.rating);
})();

// 19. airlocks: vent kills + wipes + flags; arrivals bounce to Corridor#6; seal
(function () {
  const s = A.init.longGameInit(new A.RNG(41));
  for (let i = 0; i < 22; i++) s.items[i] = 255;
  s.items[4] = 0;                                    // an item lying in Airlock #1
  s.actors[3].room = 0; s.actors[3].status = 0;
  s.actors[0].room = 64 | 30;
  A.ship.blowLock(s, 0, fixedRng([15]));
  ok("vent kills the occupant", s.actors[3].status === 1 && s.actors[3].room === 255);
  ok("vent wipes the floor item", s.items[4] === 255);
  ok("lock flag + msg #16", (s.shipFlags & 2) !== 0 && s.log.some(m => m.id === 16));
  s.actors[5].room = 13; s.actors[5].status = 0; s.actors[5].state = 1; s.actors[5].dest = 0;
  A.engine.dispatchCrewAction(s, 5, fixedRng([0]));
  ok("arrival bounces to Corridor#6", s.actors[5].room === 13, s.actors[5].room);
  A.ship.sealLock(s, 0);
  ok("seal clears + msg #17", (s.shipFlags & 2) === 0 && s.log.some(m => m.id === 17));
})();

// 20. hypersleep: 255-frame timer, then removal + items stack in the Cryo Vault
(function () {
  const s = A.init.longGameInit(new A.RNG(43));
  for (let i = 0; i < 22; i++) s.items[i] = 255;
  s.items[2] = 160 + 6; s.items[9] = 128 + 6;
  s.actors[6].room = 15; s.actors[6].status = 0;
  A.ship.hypersleepStart(s, 6);
  ok("hypersleep queued 6/255", s.actors[6].state === 6 && s.actors[6].t === 255 && s.log.some(m => m.id === 11));
  A.ship.hypersleepComplete(s, 6);
  ok("sleeper removed", s.actors[6].status === 255 && s.actors[6].room === 255);
  ok("items stack in Cryo Vault", s.items[2] === 15 && s.items[9] === 15);
  ok("msg #12", s.log.some(m => m.id === 12));
})();

// 21. endgame roster: found bodies listed, android/sleepers excluded; oxygenOut
(function () {
  const s = A.init.longGameInit(new A.RNG(47));
  const id = s.alienTargetID, names = A.data.crewNames;
  const pool = [1, 2, 3, 4, 5, 6, 7].filter(k => k !== id && s.actors[k].status === 0);
  s.actors[pool[0]].status = 1;                      // dead, undiscovered
  s.actors[pool[1]].status = 2;                      // dead, found
  s.actors[pool[2]].status = 255;                    // in hypersleep
  s.actors[id].status = 2;                           // defeated android
  A.engine.endgame(s, "alienKilled");
  const t = s.gameOver.text;
  ok("roster lists the dead", t.includes(names[pool[0]] + " is dead"));
  ok("roster lists found bodies", t.includes(names[pool[1]] + " is dead"));
  ok("roster skips the sleeper", !t.includes(names[pool[2]] + " is dead"));
  ok("roster skips the android", !t.includes(names[id] + " is dead"));
  ok("android reveal line", t.includes(names[id] + " was the Android"));

  const s2 = A.init.longGameInit(new A.RNG(47));
  A.engine.endgame(s2, "oxygenOut");
  ok("oxygenOut stamps all crew", [1, 2, 3, 4, 5, 6, 7].every(k => s2.actors[k].status === 2));
  ok("oxygenOut unleashed line", s2.gameOver.text.includes("The Alien will be unleashed upon the Earth"));
})();

// 22. authentic texts: msg #16 stays jammed, item names are the tape's strings
(function () {
  ok("msg #16 verbatim", A.messages.table[16] === "WARNING:%RDEPRESSURISED");
  ok("item names are the tape's", A.data.itemName(0) === "Elctrc Prd" && A.data.itemName(12) === "Harpn Gun" && A.data.itemName(20) === "Cat in Net");
})();

console.log(`\nparity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
