// ZX Spectrum colour helpers. Attribute byte = FLASH(7) BRIGHT(6) PAPER(5-3) INK(2-0).
// Palette values come from graphics.js (ALIEN_ASSETS.palette), falling back to a
// built-in copy so this file also works headless.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});

  var NORMAL = [
    [0,0,0],[0,0,205],[205,0,0],[205,0,205],[0,205,0],[0,205,205],[205,205,0],[205,205,205]
  ];
  var BRIGHT = [
    [0,0,0],[0,0,255],[255,0,0],[255,0,255],[0,255,0],[0,255,255],[255,255,0],[255,255,255]
  ];

  function rgb(index, bright) {
    var t = bright ? BRIGHT : NORMAL;
    return t[index & 7];
  }
  function css(index, bright) {
    var c = rgb(index, bright);
    return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
  }
  // Decode a raw attribute byte -> { ink, paper, bright, flash, inkCss, paperCss }.
  function attr(byte) {
    var ink = byte & 7, paper = (byte >> 3) & 7, bright = (byte >> 6) & 1, flash = (byte >> 7) & 1;
    return { ink: ink, paper: paper, bright: !!bright, flash: !!flash,
             inkCss: css(ink, bright), paperCss: css(paper, bright) };
  }

  A.palette = { NORMAL: NORMAL, BRIGHT: BRIGHT, rgb: rgb, css: css, attr: attr };
  if (typeof module !== "undefined" && module.exports) module.exports = A.palette;
})(typeof window !== "undefined" ? window : this);
