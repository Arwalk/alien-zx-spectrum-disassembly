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

console.log(`\nparity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
