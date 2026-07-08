// DOM shell, the 50 Hz game loop, and the direct-manipulation command UI.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, ST = A.state, CMD = A.commands, JN = A.jones, RN = A.render, AS = A.assets;

  // Game-speed levels: `v` is the wall-clock -> game-time multiplier (1.0 = the
  // original 50 Hz). The default is slower so there's time to react in a
  // click-driven UI; all frame-based timers scale together, so balance is kept.
  var SPEEDS = [{ n: "Slow", v: 0.28 }, { n: "Normal", v: 0.5 }, { n: "Fast", v: 1.0 }];
  var speedIdx = 1;
  var game = null, sel = -1, running = false, speed = SPEEDS[speedIdx].v, acc = 0, lastT = 0;
  var reachable = {}, hoverRoom = -1, encFrame = 0, lastLogLen = 0;
  var els = {};

  // Minimal, self-contained beeper. Guarded so a missing AudioContext (e.g.
  // headless jsdom) silently disables it rather than throwing.
  var audio = {
    ctx: null, on: true,
    init: function () {
      if (this.ctx) return;
      var AC = root.AudioContext || root.webkitAudioContext;
      if (AC) { try { this.ctx = new AC(); } catch (e) { this.ctx = null; } }
    },
    beep: function (freq, dur, vol, type) {
      if (!this.on || !this.ctx) return;
      try {
        var t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type || "square"; o.frequency.value = freq;
        g.gain.setValueAtTime(vol || 0.04, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(t); o.stop(t + dur);
      } catch (e) {}
    }
  };
  var ALARM_IDS = { 8: 1, 9: 1, 13: 1, 16: 1, 18: 1, 22: 1, 23: 1, 24: 1, 25: 1, 26: 1, 28: 1 };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }

  // ---- lifecycle --------------------------------------------------------
  function boot() {
    AS.build();
    els.map = $("mapCanvas"); els.mapCtx = els.map.getContext("2d");
    els.map.width = RN.MAPW; els.map.height = RN.MAPH;
    els.roster = $("roster"); els.actions = $("actionPanel"); els.log = $("log");
    els.hud = $("hud"); els.deckTabs = $("deckTabs");
    els.enc = $("encounter"); els.encCanvas = $("encCanvas"); els.encCtx = els.encCanvas.getContext("2d");
    els.endgame = $("endgame"); els.start = $("startScreen");

    // loading-screen splash on the title card
    var splash = $("splashCanvas");
    if (splash) { var ls = AS.loadingScreen(); splash.width = 256; splash.height = 192; splash.getContext("2d").drawImage(ls, 0, 0); }

    $("startBtn").addEventListener("click", newGame);
    $("btnPause").addEventListener("click", togglePause);
    $("btnSpeed").addEventListener("click", cycleSpeed);
    $("btnSound").addEventListener("click", function () { audio.on = !audio.on; $("btnSound").textContent = audio.on ? "🔊 Sound" : "🔇 Muted"; });
    $("btnRestart").addEventListener("click", newGame);
    $("endgameRestart").addEventListener("click", newGame);
    buildDeckTabs();

    els.map.addEventListener("mousemove", onMapHover);
    els.map.addEventListener("mouseleave", function () { hoverRoom = -1; });
    els.map.addEventListener("click", onMapClick);
    $("encClose").addEventListener("click", function () { els.enc.hidden = true; });
    document.addEventListener("keydown", onKey);
  }

  function newGame() {
    game = A.engine.startLongGame((Date.now() & 0x7fffffff) || 1);
    sel = -1; reachable = {}; lastLogLen = 0; encFrame = 0;
    els.start.hidden = true; els.endgame.hidden = true; els.enc.hidden = true;
    audio.init();
    clear(els.log);
    running = true; lastT = performance.now(); acc = 0;
    speedIdx = 1; speed = SPEEDS[speedIdx].v; $("btnSpeed").textContent = "⏱ " + SPEEDS[speedIdx].n;
    $("btnPause").textContent = "⏸ Pause";
    selectCrew(-1);
    renderAll();
    requestAnimationFrame(loop);
  }

  function togglePause() {
    running = !running;
    $("btnPause").textContent = running ? "⏸ Pause" : "▶ Resume";
    if (running) { lastT = performance.now(); requestAnimationFrame(loop); }
  }
  function cycleSpeed() {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    speed = SPEEDS[speedIdx].v;
    $("btnSpeed").textContent = "⏱ " + SPEEDS[speedIdx].n;
  }

  // ---- the 50 Hz loop ---------------------------------------------------
  function loop(t) {
    if (!game) return;
    var dt = Math.min(t - lastT, 200); lastT = t;
    if (running && !game.state.gameOver) {
      acc += dt * speed;
      var steps = 0;
      while (acc >= 20 && steps < 12) { A.engine.step(game.state, game.rng); acc -= 20; steps++; if (game.state.gameOver) break; }
    }
    renderTick();
    if (game.state.gameOver) { showEndgame(); return; }
    if (running) requestAnimationFrame(loop);
  }

  // ---- selection & deck -------------------------------------------------
  function selectCrew(k) {
    sel = k;
    game.state.viewedSlot = k;
    reachable = {};
    if (k >= 1 && game.state.actors[k].status === 0) {
      var room = game.state.actors[k].room & 63;
      if (D.roomTypeTable[room] < 3) game.state.deck = D.roomTypeTable[room];
      var opts = CMD.moveOptions(game.state, k);
      for (var i = 0; i < opts.length; i++) if (!opts[i].grille) reachable[opts[i].room] = true;
    }
    renderAll();
  }
  function buildDeckTabs() {
    clear(els.deckTabs);
    var names = ["Upper Deck", "Middle Deck", "Lower Deck"];
    for (var d = 0; d < 3; d++) (function (d) {
      var b = el("button", "deckTab", names[d]);
      b.addEventListener("click", function () { if (game) { game.state.deck = d; renderAll(); } });
      els.deckTabs.appendChild(b);
    })(d);
  }

  // ---- rendering --------------------------------------------------------
  function renderAll() { renderRoster(); renderActions(); renderHud(); renderTick(); }

  function renderTick() {
    if (!game) return;
    var s = game.state;
    // update deck-tab active state + crew counts
    var tabs = els.deckTabs.children;
    for (var d = 0; d < 3; d++) {
      var n = 0; for (var k = 1; k < 8; k++) if (s.actors[k].status === 0 && D.roomTypeTable[s.actors[k].room & 63] === d) n++;
      tabs[d].classList.toggle("active", s.deck === d);
      tabs[d].dataset.count = n;
    }
    // keep the reachable set current as the selected crew moves/crawls
    reachable = {};
    if (sel >= 1 && s.actors[sel].status === 0) {
      CMD.moveOptions(s, sel).forEach(function (o) { if (!o.grille) reachable[o.room] = true; });
    }
    var showEnc = sel >= 1 && s.actors[sel].status === 0 && s.actors[sel].room === s.actors[0].room;
    var showDuct = !showEnc && sel >= 1 && s.actors[sel].status === 0 && (s.actors[sel].room & 64);
    if (showDuct) {
      var dk = D.roomTypeTable[s.actors[sel].room & 63]; if (dk < 3) s.deck = dk; // stay on the crawler's deck
      RN.drawDuctView(els.mapCtx, s, sel);
    } else {
      RN.drawMap(els.mapCtx, s, sel, reachable, hoverRoom);
    }
    appendNewLog();
    updateHudLive();
    // alien-encounter overlay (sits on top of the map pane)
    if (showEnc) {
      els.enc.hidden = false;
      encFrame += 0.25;
      RN.drawEncounter(els.encCtx, els.encCanvas.width, els.encCanvas.height, Math.floor(encFrame), null);
      $("encTitle").textContent = "ALIEN ENCOUNTER — " + D.crewNames[sel];
    } else if (!els.enc.hidden) {
      els.enc.hidden = true;
    }
    // periodic roster/action refresh (status changes over time). Don't rebuild
    // the action panel while the pointer is over it — that would yank a button
    // out from under a click.
    if ((s.frame & 15) === 0) {
      renderRoster();
      var hovering = false; try { hovering = els.actions.matches(":hover"); } catch (e) {}
      if (!hovering) renderActions();
    }
    if (s.trackerBeep) { pulse($("hud")); audio.beep(1500, 0.05, 0.05, "square"); }
  }

  function crewCondition(a) {
    var inj = D.injuryText[Math.min(a.strength, 3)] || "Dead";
    var mor = D.moraleText[Math.min(Math.max(a.morale, 0), 4)] || "Broken";
    return { inj: inj, mor: mor };
  }

  function renderRoster() {
    var s = game.state; clear(els.roster);
    for (var k = 1; k < 8; k++) (function (k) {
      var a = s.actors[k];
      var card = el("div", "crewCard");
      if (k === sel) card.classList.add("sel");
      if (a.status === 255) card.classList.add("removed");
      if (a.status === 1) card.classList.add("dead");
      if (a.status === 2) card.classList.add("android-down");
      if (a.status === 0) {                       // in danger: a hostile shares the room
        var alienHere = s.actors[0].room === a.room;
        var androidHere = s.alienActive && k !== s.alienTargetID && s.actors[s.alienTargetID].room === a.room;
        if (alienHere || androidHere) card.classList.add("danger");
      }
      // portrait
      var pc = el("canvas", "portrait"); pc.width = 24; pc.height = 24;
      pc.getContext("2d").drawImage(AS.portrait(k - 1), 0, 0);
      card.appendChild(pc);
      var info = el("div", "crewInfo");
      info.appendChild(el("div", "crewName", D.crewNames[k]));
      if (a.status === 255) info.appendChild(el("div", "crewStat", k === s.hostSlot ? "— chestburster host" : "— hypersleep"));
      else if (a.status === 1) info.appendChild(el("div", "crewStat", "— dead"));
      else if (a.status === 2) info.appendChild(el("div", "crewStat", "— android disabled"));
      else {
        var c = crewCondition(a);
        var line = el("div", "crewStat");
        line.appendChild(el("span", "band inj i" + Math.min(a.strength, 3), c.inj));
        line.appendChild(el("span", "band mor m" + Math.min(a.morale, 4), c.mor));
        info.appendChild(line);
        var room = el("div", "crewRoom", D.roomNames[a.room & 63] + ((a.room & 64) ? " (duct)" : ""));
        info.appendChild(room);
        var f = JN.frontHandItem(s, k), b = JN.backHandItem(s, k);
        if (f !== 255 || b !== 255) {
          info.appendChild(el("div", "crewItems", "✋ " + (f !== 255 ? D.itemName(f) : "—") + "  ·  " + (b !== 255 ? D.itemName(b) : "—")));
        }
        if (a.t > 0) info.appendChild(el("div", "crewOrder", orderText(a)));
      }
      card.appendChild(info);
      if (a.status === 0) card.addEventListener("click", function () { selectCrew(k); });
      els.roster.appendChild(card);
    })(k);
  }

  function orderText(a) {
    switch (a.state) {
      case 1: return "→ moving to " + D.roomNames[a.dest & 63] + ((a.dest & 64) ? " (duct)" : "");
      case 2: return "→ through the grille";
      case 3: return "→ removing grille";
      case 4: return "→ ATTACK";
      case 6: return "→ entering hypersleep";
      default: return "→ busy";
    }
  }

  function renderActions() {
    var s = game.state; clear(els.actions);
    if (sel < 1 || s.actors[sel].status !== 0) {
      els.actions.appendChild(el("p", "hint", "Select a crew member to give orders."));
      return;
    }
    var a = s.actors[sel];
    els.actions.appendChild(el("h3", null, D.crewNames[sel]));

    // MOVE
    var inDuct = (a.room & 64) !== 0;
    var opts = CMD.moveOptions(s, sel);
    var grp = group(inDuct ? "Crawl to" : "Move to");
    var hasGrille = false;
    opts.forEach(function (o) {
      if (o.grille) {
        hasGrille = true;
        grp.appendChild(btn(inDuct ? "⬆ Climb out of the duct here" : "⬇ Enter the air duct",
          function () { CMD.moveThroughGrille(s, sel); afterOrder(); }));
      } else {
        var label = (o.byte & 64) ? ("⛆ " + D.roomNames[o.room] + " (duct)") : D.roomNames[o.room];
        grp.appendChild(btn(label, function () { CMD.moveTo(s, sel, o.byte); afterOrder(); }));
      }
    });
    if (!opts.length) grp.appendChild(el("span", "hint", "no exits"));
    if (inDuct && !hasGrille) grp.appendChild(el("span", "hint", "No open grille here — crawl to a room with a removed grille to climb out."));
    els.actions.appendChild(grp);

    // USE (items)
    var f = JN.frontHandItem(s, sel), b = JN.backHandItem(s, sel);
    var floor = CMD.roomFloorItems(s, a.room);
    var ug = group("Use");
    if (b !== 255) ug.appendChild(btn("⇄ Swap hands (" + D.itemName(f === 255 ? b : f) + ")", function () { CMD.swapHands(s, sel); afterOrder(); }));
    var handsFull = f !== 255 && b !== 255;
    floor.forEach(function (id) {
      var b2 = btn((handsFull ? "⬇ Get (hands full) " : "⬇ Get ") + D.itemName(id), function () { CMD.getItem(s, sel, id); afterOrder(); });
      if (handsFull) b2.disabled = true;
      ug.appendChild(b2);
    });
    if (f !== 255 || b !== 255) ug.appendChild(btn("⇩ Leave item", function () { CMD.leaveItem(s, sel); afterOrder(); }));
    if (f === 255 && b === 255 && !floor.length) ug.appendChild(el("span", "hint", "empty-handed, nothing here"));
    els.actions.appendChild(ug);

    // SPECIAL
    var sp = CMD.specialFor(s, sel);
    var jonesHere = s.jonesRoom === (a.room & 63) && !(a.room & 64);
    if (sp || jonesHere) {
      var spg = group("Special");
      if (sp && sp.kind === "attack") spg.appendChild(btn("⚔ ATTACK", function () { CMD.attackOrder(s, sel); afterOrder(); }, "danger"));
      if (sp && sp.kind === "grille") spg.appendChild(btn("⛏ Remove grille", function () { CMD.removeGrille(s, sel); afterOrder(); }));
      if (jonesHere && (f === 16 || f === 17)) spg.appendChild(btn("🐱 Get Jones", function () { JN.getJones(s, sel, game.rng); afterOrder(); }));
      else if (jonesHere) spg.appendChild(el("span", "hint", "need Net or Cat Box to catch Jones"));
      els.actions.appendChild(spg);
    }

    // FIXTURE
    var fg = fixtureGroup(s, sel, a);
    if (fg) els.actions.appendChild(fg);

    // pending order / cancel
    if (a.t > 0) {
      var pend = group("Pending");
      pend.appendChild(el("span", "hint", orderText(a) + " (" + a.t + ")"));
      pend.appendChild(btn("✖ Cancel", function () { CMD.cancelOrder(s, sel); afterOrder(); }));
      els.actions.appendChild(pend);
    }
  }

  function fixtureGroup(s, slot, a) {
    var room = a.room & 63, inDuct = (a.room & 64) !== 0;
    if (inDuct) return null;
    var g = group("Fixture"), any = false;
    if (room === D.ROOM.COMMD) { g.appendChild(btn(s.destructArmed ? "⏻ Abort self-destruct" : "☢ Arm self-destruct", function () { A.ship.destructToggle(s); afterOrder(); }, s.destructArmed ? "" : "danger")); any = true; }
    if (room === D.ROOM.CORRIDOR6) {
      [0, 1].forEach(function (w) {
        var blown = s.shipFlags & (w === 0 ? 2 : 4);
        g.appendChild(btn((blown ? "🔧 Seal Airlock #" : "💥 Blow Airlock #") + (w + 1), function () {
          if (blown) A.ship.sealLock(s, w); else if (confirmVent(w)) A.ship.blowLock(s, w, game.rng); afterOrder();
        }, blown ? "" : "danger"));
      }); any = true;
    }
    if (room === D.ROOM.CRYO) { g.appendChild(btn("❄ Enter hypersleep", function () { A.ship.hypersleepStart(s, slot); afterOrder(); })); any = true; }
    if (room >= 17 && room <= 19 && (s.shipFlags & (8 << (room - 17)))) { g.appendChild(btn("🧯 Fight fire", function () { A.ship.fightFire(s, slot, room); afterOrder(); })); any = true; }
    if (room === D.ROOM.NARCISSUS) { g.appendChild(btn("🚀 LAUNCH", function () { A.ship.launchGate(s); afterOrder(); }, "danger")); any = true; }
    return any ? g : null;
  }
  function confirmVent(w) { return window.confirm("Blow Airlock #" + (w + 1) + "? Everyone in that room will be killed."); }

  function group(title) { var g = el("div", "actGroup"); g.appendChild(el("div", "actTitle", title)); return g; }
  function btn(label, fn, cls) { var b = el("button", "act" + (cls ? " " + cls : ""), label); b.addEventListener("click", fn); return b; }
  function afterOrder() { renderRoster(); renderActions(); renderTick(); }

  // ---- HUD & log --------------------------------------------------------
  function renderHud() { updateHudLive(); }
  function updateHudLive() {
    var s = game.state;
    var oxy = ("0000" + Math.max(s.oxygen, 0)).slice(-4);
    $("oxy").textContent = oxy;
    $("oxy").className = s.oxygen <= 500 ? "crit" : "";
    var dz = $("destruct");
    if (s.destructArmed) { dz.hidden = false; dz.textContent = "SELF-DESTRUCT " + A.engine.mmss(s.destructSeconds); }
    else dz.hidden = true;
    var alerts = [];
    for (var e = 17; e <= 19; e++) if (s.shipFlags & (8 << (e - 17))) alerts.push("FIRE " + D.roomNames[e]);
    if (s.shipFlags & 2) alerts.push("Airlock#1 OPEN");
    if (s.shipFlags & 4) alerts.push("Airlock#2 OPEN");
    if (s.alienActive) alerts.push("ANDROID HOSTILE");
    $("alerts").textContent = alerts.join("  ·  ");
    $("frame").textContent = "T+" + (s.frame / 50 | 0) + "s";
  }

  function appendNewLog() {
    var s = game.state;
    for (var i = lastLogLen; i < s.log.length; i++) {
      var line = el("div", "logline", s.log[i].text);
      els.log.appendChild(line);
      if (ALARM_IDS[s.log[i].id]) audio.beep(196, 0.2, 0.06, "sawtooth"); // low warning tone
    }
    lastLogLen = s.log.length;
    els.log.scrollTop = els.log.scrollHeight;
  }

  function pulse(e) { e.classList.remove("pulse"); void e.offsetWidth; e.classList.add("pulse"); }

  // ---- endgame ----------------------------------------------------------
  function showEndgame() {
    var g = game.state.gameOver;
    var box = $("endgameBody"); clear(box);
    g.text.forEach(function (line, i) {
      box.appendChild(el(i === 0 ? "h2" : "div", i === 0 ? "endTitle" : "endLine", line));
    });
    els.endgame.hidden = false;
    var win = g.kind === "alienKilled" || g.kind === "escape";
    if (win) { audio.beep(523, 0.15, 0.07, "square"); setTimeout(function () { audio.beep(784, 0.3, 0.07, "square"); }, 160); }
    else audio.beep(110, 0.6, 0.08, "sawtooth");
  }

  // ---- input ------------------------------------------------------------
  function onMapHover(ev) {
    if (!game) return;
    var r = els.map.getBoundingClientRect();
    var px = (ev.clientX - r.left) * (els.map.width / r.width);
    var py = (ev.clientY - r.top) * (els.map.height / r.height);
    hoverRoom = RN.roomAtPoint(game.state, px, py);
    els.map.style.cursor = (sel >= 1 && reachable[hoverRoom]) ? "pointer" : "default";
  }
  function onMapClick(ev) {
    if (!game || sel < 1) return;
    var r = els.map.getBoundingClientRect();
    var px = (ev.clientX - r.left) * (els.map.width / r.width);
    var py = (ev.clientY - r.top) * (els.map.height / r.height);
    var room = RN.roomAtPoint(game.state, px, py);
    if (room < 0) return;
    if (reachable[room]) {
      var opts = CMD.moveOptions(game.state, sel);
      for (var i = 0; i < opts.length; i++) if (opts[i].room === room) { CMD.moveTo(game.state, sel, opts[i].byte); afterOrder(); return; }
    }
  }
  function onKey(ev) {
    if (!game) return;
    if (ev.key === " ") { ev.preventDefault(); togglePause(); }
    else if (ev.key >= "1" && ev.key <= "7") { var k = +ev.key; if (game.state.actors[k].status === 0) selectCrew(k); }
    else if (ev.key === "Escape") { els.enc.hidden = true; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : this);
