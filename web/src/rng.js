// Randomness. The original walked ZX ROM bytes as a pseudo-random "script"
// stream and used the low nibble (0-15) of each byte as a command. We replace
// that with a real PRNG but preserve the OBSERVABLE probabilities the game
// relies on: uniform nibbles 0-15, and the weighted 5-way direction fold.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});

  function RNG(seed) {
    // mulberry32
    this.s = (seed >>> 0) || ((Date.now() ^ 0x9e3779b9) >>> 0);
  }
  RNG.prototype._u32 = function () {
    var t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  // AdvanceScriptPtr: next command nibble 0-15 (uniform).
  RNG.prototype.nibble = function () {
    return this._u32() & 15;
  };
  // ScriptNibbleToDirection: 0-2->0, 3-5->1, 6-8->2, 9-11->3, 12-15->4.
  // Direction 4 is slightly more likely (4/16); the rest are 3/16 each.
  RNG.prototype.direction = function () {
    var n = this.nibble();
    if (n < 3) return 0;
    if (n < 6) return 1;
    if (n < 9) return 2;
    if (n < 12) return 3;
    return 4;
  };
  RNG.prototype.reseed = function (seed) {
    this.s = (seed >>> 0) || ((Date.now() ^ (this.s + 0x9e3779b9)) >>> 0);
  };

  A.RNG = RNG;
  if (typeof module !== "undefined" && module.exports) module.exports = RNG;
})(typeof window !== "undefined" ? window : this);
