// Render the real deck-map pipeline (assets.js + render.js) to PNGs via
// node-canvas, so the assembled game view can be eyeballed headless.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createCanvas } = require("canvas");

const WEB = path.join(__dirname, "..");
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console; sandbox.Math = Math; sandbox.Date = Date;
sandbox.Array = Array; sandbox.JSON = JSON; sandbox.Uint8ClampedArray = Uint8ClampedArray;
sandbox.document = { createElement: (t) => (t === "canvas" ? createCanvas(1, 1) : {}) };
vm.createContext(sandbox);

const files = [
  "assets/graphics.js", "src/data.js", "src/palette.js", "src/rng.js", "src/messages.js",
  "src/state.js", "src/init.js", "src/movement.js", "src/morale.js", "src/jones.js",
  "src/alienai.js", "src/android.js", "src/combat.js", "src/ship.js", "src/commands.js",
  "src/engine.js", "src/assets.js", "src/footprints.js", "src/render.js",
];
for (const f of files) vm.runInContext(fs.readFileSync(path.join(WEB, f), "utf8"), sandbox, { filename: f });
const A = sandbox.window.ALIEN;
A.assets.build();

// build a lively state for the shot
const { state, rng } = A.engine.startLongGame(20260708);
for (let i = 0; i < 400; i++) A.engine.step(state, rng);
// pick a living crew member and show their deck + reachable rooms
const live = A.state.livingHumanCrew(state);
const sel = live[0] || 1;
state.viewedSlot = sel;
const room = state.actors[sel].room & 63;
if (A.data.roomTypeTable[room] < 3) state.deck = A.data.roomTypeTable[room];
const reach = {};
A.commands.moveOptions(state, sel).forEach((o) => { if (!o.grille) reach[o.room] = true; });
// add some visible damage + a fire for the shot
A.ship.addRoomDamage(state, 17, 6); // Engine #1 -> 30 dmg -> fire
A.ship.addRoomDamage(state, 6, 4);

const out = path.join(WEB, "assets", "_debug");
fs.mkdirSync(out, true && { recursive: true });

function shot(name, deck) {
  state.deck = deck;
  const c = createCanvas(A.render.MAPW, A.render.MAPH);
  A.render.drawMap(c.getContext("2d"), state, sel, reach, -1);
  fs.writeFileSync(path.join(out, name), c.toBuffer("image/png"));
  console.log("wrote", name);
}
shot("map_upper.png", 0);
shot("map_middle.png", 1);

// a portrait strip + one alien frame, for the "hero" look
const strip = createCanvas(7 * 28, 28), sctx = strip.getContext("2d");
sctx.fillStyle = "#0d1319"; sctx.fillRect(0, 0, strip.width, strip.height);
for (let p = 0; p < 7; p++) sctx.drawImage(A.assets.portrait(p), 2 + p * 28, 2, 24, 24);
fs.writeFileSync(path.join(out, "portrait_strip.png"), strip.toBuffer("image/png"));
console.log("wrote portrait_strip.png; selected crew:", A.data.crewNames[sel], "deck", A.data.roomTypeTable[room]);
