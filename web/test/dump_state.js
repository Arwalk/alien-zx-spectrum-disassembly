// Dump a live game state (positions/damage/selection) to JSON so a Python
// compositor can render the assembled map exactly as render.drawMap does.
const { loadEngine } = require("./harness.js");
const A = loadEngine();

const { state, rng } = A.engine.startLongGame(20260708);
for (let i = 0; i < 500; i++) A.engine.step(state, rng);
const live = A.state.livingHumanCrew(state);
const sel = live[0] || 1;
state.viewedSlot = sel;
const room = state.actors[sel].room & 63;
const deck = A.data.roomTypeTable[room] < 3 ? A.data.roomTypeTable[room] : 1;
const reach = [];
A.commands.moveOptions(state, sel).forEach((o) => { if (!o.grille) reach.push(o.room); });
A.ship.addRoomDamage(state, 17, 6); // light a fire in Engine #1
A.ship.addRoomDamage(state, 6, 5);

const crew = [];
for (let k = 1; k < 8; k++) {
  const a = state.actors[k];
  if (a.status !== 0) continue;
  crew.push({ k, room: a.room & 63, duct: !!(a.room & 64), initial: A.data.crewNames[k][0], sel: k === sel });
}
const dmg = {};
for (let r = 0; r < 34; r++) if (state.roomDamage[r] > 0) dmg[r] = state.roomDamage[r];
const fire = [];
for (let e = 17; e <= 19; e++) if (state.shipFlags & (8 << (e - 17))) fire.push(e);

console.log(JSON.stringify({
  deck, sel, crew, reach, dmg, fire,
  jones: state.jonesRoom,
  roomTypes: A.data.roomTypeTable,
  selName: A.data.crewNames[sel],
}));
