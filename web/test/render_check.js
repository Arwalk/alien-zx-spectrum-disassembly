// Exercise the render paths (drawMap / drawEncounter / drawDuctView) headless
// with a stubbed 2D context, to catch throwing bugs without a real browser.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function mockCtx() {
  return {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * (h || 1) * 4), width: w, height: h }),
    putImageData() {}, drawImage() {}, fillRect() {}, clearRect() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, closePath() {},
    fill() {}, stroke() {}, save() {}, restore() {}, setLineDash() {}, fillText() {},
    measureText: () => ({ width: 0 }), scale() {}, translate() {},
    globalAlpha: 1, imageSmoothingEnabled: false, lineWidth: 1, font: "", textAlign: "", textBaseline: "",
    fillStyle: "", strokeStyle: "",
  };
}
function stubCanvas() { return { width: 1, height: 1, getContext: mockCtx }; }

const WEB = path.join(__dirname, "..");
const sandbox = {};
sandbox.window = sandbox; sandbox.console = console; sandbox.Math = Math; sandbox.Date = Date;
sandbox.Array = Array; sandbox.JSON = JSON; sandbox.Uint8ClampedArray = Uint8ClampedArray;
sandbox.document = { createElement: (t) => (t === "canvas" ? stubCanvas() : {}) };
vm.createContext(sandbox);
["assets/graphics.js", "src/data.js", "src/palette.js", "src/rng.js", "src/messages.js",
 "src/state.js", "src/init.js", "src/movement.js", "src/morale.js", "src/jones.js",
 "src/alienai.js", "src/android.js", "src/combat.js", "src/ship.js", "src/commands.js",
 "src/engine.js", "src/assets.js", "src/footprints.js", "src/render.js"
].forEach((f) => vm.runInContext(fs.readFileSync(path.join(WEB, f), "utf8"), sandbox, { filename: f }));

const A = sandbox.window.ALIEN;
A.assets.build();
const { state, rng } = A.engine.startLongGame(7);
for (let i = 0; i < 300; i++) A.engine.step(state, rng);
const ctx = mockCtx();
let err = null;
try {
  for (let d = 0; d < 3; d++) { state.deck = d; A.render.drawMap(ctx, state, 3, { 8: true }, 8); }
  A.render.drawEncounter(ctx, 360, 300, 1, 40);
  // force the selected crew into a duct and render the duct view
  state.actors[3].room = 8 | 64; state.actors[3].status = 0;
  A.render.drawDuctView(ctx, state, 3);
  A.render.roomAtPoint(state, 100, 100);
} catch (e) { err = e; }
console.log(err ? "RENDER ERROR: " + err.stack : "render_check: OK (map + encounter + duct all drew)");
process.exit(err ? 1 : 0);
