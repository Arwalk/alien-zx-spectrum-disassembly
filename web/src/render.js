// Canvas rendering: the Nostromo deck map with live overlays (crew markers,
// Jones, damage/fire, selection & reachable highlights), plus the encounter
// animation. The alien is intentionally hidden from the map (fog of war).
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, AS = A.assets;
  var SCALE = 3;
  var MAPW = 20 * 8 * SCALE, MAPH = 19 * 8 * SCALE;

  // room -> map cell (tile col/row from RoomMarkerAddrTable), pixel centre and
  // room-shaped footprint (see footprints.js); cellRoom[deck] maps tile cells
  // back to the room occupying them, for shape-accurate hit-testing.
  var cells = null, cellRoom = null;
  function buildCells() {
    cells = {}; cellRoom = [{}, {}, {}];
    var m = AS.roomMarkers();
    var fps = A.footprints ? A.footprints.build(AS.raw()) : [];
    for (var i = 0; i < m.length; i++) {
      var e = m[i], f = fps[e.room] || null;
      cells[e.room] = {
        deck: e.deck, col: e.col, row: e.row, fp: f,
        cx: (f ? f.cx : e.col + 1.5) * 8 * SCALE,
        cy: (f ? f.cy : e.row + 1) * 8 * SCALE
      };
      if (f) f.cells.forEach(function (p) { cellRoom[e.deck][p[1] * 20 + p[0]] = e.room; });
    }
  }
  function cell(room) { if (!cells) buildCells(); return cells[room]; }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Trace the room's compartment outline into ctx (expanded so the stroke
  // sits on the surrounding wall); false = no footprint, use the old box.
  var FP_MARGIN = 0.45 * 8 * SCALE;
  function roomPath(ctx, room) {
    var c = cell(room);
    if (!c || !c.fp) return false;
    ctx.beginPath();
    c.fp.outline.forEach(function (loop) {
      for (var i = 0; i < loop.length; i++) {
        var x = loop[i].x * 8 * SCALE + loop[i].nx * FP_MARGIN;
        var y = loop[i].y * 8 * SCALE + loop[i].ny * FP_MARGIN;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
    });
    return true;
  }
  function highlightPath(ctx, room, x, y, bw, bh) {
    if (!roomPath(ctx, room)) roundRect(ctx, x, y, bw, bh, 4);
  }

  // ---- order indicators ---------------------------------------------------
  // Per-state colours/glyphs for the progress ring + badge over a crew dot.
  // State 1 (move) gets the arrow instead of a glyph; 5 is the alien's own
  // attack tick (slot 0, never drawn).
  var ORDER_COLOR = { 1: "#6ee18c", 2: "#23d2d2", 3: "#23d2d2", 4: "#ff5040", 6: "#9ad2ff", 7: "#ff5040" };
  var ORDER_GLYPH = { 2: "⇅", 3: "⛏", 4: "⚔", 6: "❄", 7: "⚔" };

  // Marching-dash arrow from (x1,y1) to (x2,y2): tail trimmed clear of the
  // crew dot, dashes animated toward the filled head (drawMap runs every
  // frame, so Date.now() animates for free, and freezes on pause).
  function orderArrow(ctx, x1, y1, x2, y2, color, ductMove) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 30) return;
    var ux = dx / len, uy = dy / len;
    var ax = x1 + ux * 16, ay = y1 + uy * 16;   // clear of the dot
    var hx = x2 - ux * 6, hy = y2 - uy * 6;     // head tip, short of the centre
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = ductMove ? 2 : 2.5; ctx.lineCap = "round";
    ctx.setLineDash(ductMove ? [3, 5] : [7, 5]);
    ctx.lineDashOffset = -((Date.now() / 45) % (ductMove ? 8 : 12));
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx - ux * 9, hy - uy * 9); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - ux * 10 - uy * 5, hy - uy * 10 + ux * 5);
    ctx.lineTo(hx - ux * 10 + uy * 5, hy - uy * 10 - ux * 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Countdown ring around a crew dot: faint full track + the elapsed arc.
  function progressRing(ctx, cx, cy, r, frac, color) {
    if (frac < 0) frac = 0; if (frac > 1) frac = 1;
    ctx.save();
    ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // Small action badge floated above a crew dot (⛏ ⚔ ❄ ⇅).
  function orderBadge(ctx, cx, cy, glyph, color) {
    ctx.save();
    ctx.fillStyle = "rgba(4,10,12,0.85)";
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 7); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = color; ctx.font = "10px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(glyph, cx, cy + 0.5);
    ctx.restore();
  }
  function orderFrac(a) { return a.t0 > 0 ? 1 - a.t / a.t0 : 0; }

  function drawMap(ctx, s, sel, reachable, hoverRoom) {
    if (!cells) buildCells();
    var deck = s.deck, dc = AS.deck(deck);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#05080a"; ctx.fillRect(0, 0, MAPW, MAPH);
    ctx.drawImage(dc, 0, 0, MAPW, MAPH);

    var fireBits = [8, 16, 32];
    for (var room = 0; room < 34; room++) {
      if (D.roomTypeTable[room] !== deck) continue;
      var c = cell(room);
      if (!c) continue;
      var x = c.col * 8 * SCALE, y = c.row * 8 * SCALE;
      var bw = 3 * 8 * SCALE, bh = 2 * 8 * SCALE;

      // reachable move target
      if (reachable && reachable[room]) {
        ctx.fillStyle = "rgba(0,220,220,0.16)"; highlightPath(ctx, room, x, y, bw, bh); ctx.fill();
        ctx.strokeStyle = "rgba(0,220,220,0.8)"; ctx.lineWidth = 2; ctx.stroke();
      }
      // hover
      if (hoverRoom === room) {
        ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1.5;
        highlightPath(ctx, room, x, y, bw, bh); ctx.stroke();
      }
      // selected crew's room
      if (sel >= 1 && (s.actors[sel].room & 63) === room) {
        ctx.strokeStyle = "#ffb020"; ctx.lineWidth = 2.5; highlightPath(ctx, room, x, y, bw, bh); ctx.stroke();
      }
      // selected crew's queued destination — dashed amber pulse (drawMap runs
      // every frame, so the Date.now() phase animates for free)
      if (sel >= 1) {
        var qa = s.actors[sel];
        if (qa.status === 0 && qa.state === 1 && qa.t > 0 && (qa.dest & 63) === room && (qa.room & 63) !== room) {
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = "#ffb020"; ctx.lineWidth = 2;
          ctx.globalAlpha = 0.45 + 0.35 * Math.sin(Date.now() / 300);
          highlightPath(ctx, room, x, y, bw, bh); ctx.stroke();
          ctx.restore();
        }
      }
      // damage / fire badges — pinned to the room shape's top-right corner
      var bx = x + bw - 10, by = y + 8;
      if (c.fp) { bx = c.fp.bbox.c1 * 8 * SCALE - 10; by = c.fp.bbox.r0 * 8 * SCALE + 8; }
      var dmg = s.roomDamage[room];
      var onFire = room >= 17 && room <= 19 && (s.shipFlags & fireBits[room - 17]);
      if (onFire) { badge(ctx, bx, by, "#ff5030", "▲"); }
      else if (dmg >= 30) { badge(ctx, bx, by, "#ff8030", ""); }
      else if (dmg > 0) { badge(ctx, bx, by, "rgba(255,190,60,0.7)", ""); }
    }

    // movement arrows: every live crew member on this deck with a pending
    // MOVE order gets a marching-dash arrow toward the destination (cyan
    // dashes = a duct crawl). A cross-deck destination becomes a vertical
    // stub with the target-deck tag; a mover ARRIVING on this deck from
    // another one is announced by an inbound stub at the destination room.
    for (var k0 = 1; k0 < 8; k0++) {
      var ma = s.actors[k0];
      if (ma.status !== 0 || ma.t === 0 || ma.state !== 1 || ma.dest === ma.room) continue;
      var mFrom = cell(ma.room & 63), mTo = cell(ma.dest & 63);
      var fromDeck = D.roomTypeTable[ma.room & 63], destDeck = D.roomTypeTable[ma.dest & 63];
      var mCol = k0 === sel ? "#ffb020" : ((ma.dest & 64) ? "rgba(35,210,210,0.8)" : "rgba(110,225,140,0.8)");
      if (fromDeck === deck && mFrom) {
        if (mTo && destDeck === deck) {
          orderArrow(ctx, mFrom.cx, mFrom.cy, mTo.cx, mTo.cy, mCol, (ma.dest & 64) !== 0);
        } else {                     // leaving this deck: stub + deck tag
          var up = destDeck < deck || destDeck > 2;
          var sy = mFrom.cy + (up ? -42 : 42);
          orderArrow(ctx, mFrom.cx, mFrom.cy, mFrom.cx, sy + (up ? -12 : 12), mCol, false);
          ctx.fillStyle = mCol; ctx.font = "8px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(destDeck > 2 ? "NARCISSUS" : ["UPPER", "MID", "LOWER"][destDeck], mFrom.cx, sy + (up ? -18 : 18));
        }
      } else if (destDeck === deck && mTo && fromDeck !== deck) {
        var down = fromDeck < deck || fromDeck > 2; // arriving from above
        var ty = mTo.cy + (down ? -42 : 42);
        orderArrow(ctx, mTo.cx, ty, mTo.cx, mTo.cy, mCol, false);
        ctx.fillStyle = mCol; ctx.font = "8px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(D.crewNames[k0], mTo.cx, ty + (down ? -8 : 8));
      }
    }

    // crew markers (live human crew + active android show as a crew dot);
    // co-located occupants (incl. Jones) fan out horizontally so everyone
    // stays visible
    var occ = {};
    for (var k = 1; k < 8; k++) {
      var a = s.actors[k];
      if (a.status !== 0) continue;
      var room2 = a.room & 63;
      if (D.roomTypeTable[room2] !== deck || !cell(room2)) continue;
      (occ[room2] = occ[room2] || []).push(k);
    }
    if (s.jonesRoom >= 0 && s.jonesRoom < 34 && D.roomTypeTable[s.jonesRoom] === deck && cell(s.jonesRoom)) {
      (occ[s.jonesRoom] = occ[s.jonesRoom] || []).push(-1); // -1 = Jones
    }
    Object.keys(occ).forEach(function (rm) {
      var list = occ[rm], cc = cell(+rm);
      var step = list.length > 3 ? 15 : 18;
      // draw the selected crew member's (bigger) dot last so it sits on top
      var order = list.map(function (_, i) { return i; });
      order.sort(function (p, q) { return (list[p] === sel ? 1 : 0) - (list[q] === sel ? 1 : 0); });
      order.forEach(function (i) {
        var mx = cc.cx + (i - (list.length - 1) / 2) * step;
        if (list[i] === -1) {
          crewDot(ctx, mx, cc.cy, "🐱", false, false, "#8bd");
        } else {
          var a2 = s.actors[list[i]];
          crewDot(ctx, mx, cc.cy, D.crewNames[list[i]].charAt(0), list[i] === sel, (a2.room & 64) !== 0);
          // pending timed order: countdown ring + action badge (moves get
          // the arrow instead of a badge)
          if (a2.t > 0 && a2.state > 0) {
            var dotR = list[i] === sel ? 11 : 9;
            var ringR = dotR + ((a2.room & 64) ? 7 : 4.5); // outside the duct dash
            var oc = list[i] === sel && a2.state === 1 ? "#ffb020" : (ORDER_COLOR[a2.state] || "#6ee18c");
            progressRing(ctx, mx, cc.cy, ringR, orderFrac(a2), oc);
            if (ORDER_GLYPH[a2.state]) orderBadge(ctx, mx, cc.cy - ringR - 8, ORDER_GLYPH[a2.state], oc);
          }
        }
      });
    });
  }

  function badge(ctx, x, y, color, glyph) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
    if (glyph) { ctx.fillStyle = "#fff"; ctx.font = "8px monospace"; ctx.textAlign = "center"; ctx.fillText(glyph, x, y + 3); }
  }
  function crewDot(ctx, cx, cy, label, selected, inDuct, color) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, selected ? 11 : 9, 0, 7);
    ctx.fillStyle = color || (selected ? "#ffcf4a" : "rgba(60,200,90,0.92)");
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = selected ? "#fff" : "rgba(0,0,0,0.6)"; ctx.stroke();
    if (inDuct) { ctx.setLineDash([3, 2]); ctx.strokeStyle = "#0cc"; ctx.beginPath(); ctx.arc(cx, cy, 13, 0, 7); ctx.stroke(); }
    ctx.fillStyle = "#04120a"; ctx.font = "bold 12px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy + 1);
    ctx.restore();
  }

  // Room hit test for a canvas click (only rooms on the shown deck): the
  // room whose footprint covers the pointed-at tile cell, else the nearest
  // room centre within reach.
  function roomAtPoint(s, px, py) {
    if (!cells) buildCells();
    var tc = (px / (8 * SCALE)) | 0, tr = (py / (8 * SCALE)) | 0;
    if (tc >= 0 && tc < 20 && tr >= 0 && tr < 19) {
      var hit = cellRoom[s.deck][tr * 20 + tc];
      if (hit !== undefined && D.roomTypeTable[hit] === s.deck) return hit;
    }
    var best = -1, bestD = 40 * 40; // px^2 threshold
    for (var room = 0; room < 34; room++) {
      if (D.roomTypeTable[room] !== s.deck) continue;
      var c = cell(room); if (!c) continue;
      var dx = px - c.cx, dy = py - c.cy, dd = dx * dx + dy * dy;
      if (dd < bestD) { bestD = dd; best = room; }
    }
    return best;
  }

  // Draw an encounter frame (alien + optional running Jones) into a canvas ctx.
  function drawEncounter(ctx, w, h, frame, jonesX) {
    ctx.fillStyle = "#02120a"; ctx.fillRect(0, 0, w, h);
    var af = AS.alienFrame(frame);
    var s = Math.min(w / af.width, h / af.height) * 0.8;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(af, (w - af.width * s) / 2, (h - af.height * s) / 2, af.width * s, af.height * s);
    if (jonesX != null) {
      var jf = AS.jonesFrame(Math.floor(frame) % 5);
      ctx.drawImage(jf, jonesX, h * 0.7, jf.width * 2, jf.height * 2);
    }
  }

  // The air-duct view: the deck floor faintly beneath, the duct crawlways drawn
  // between rooms, open grilles flagged as climb-out points, and the crawling
  // crew member's marker sitting over whichever room it is currently above.
  function drawDuctView(ctx, s, sel) {
    if (!cells) buildCells();
    var a = s.actors[sel], room = a.room & 63;
    var deck = D.roomTypeTable[room]; if (deck > 2) deck = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#04080a"; ctx.fillRect(0, 0, MAPW, MAPH);
    ctx.save(); ctx.globalAlpha = 0.4; ctx.drawImage(AS.deck(deck), 0, 0, MAPW, MAPH); ctx.restore(); // the floor, faint
    ctx.save(); ctx.globalAlpha = 0.14; ctx.fillStyle = "#0bd"; ctx.fillRect(0, 0, MAPW, MAPH); ctx.restore(); // duct wash

    var cur = cell(room), base = room * 5;
    // crawlways to same-deck duct neighbours
    ctx.save(); ctx.lineWidth = 3; ctx.setLineDash([7, 5]); ctx.strokeStyle = "rgba(0,225,225,0.75)";
    for (var dir = 0; dir < 5; dir++) {
      var adj = D.roomAdjDucts[base + dir];
      if (adj === undefined || adj === room || D.roomTypeTable[adj] !== deck) continue;
      var c2 = cell(adj);
      if (c2 && cur) { ctx.beginPath(); ctx.moveTo(cur.cx, cur.cy); ctx.lineTo(c2.cx, c2.cy); ctx.stroke(); }
    }
    ctx.setLineDash([]); ctx.restore();
    // open grilles on this deck = climb-out points
    ctx.fillStyle = "rgba(120,255,180,0.95)"; ctx.font = "13px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    for (var r = 0; r < 34; r++) {
      if (D.roomTypeTable[r] !== deck || s.roomGrille[r] !== 0) continue;
      var cg = cell(r); if (cg) ctx.fillText("↑", cg.cx, cg.cy - 12);
    }
    // pending crawl: marching-dash arrow to the destination duct node,
    // countdown ring + badge around the crawler (same language as the map)
    if (cur && a.t > 0 && a.state > 0) {
      if (a.state === 1 && a.dest !== a.room) {
        var cd = cell(a.dest & 63), cdDeck = D.roomTypeTable[a.dest & 63];
        if (cd && cdDeck === deck) {
          orderArrow(ctx, cur.cx, cur.cy, cd.cx, cd.cy, "#7ef0f0", true);
        } else {                    // crawling to another deck: stub + tag
          var cup = cdDeck < deck;
          orderArrow(ctx, cur.cx, cur.cy, cur.cx, cur.cy + (cup ? -54 : 54), "#7ef0f0", true);
          ctx.fillStyle = "#7ef0f0"; ctx.font = "8px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(["UPPER", "MID", "LOWER"][cdDeck] || "", cur.cx, cur.cy + (cup ? -60 : 60));
        }
      }
      progressRing(ctx, cur.cx, cur.cy, 21, orderFrac(a), ORDER_COLOR[a.state] || "#7ef0f0");
      if (ORDER_GLYPH[a.state]) orderBadge(ctx, cur.cx, cur.cy - 29, ORDER_GLYPH[a.state], ORDER_COLOR[a.state] || "#7ef0f0");
    }
    // the crawling crew member over its current room (moves as it crawls)
    if (cur) {
      var t = (Date.now() / 320) % 1, rr = 11 + 3 * Math.sin(t * Math.PI * 2);
      ctx.beginPath(); ctx.arc(cur.cx, cur.cy, rr, 0, 7); ctx.fillStyle = "#23d2d2"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#dff"; ctx.stroke();
      ctx.setLineDash([3, 2]); ctx.strokeStyle = "#0ff"; ctx.beginPath(); ctx.arc(cur.cx, cur.cy, rr + 5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#04121a"; ctx.font = "bold 12px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(D.crewNames[sel].charAt(0), cur.cx, cur.cy + 1);
    }
    // banner
    ctx.fillStyle = "rgba(4,10,14,0.82)"; ctx.fillRect(0, 0, MAPW, 26);
    ctx.fillStyle = "#23d2d2"; ctx.font = "bold 14px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("⛆ AIR DUCT — above " + D.roomNames[room], 8, 14);
  }

  A.render = {
    SCALE: SCALE, MAPW: MAPW, MAPH: MAPH,
    drawMap: drawMap, roomAtPoint: roomAtPoint, drawEncounter: drawEncounter,
    drawDuctView: drawDuctView, cell: cell
  };
})(typeof window !== "undefined" ? window : this);
