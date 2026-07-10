// Per-room map footprints, derived at startup from the deck map's tile grid
// (ALIEN_ASSETS.decks — the green hull/wall layer the map actually shows) so
// each highlight can hug the compartment drawn for its room instead of a
// fixed 3x2 box.
//
// Two passes per deck:
//   1. A fine partition: flood fill from each room's marker with BOTH the
//      green layer and the duct-crawlway overlay (ALIEN_ASSETS.roomLayouts,
//      invisible on the map but it happens to thread between rooms) as
//      barriers. This splits the interconnected corridor web into one pocket
//      per room.
//   2. The visible compartments: connected components of green-empty cells.
//      A component whose pass-1 pockets all belong to ONE room becomes that
//      room's full footprint — this restores the parts of tall rooms that
//      the invisible crawlway lines cut off in pass 1.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var COLS = 20, ROWS = 19, SIZE = COLS * ROWS;
  var MAX_CELLS = 20; // bigger than any room = the fill leaked outside

  // Green-layer wall test: line/junction/solid glyphs. Deck-caption letters
  // (0x41-0x5a) and in-room fixture icons (0x60 door, 0x7b grille, 0x7c
  // console) are drawn INSIDE compartments and must not seal or split one.
  function isWall(green) {
    if (green >= 1 && green <= 0x40) return true;
    if (green >= 0x5b && green <= 0x5f) return true;
    return green === 0x86 || green === 0x89;
  }
  function isBarrier(green, cyan) { return cyan !== 0 || isWall(green); }

  // Cells to try growing a room from, relative to its marker anchor (the
  // original game's 3x2 marker-sprite corner, which often sits on a wall).
  var SEEDS = [[0, 0], [1, 1], [1, 0], [0, 1], [2, 1], [0, 2], [2, 0], [1, 2]];

  // Rooms whose marker-relative seeds all land on walls: fill from this
  // exact cell instead. [col,row].
  var SEED_FIX = {
    24: [12, 15] // Lab Stores — marker sits on its compartment's west wall
  };

  // Hand-authored cell lists for rooms the fill can't recover at all.
  var PATCH = {
    // Corridor#7 is carved into deck 2's solid stern block; its three open
    // cells are fenced off by crawlway glyphs on every side.
    14: [[13, 9], [14, 9], [15, 9]]
  };

  function flood(green, cyan, c0, r0) {
    var seen = {}, cells = [], stack = [[c0, r0]];
    seen[r0 * COLS + c0] = true;
    while (stack.length) {
      var cur = stack.pop(), c = cur[0], r = cur[1];
      cells.push(cur);
      if (cells.length > MAX_CELLS) return null;
      var next = [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]];
      for (var i = 0; i < 4; i++) {
        var nc = next[i][0], nr = next[i][1];
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
        var k = nr * COLS + nc;
        if (seen[k] || isBarrier(green[k], cyan[k])) continue;
        seen[k] = true; stack.push([nc, nr]);
      }
    }
    return cells;
  }

  // Trace the rectilinear outline(s) of a cell set. Boundary edges are
  // directed so the interior sits on the RIGHT; following them with a
  // prefer-rightmost-turn rule walks each loop tightly (splitting cleanly at
  // corner-touching pinches). Returns loops of vertices {x,y,nx,ny}: tile-
  // edge coordinates plus the outward offset direction for margin expansion.
  function trace(cells) {
    var inSet = {};
    cells.forEach(function (p) { inSet[p[1] * COLS + p[0]] = true; });
    function member(c, r) { return c >= 0 && r >= 0 && inSet[r * COLS + c]; }
    // collect directed boundary edges keyed by start vertex
    var edges = {}; // "x,y" -> [{x2,y2,dx,dy,used}]
    function addEdge(x1, y1, x2, y2) {
      (edges[x1 + "," + y1] = edges[x1 + "," + y1] || []).push(
        { x: x2, y: y2, dx: x2 - x1, dy: y2 - y1, used: false });
    }
    cells.forEach(function (p) {
      var c = p[0], r = p[1];
      if (!member(c, r - 1)) addEdge(c, r, c + 1, r);         // top
      if (!member(c + 1, r)) addEdge(c + 1, r, c + 1, r + 1); // right
      if (!member(c, r + 1)) addEdge(c + 1, r + 1, c, r + 1); // bottom
      if (!member(c - 1, r)) addEdge(c, r + 1, c, r);         // left
    });
    // walk loops
    var loops = [];
    for (var key in edges) {
      for (var e0 = 0; e0 < edges[key].length; e0++) {
        if (edges[key][e0].used) continue;
        var loop = [], sx = +key.split(",")[0], sy = +key.split(",")[1];
        var x = sx, y = sy, dx = 0, dy = 0, edge = edges[key][e0];
        do {
          edge.used = true;
          loop.push({ x: x, y: y, inDx: dx, inDy: dy, outDx: edge.dx, outDy: edge.dy });
          dx = edge.dx; dy = edge.dy; x = edge.x; y = edge.y;
          var out = edges[x + "," + y] || [], best = null, bestTurn = -2;
          for (var i = 0; i < out.length; i++) {
            if (out[i].used) continue;
            // rightmost turn first: cross(d, out) > 0 is a right turn in
            // screen coords (y down); straight = 0; left = -1
            var turn = dx * out[i].dy - dy * out[i].dx;
            if (turn > bestTurn) { bestTurn = turn; best = out[i]; }
          }
          edge = best;
        } while (edge && !(x === sx && y === sy));
        if (loop.length >= 4) {
          loop[0].inDx = dx; loop[0].inDy = dy; // close the loop
          // drop collinear vertices, attach outward normals
          var pts = [];
          loop.forEach(function (v) {
            if (v.inDx === v.outDx && v.inDy === v.outDy) return;
            // outward = left of travel = (dy,-dx), summed over both edges
            pts.push({ x: v.x, y: v.y,
                       nx: v.inDy + v.outDy, ny: -v.inDx - v.outDx });
          });
          loops.push(pts);
        }
      }
    }
    return loops;
  }

  function finish(cells) {
    var c0 = 99, r0 = 99, c1 = -1, r1 = -1, sx = 0, sy = 0;
    cells.forEach(function (p) {
      if (p[0] < c0) c0 = p[0]; if (p[0] > c1) c1 = p[0];
      if (p[1] < r0) r0 = p[1]; if (p[1] > r1) r1 = p[1];
      sx += p[0] + 0.5; sy += p[1] + 0.5;
    });
    // centre = centroid snapped to the nearest member cell (an L-shaped
    // room's raw centroid can land outside the room)
    var gx = sx / cells.length, gy = sy / cells.length, best = cells[0], bd = 1e9;
    cells.forEach(function (p) {
      var d = (p[0] + 0.5 - gx) * (p[0] + 0.5 - gx) + (p[1] + 0.5 - gy) * (p[1] + 0.5 - gy);
      if (d < bd) { bd = d; best = p; }
    });
    return {
      cells: cells, bbox: { c0: c0, r0: r0, c1: c1 + 1, r1: r1 + 1 },
      cx: best[0] + 0.5, cy: best[1] + 0.5, outline: trace(cells)
    };
  }

  // -> array indexed by room id: footprint or null (caller falls back).
  function build(G) {
    // pass 1: one pocket per room
    var pocket = []; // room -> cells
    for (var i = 0; i < G.roomMarkers.length; i++) {
      var m = G.roomMarkers[i];
      var cells = PATCH[m.room] || null;
      var green = G.decks[m.deck], cyan = G.roomLayouts[m.deck];
      if (!cells && SEED_FIX[m.room]) {
        var f = SEED_FIX[m.room];
        cells = flood(green, cyan, f[0], f[1]);
      }
      for (var s = 0; s < SEEDS.length && !cells; s++) {
        var c = m.col + SEEDS[s][0], r = m.row + SEEDS[s][1];
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
        if (isBarrier(green[r * COLS + c], cyan[r * COLS + c])) continue;
        cells = flood(green, cyan, c, r);
      }
      pocket[m.room] = cells;
    }
    // pass 2: per deck, absorb each single-claimant green component
    for (var d = 0; d < 3; d++) {
      var grid = G.decks[d];
      var comp = new Array(SIZE).fill(-1), sizes = [], n = 0;
      for (var k0 = 0; k0 < SIZE; k0++) {
        if (comp[k0] >= 0 || isWall(grid[k0])) continue;
        var stack = [k0], count = 0;
        comp[k0] = n;
        while (stack.length) {
          var k = stack.pop(), c2 = k % COLS, r2 = (k / COLS) | 0;
          count++;
          [[c2 - 1, r2], [c2 + 1, r2], [c2, r2 - 1], [c2, r2 + 1]].forEach(function (p) {
            if (p[0] < 0 || p[0] >= COLS || p[1] < 0 || p[1] >= ROWS) return;
            var kk = p[1] * COLS + p[0];
            if (comp[kk] < 0 && !isWall(grid[kk])) { comp[kk] = n; stack.push(kk); }
          });
        }
        sizes[n++] = count;
      }
      var claim = {}; // compId -> room, or -2 when contested
      G.roomMarkers.forEach(function (m2) {
        if (m2.deck !== d || !pocket[m2.room]) return;
        pocket[m2.room].forEach(function (p) {
          var id = comp[p[1] * COLS + p[0]];
          if (id < 0) return;
          if (claim[id] === undefined) claim[id] = m2.room;
          else if (claim[id] !== m2.room) claim[id] = -2;
        });
      });
      G.roomMarkers.forEach(function (m2) {
        if (m2.deck !== d || !pocket[m2.room]) return;
        var have = {};
        pocket[m2.room].forEach(function (p) { have[p[1] * COLS + p[0]] = true; });
        for (var k2 = 0; k2 < SIZE; k2++) {
          var id2 = comp[k2];
          if (id2 < 0 || have[k2] || claim[id2] !== m2.room) continue;
          if (sizes[id2] > MAX_CELLS) continue; // safety: leave leaks alone
          pocket[m2.room].push([k2 % COLS, (k2 / COLS) | 0]);
        }
      });
    }
    var fp = [];
    G.roomMarkers.forEach(function (m3) {
      fp[m3.room] = pocket[m3.room] ? finish(pocket[m3.room]) : null;
    });
    return fp;
  }

  A.footprints = { build: build };
})(typeof window !== "undefined" ? window : this);
