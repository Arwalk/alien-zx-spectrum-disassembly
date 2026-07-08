// Decode the extracted ZX bitmaps (window.ALIEN_ASSETS) into ready-to-blit
// canvases. Browser-only (needs <canvas>). 1 bpp, MSB = leftmost pixel.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var G = root.ALIEN_ASSETS;

  var GREEN = [0, 255, 0], WHITE = [230, 230, 230], BLUE = [40, 90, 235],
      CYAN = [0, 220, 220], AMBER = [255, 180, 40], RED = [255, 60, 60];

  function newCanvas(w, h) {
    var c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }

  // Render a row-major 1bpp bitmap (bytesPerRow x rows) into a canvas.
  function linear(bitmap, bytesPerRow, rows, ink, paper) {
    var w = bytesPerRow * 8, c = newCanvas(w, rows), ctx = c.getContext("2d");
    var img = ctx.createImageData(w, rows), d = img.data;
    for (var y = 0; y < rows; y++) {
      for (var bx = 0; bx < bytesPerRow; bx++) {
        var byte = bitmap[y * bytesPerRow + bx] || 0;
        for (var k = 0; k < 8; k++) {
          var on = (byte & (0x80 >> k)) !== 0;
          var o = (y * w + bx * 8 + k) * 4;
          if (on) { d[o] = ink[0]; d[o + 1] = ink[1]; d[o + 2] = ink[2]; d[o + 3] = 255; }
          else if (paper) { d[o] = paper[0]; d[o + 1] = paper[1]; d[o + 2] = paper[2]; d[o + 3] = 255; }
          else d[o + 3] = 0; // transparent paper
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Portraits: 24x24 = 3x3 cells in reading order, 8 bytes/cell.
  function portrait(bytes, ink, paper) {
    var c = newCanvas(24, 24), ctx = c.getContext("2d");
    var img = ctx.createImageData(24, 24), d = img.data;
    for (var cell = 0; cell < 9; cell++) {
      var cx = (cell % 3) * 8, cy = ((cell / 3) | 0) * 8;
      for (var py = 0; py < 8; py++) {
        var byte = bytes[cell * 8 + py] || 0;
        for (var k = 0; k < 8; k++) {
          var on = (byte & (0x80 >> k)) !== 0;
          var o = ((cy + py) * 24 + cx + k) * 4;
          if (on) { d[o] = ink[0]; d[o + 1] = ink[1]; d[o + 2] = ink[2]; d[o + 3] = 255; }
          else { d[o] = paper[0]; d[o + 1] = paper[1]; d[o + 2] = paper[2]; d[o + 3] = 255; }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Compose a 20x19 tile grid (deck map / room template) green-on-black.
  function tileGrid(grid, ink) {
    var cols = 20, rows = 19, c = newCanvas(cols * 8, rows * 8), ctx = c.getContext("2d");
    for (var cy = 0; cy < rows; cy++) {
      for (var cx = 0; cx < cols; cx++) {
        var t = grid[cy * cols + cx];
        if (t === undefined || t === 0) continue;
        var bm = G.tiles[t];
        if (!bm) continue;
        var tc = linear(bm, 1, 8, ink, null);
        ctx.drawImage(tc, cx * 8, cy * 8);
      }
    }
    return c;
  }

  var built = false, decks = [], portraits = [], alienFrames = [], jonesFrames = [],
      roomTemplates = [], loading = null;

  function build() {
    if (built) return;
    for (var d = 0; d < 3; d++) decks.push(tileGrid(G.decks[d], GREEN));
    for (var p = 0; p < 7; p++) portraits.push(portrait(G.portraits[p], BLUE, WHITE));
    for (var f = 0; f < G.alienFrames.length; f++) alienFrames.push(linear(G.alienFrames[f], 6, 63, GREEN, null));
    for (var j = 0; j < G.jonesFrames.length; j++) jonesFrames.push(linear(G.jonesFrames[j], 3, 21, WHITE, null));
    for (var t = 0; t < 3; t++) roomTemplates.push(tileGrid(G.roomLayouts[t], CYAN));
    loading = buildLoadingScreen();
    built = true;
  }

  // Decode the ZX SCREEN$ loading picture (non-linear display + attrs).
  function buildLoadingScreen() {
    var px = G.loadingScreen, c = newCanvas(256, 192), ctx = c.getContext("2d");
    var img = ctx.createImageData(256, 192), d = img.data;
    var pal = G.palette;
    for (var y = 0; y < 192; y++) {
      var third = (y >> 6) & 3, row = (y >> 3) & 7, pr = y & 7;
      var addr = (third << 11) | (pr << 8) | (row << 5);
      for (var col = 0; col < 32; col++) {
        var byte = px[addr + col];
        var attr = px[6144 + ((y >> 3) * 32) + col];
        var bright = (attr >> 6) & 1;
        var ink = (bright ? pal.bright : pal.normal)[attr & 7];
        var paper = (bright ? pal.bright : pal.normal)[(attr >> 3) & 7];
        for (var k = 0; k < 8; k++) {
          var on = (byte & (0x80 >> k)) !== 0;
          var o = (y * 256 + col * 8 + k) * 4, cc = on ? ink : paper;
          d[o] = cc[0]; d[o + 1] = cc[1]; d[o + 2] = cc[2]; d[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Draw a single tile at (x,y) scaled, with a chosen ink (for map overlays).
  function drawTile(ctx, tileIndex, x, y, scale, ink) {
    var bm = G.tiles[tileIndex];
    if (!bm) return;
    var t = linear(bm, 1, 8, ink || GREEN, null);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t, x, y, 8 * scale, 8 * scale);
  }

  A.assets = {
    build: build,
    colors: { GREEN: GREEN, WHITE: WHITE, BLUE: BLUE, CYAN: CYAN, AMBER: AMBER, RED: RED },
    deck: function (i) { return decks[i]; },
    portrait: function (i) { return portraits[i]; },
    alienFrame: function (i) { return alienFrames[i % alienFrames.length]; },
    jonesFrame: function (i) { return jonesFrames[i % jonesFrames.length]; },
    roomTemplate: function (i) { return roomTemplates[i]; },
    loadingScreen: function () { return loading; },
    roomMarkers: function () { return G.roomMarkers; },
    drawTile: drawTile,
    linear: linear,
    raw: function () { return G; }
  };
})(typeof window !== "undefined" ? window : this);
