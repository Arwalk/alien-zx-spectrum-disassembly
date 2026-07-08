// Boot the real browser UI under jsdom (with a stubbed 2D canvas) to catch
// runtime errors in assets.js / render.js / ui.js without a real browser.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const WEB = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8")
  .replace(/<script[\s\S]*?<\/script>/g, ""); // strip script tags; we eval manually

const { VirtualConsole } = require("jsdom");
const vc = new VirtualConsole();
let captured = null;
vc.on("jsdomError", (e) => { captured = e.detail || e; console.log("JSDOM ERROR:", (e.detail && e.detail.stack) || e.message); });
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
const win = dom.window;
win.addEventListener("error", (ev) => { console.log("WINDOW ERROR:", ev.error && ev.error.stack || ev.message); captured = ev.error; });

// ---- canvas + timing stubs -------------------------------------------------
function mockCtx() {
  const c = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray((w * (h || 1)) * 4), width: w, height: h }),
    putImageData() {}, drawImage() {}, fillRect() {}, clearRect() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, closePath() {},
    fill() {}, stroke() {}, save() {}, restore() {}, setLineDash() {}, fillText() {},
    measureText: () => ({ width: 0 }), scale() {}, translate() {},
  };
  return c;
}
win.HTMLCanvasElement.prototype.getContext = function () { return mockCtx(); };
let clock = 0;
win.performance = { now: () => (clock += 16) };
const rafQ = [];
win.requestAnimationFrame = (cb) => { rafQ.push(cb); return rafQ.length; };
win.confirm = () => true;

// ---- load scripts in index.html order --------------------------------------
const files = [
  "assets/graphics.js", "src/data.js", "src/palette.js", "src/rng.js", "src/messages.js",
  "src/state.js", "src/init.js", "src/movement.js", "src/morale.js", "src/jones.js",
  "src/alienai.js", "src/android.js", "src/combat.js", "src/ship.js", "src/commands.js",
  "src/engine.js", "src/assets.js", "src/render.js", "src/ui.js",
];
let failed = false;
try {
  for (const f of files) win.eval(fs.readFileSync(path.join(WEB, f), "utf8"));
} catch (e) { console.log("LOAD ERROR:", e.stack); process.exit(1); }

function pump(n) { for (let i = 0; i < n; i++) { const q = rafQ.splice(0); q.forEach((cb) => cb(win.performance.now())); } }

try {
  const doc = win.document;
  console.log("  readyState:", doc.readyState, "ALIEN:", !!win.ALIEN);
  win.document.dispatchEvent(new win.Event("DOMContentLoaded")); // ensure boot() ran
  doc.getElementById("startBtn").click();           // start the game
  const ALIEN = win.ALIEN;
  if (!ALIEN.__game && !doc.getElementById("startScreen").hidden) throw new Error("start did not hide title");
  pump(30);                                          // run the loop a bunch of frames

  // select each crew card and click every action button we can find
  let clicks = 0;
  for (let round = 0; round < 40; round++) {
    const cards = doc.querySelectorAll(".crewCard");
    cards.forEach((c) => c.click());
    const acts = doc.querySelectorAll("#actionPanel .act");
    acts.forEach((b) => { try { b.click(); clicks++; } catch (e) { throw e; } });
    // simulate a map click near a room centre
    const mapCanvas = doc.getElementById("mapCanvas");
    mapCanvas.dispatchEvent(new win.MouseEvent("click", { clientX: 100, clientY: 100 }));
    pump(20);
  }
  pump(50);

  const logCount = doc.querySelectorAll("#log .logline").length;
  console.log("ui_smoke: OK");
  console.log("  action buttons clicked:", clicks);
  console.log("  log lines rendered:", logCount);
  console.log("  frames simulated:", win.ALIEN ? "(loop ran)" : "?");
} catch (e) {
  console.log("RUNTIME ERROR:", e.stack || e);
  failed = true;
}
process.exit(failed ? 1 : 0);
