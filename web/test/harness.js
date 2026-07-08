// Node test harness: load the browser logic files into a shared sandbox so the
// exact same source runs headless. Render/UI/assets files are DOM-bound and are
// NOT loaded here.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
// Load order mirrors index.html (logic only).
const FILES = [
  "data.js", "palette.js", "rng.js", "messages.js", "state.js", "init.js",
  "movement.js", "morale.js", "jones.js", "alienai.js", "android.js",
  "combat.js", "ship.js", "commands.js", "engine.js"
];

function loadEngine() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.Date = Date;
  sandbox.Math = Math;
  sandbox.Array = Array;
  sandbox.JSON = JSON;
  vm.createContext(sandbox);
  for (const f of FILES) {
    const p = path.join(SRC, f);
    if (!fs.existsSync(p)) continue; // tolerate files not written yet
    vm.runInContext(fs.readFileSync(p, "utf8"), sandbox, { filename: f });
  }
  return sandbox.window.ALIEN;
}

module.exports = { loadEngine };
