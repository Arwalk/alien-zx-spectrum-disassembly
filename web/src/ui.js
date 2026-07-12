// DOM shell, the fixed-step game loop, and the direct-manipulation command UI.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, ST = A.state, CMD = A.commands, JN = A.jones, RN = A.render, AS = A.assets;

  // Game-speed levels: `v` is the wall-clock -> game-time multiplier, where
  // 1.0 = 50 engine steps/s. The original main loop was NOT 50 Hz: each idle
  // pass ran two ~36 ms busy-waits (FrameTiming + PlayMusic) plus the real
  // work — a simulator-measured ~74 ms/iteration, i.e. ~13.5 steps/s. So
  // "Normal" (0.27) IS the authentic hardware pace; all frame-based timers
  // scale together, so balance is kept at every speed.
  var SPEEDS = [{ n: "Slow", v: 0.15 }, { n: "Normal", v: 0.27 }, { n: "Fast", v: 0.5 }];
  var speedIdx = 1;
  var game = null, sel = -1, running = false, speed = SPEEDS[speedIdx].v, acc = 0, lastT = 0;
  // encStart: engine frame the current encounter overlay appeared on; the alien
  // body advances one frame per engine step (UpdateAlienAnim's authentic cadence,
  // so it scales with the speed setting and freezes on pause). -1 = no encounter.
  var reachable = {}, hoverRoom = -1, encStart = -1;
  // encDismissed: the ✕ hid the overlay for the CURRENT encounter (re-arms
  // when the encounter ends); encKey fingerprints the overlay's button strip.
  var encDismissed = false, encKey = "";
  // hoverSource: who owns hoverRoom ("map" | "chip" | null). peekDeck: the deck to
  // restore after a cross-deck move-chip hover temporarily switched the view.
  var hoverSource = null, peekDeck = -1;
  // panelKey fingerprints the action panel's content so renderTick only rebuilds
  // it when something actually changed (buttons must not shift under the mouse);
  // actionsDirty defers a needed rebuild while the pointer is over the panel.
  var panelKey = "", actionsDirty = false;
  // log bookkeeping: last appended state.log entry (by identity — the log array
  // is a capped ring, so indices shift) and the last DOM line for "×n" dedupe.
  var logLastEntry = null, logLast = { text: null, el: null, badge: null, n: 1 };
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
    els.logJump = $("logJump");
    els.hud = $("hud"); els.deckTabs = $("deckTabs");
    els.enc = $("encounter"); els.encCanvas = $("encCanvas"); els.encCtx = els.encCanvas.getContext("2d");
    els.endgame = $("endgame"); els.start = $("startScreen");
    els.mapTip = $("mapTip"); els.paused = $("pausedBanner");

    // loading-screen splash on the title card
    var splash = $("splashCanvas");
    if (splash) { var ls = AS.loadingScreen(); splash.width = 256; splash.height = 192; splash.getContext("2d").drawImage(ls, 0, 0); }

    $("startBtn").addEventListener("click", function () {
      if (tutorialSeen()) newGame();
      else openTutorial(function () { markTutorialSeen(); newGame(); });
    });
    $("btnPause").addEventListener("click", togglePause);
    $("btnSpeed").addEventListener("click", cycleSpeed);
    $("btnSound").addEventListener("click", function () { audio.on = !audio.on; $("btnSound").textContent = audio.on ? "🔊 Sound" : "🔇 Muted"; });
    $("btnHelp").addEventListener("click", function () {
      var wasRunning = running && game && !game.state.gameOver;
      if (wasRunning) togglePause();
      openTutorial(function () { if (wasRunning && !running) togglePause(); });
    });
    $("tutClose").addEventListener("click", closeTutorial);
    $("btnRestart").addEventListener("click", newGame);
    $("endgameRestart").addEventListener("click", newGame);
    buildDeckTabs();

    els.map.addEventListener("mousemove", onMapHover);
    els.map.addEventListener("mouseleave", function () {
      if (hoverSource === "map") { hoverRoom = -1; hoverSource = null; }
      syncChipHl(-1);
      els.mapTip.hidden = true;
    });
    els.map.addEventListener("click", onMapClick);
    // flush a deferred action-panel rebuild once the pointer is out of the way
    els.actions.addEventListener("mouseleave", function () {
      clearChipHover();
      if (actionsDirty) renderActions();
    });
    els.logJump.addEventListener("click", function () {
      els.log.scrollTop = els.log.scrollHeight;
      els.logJump.hidden = true;
    });
    $("encClose").addEventListener("click", function () { encDismissed = true; els.enc.hidden = true; });
    document.addEventListener("keydown", onKey);
  }

  function newGame() {
    game = A.engine.startLongGame((Date.now() & 0x7fffffff) || 1);
    sel = -1; reachable = {}; encStart = -1; encDismissed = false; encKey = "";
    hoverRoom = -1; hoverSource = null; peekDeck = -1; panelKey = ""; actionsDirty = false;
    logLastEntry = null; logLast = { text: null, el: null, badge: null, n: 1 };
    els.logJump.hidden = true;
    els.start.hidden = true; els.endgame.hidden = true; els.enc.hidden = true;
    audio.init();
    clear(els.log);
    running = true; lastT = performance.now(); acc = 0;
    speedIdx = 1; speed = SPEEDS[speedIdx].v; $("btnSpeed").textContent = "⏱ " + SPEEDS[speedIdx].n;
    $("btnPause").textContent = "⏸ Pause";
    els.paused.hidden = true; els.mapTip.hidden = true;
    selectCrew(-1);
    renderAll();
    requestAnimationFrame(loop);
  }

  function togglePause() {
    running = !running;
    $("btnPause").textContent = running ? "⏸ Pause" : "▶ Resume";
    els.paused.hidden = running || !game || game.state.gameOver;
    if (running) { lastT = performance.now(); requestAnimationFrame(loop); }
  }
  function cycleSpeed() {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    speed = SPEEDS[speedIdx].v;
    $("btnSpeed").textContent = "⏱ " + SPEEDS[speedIdx].n;
  }

  // ---- tutorial ----------------------------------------------------------
  // Opens automatically on the first launch of each page load (the flag is a
  // plain variable, so a reload resets it); the HUD's ❓ Help reopens it,
  // pausing the game while it's up.
  var tutOnClose = null, tutSeen = false;
  function tutorialSeen() { return tutSeen; }
  function markTutorialSeen() { tutSeen = true; }
  function openTutorial(onClose) {
    tutOnClose = onClose || null;
    $("tutClose").textContent = game ? "✓ Back to the ship" : "▶ Begin the Long Game";
    $("tutorial").hidden = false;
  }
  function closeTutorial() {
    $("tutorial").hidden = true;
    var cb = tutOnClose; tutOnClose = null;
    if (cb) cb();
  }

  // ---- the fixed-step loop (one engine step per 20 ms of scaled time) ----
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
    clearChipHover();
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
      b.addEventListener("click", function () { if (game) { clearChipHover(); game.state.deck = d; renderAll(); } });
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
    // alien-encounter overlay (sits on top of the map pane; ✕ hides it for
    // the rest of this encounter, so the map stays reachable underneath)
    if (!showEnc) { encDismissed = false; encKey = ""; encStart = -1; }
    if (showEnc && !encDismissed) {
      els.enc.hidden = false;
      if (encStart < 0) encStart = s.frame;
      RN.drawEncounter(els.encCtx, els.encCanvas.width, els.encCanvas.height, s.frame - encStart, null);
      $("encTitle").textContent = "ALIEN ENCOUNTER — " + D.crewNames[sel];
      refreshEncActions();
    } else if (!els.enc.hidden) {
      els.enc.hidden = true;
    }
    // periodic roster/action refresh (status changes over time)
    if ((s.frame & 15) === 0) {
      renderRoster();
      refreshActions();
    }
    // live in-place updates while the panel is hover-frozen: the pending
    // countdown (acknowledging completion) and the header's room name
    if (sel >= 1 && s.actors[sel].status === 0) {
      var pa = s.actors[sel];
      var pt = els.actions.querySelector(".pendText");
      if (pt) pt.textContent = pa.t > 0 ? orderText(pa) + " (" + pa.t + ")" : "✓ order carried out";
      var rm = els.actions.querySelector(".detailHead .crewRoom");
      if (rm) rm.textContent = D.roomNames[pa.room & 63] + ((pa.room & 64) ? " (duct)" : "");
    }
    if (s.trackerBeep) { pulse($("hud")); audio.beep(1500, 0.05, 0.05, "square"); }
  }

  function crewCondition(a) {
    // strength 3 still reads "Wounded" — only 4+ is "OK" (DrawCrewCondition $7E81)
    var inj = D.injuryText[a.strength >= 4 ? 3 : Math.min(a.strength, 2)] || "Dead";
    var mor = D.moraleText[Math.min(Math.max(a.morale, 0), 4)] || "Broken";
    return { inj: inj, mor: mor };
  }

  // Slim one-line rows: name, injury/morale, current room, ongoing order.
  // Hand items live in the row tooltip and in the action panel's detail header.
  function renderRoster() {
    var s = game.state; clear(els.roster);
    for (var k = 1; k < 8; k++) (function (k) {
      var a = s.actors[k];
      var card = el("div", "crewCard");
      if (k === sel) card.classList.add("sel");
      if (a.status === 255) card.classList.add("removed");
      // status 1 = dead, 2 = dead-and-found (or the defeated android)
      if (a.status === 1 || (a.status === 2 && k !== s.alienTargetID)) card.classList.add("dead");
      if (a.status === 2 && k === s.alienTargetID) card.classList.add("android-down");
      if (a.status === 0) {                       // in danger: a hostile shares the room
        var alienHere = s.actors[0].room === a.room;
        var androidHere = s.alienActive && k !== s.alienTargetID && s.actors[s.alienTargetID].room === a.room;
        if (alienHere || androidHere) card.classList.add("danger");
      }
      // portrait
      var pc = el("canvas", "portrait sm"); pc.width = 24; pc.height = 24;
      pc.getContext("2d").drawImage(AS.portrait(k - 1), 0, 0);
      card.appendChild(pc);
      card.appendChild(el("span", "crewName", D.crewNames[k]));
      if (a.status === 255) card.appendChild(el("span", "crewOrder", k === s.hostSlot ? "— chestburster host" : "— hypersleep"));
      else if (a.status === 1) card.appendChild(el("span", "crewOrder", "— dead"));
      else if (a.status === 2) card.appendChild(el("span", "crewOrder", "— android disabled"));
      else {
        var c = crewCondition(a);
        card.appendChild(el("span", "band inj i" + Math.min(a.strength, 3), c.inj));
        card.appendChild(el("span", "band mor m" + Math.min(a.morale, 4), c.mor));
        card.appendChild(el("span", "crewRoom", D.roomNames[a.room & 63] + ((a.room & 64) ? " (duct)" : "")));
        card.appendChild(el("span", "crewOrder", a.t > 0 ? orderText(a) : ""));
        var f = JN.frontHandItem(s, k), b = JN.backHandItem(s, k);
        card.title = D.roomNames[a.room & 63] + ((a.room & 64) ? " (duct)" : "") +
          ((f !== 255 || b !== 255)
            ? " — ✋ " + (f !== 255 ? D.itemName(f) : "—") + " · " + (b !== 255 ? D.itemName(b) : "—") : "");
      }
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

  // Fingerprint of everything the action panel displays (except the live
  // countdown, updated in place). renderTick skips the rebuild when unchanged.
  function computePanelKey() {
    var s = game.state;
    if (sel < 1 || s.actors[sel].status !== 0) return "none:" + sel;
    var a = s.actors[sel];
    var f = JN.frontHandItem(s, sel), b = JN.backHandItem(s, sel);
    var opts = CMD.moveOptions(s, sel).map(function (o) { return o.grille ? "g" : o.byte; }).join(",");
    var sp = CMD.specialFor(s, sel);
    return [sel, a.room, a.state, a.t > 0 ? 1 : 0, f, b,
      CMD.roomFloorItems(s, a.room).join("."), opts, sp ? sp.kind : "-",
      s.jonesRoom === (a.room & 63) ? 1 : 0, s.destructArmed ? 1 : 0,
      s.shipFlags & 63, s.deck].join("|");
  }
  function refreshActions() {
    if (computePanelKey() === panelKey) return;
    var hovering = false; try { hovering = els.actions.matches(":hover"); } catch (e) {}
    if (hovering) { actionsDirty = true; return; } // don't yank a button out from under a click
    renderActions();
  }

  function renderActions() {
    var s = game.state; clear(els.actions);
    actionsDirty = false; clearChipHover(); // self-heal if rebuilt under the cursor
    panelKey = computePanelKey();
    if (sel < 1 || s.actors[sel].status !== 0) {
      els.actions.appendChild(el("p", "hint", "Select a crew member to give orders."));
      return;
    }
    var a = s.actors[sel];
    var f = JN.frontHandItem(s, sel), b = JN.backHandItem(s, sel);

    // detail header: who/where + the two hands (master-detail: the roster rows
    // stay minimal, the selected crew's full context lives here)
    var head = el("div", "detailHead");
    var pc = el("canvas", "portrait"); pc.width = 24; pc.height = 24;
    pc.getContext("2d").drawImage(AS.portrait(sel - 1), 0, 0);
    head.appendChild(pc);
    var info = el("div", "detailInfo");
    info.appendChild(el("div", "crewName", D.crewNames[sel]));
    info.appendChild(el("div", "crewRoom", D.roomNames[a.room & 63] + ((a.room & 64) ? " (duct)" : "")));
    head.appendChild(info);
    var hands = el("div", "hands");
    var front = el("span", "handSlot", "✋ " + (f !== 255 ? D.itemName(f) : "empty"));
    front.title = "front hand — weapons act from here";
    hands.appendChild(front);
    var back = el("button", "handSlot act", "⇄ " + (b !== 255 ? D.itemName(b) : "empty"));
    back.title = "back hand — click to swap hands";
    if (b === 255) back.disabled = true;
    else back.addEventListener("click", function () { CMD.swapHands(s, sel); afterOrder(); });
    hands.appendChild(back);
    head.appendChild(hands);
    els.actions.appendChild(head);

    var body = el("div", "actBody");

    // MOVE — chips; hovering one highlights its room on the map (deck-peeking
    // to the target's deck if needed), clicking issues the order
    var inDuct = (a.room & 64) !== 0;
    var opts = CMD.moveOptions(s, sel);
    var grp = group(inDuct ? "Crawl to" : "Move to");
    var chips = el("div", "chips");
    var hasGrille = false;
    opts.forEach(function (o) {
      if (o.grille) {
        hasGrille = true;
        chips.appendChild(btn(inDuct ? "⬆ Climb out here" : "⬇ Enter the air duct",
          function () { clearChipHover(); CMD.moveThroughGrille(s, sel); afterOrder(); }, "chip"));
      } else {
        var label = (o.byte & 64) ? ("⛆ " + D.roomNames[o.room]) : D.roomNames[o.room];
        var cb = btn(label, function () { clearChipHover(); CMD.moveTo(s, sel, o.byte); afterOrder(); }, "chip");
        cb.dataset.room = o.room;
        var dk = D.roomTypeTable[o.room];
        if (dk < 3 && dk !== s.deck) cb.appendChild(el("span", "deckBadge", ["UPPER", "MID", "LOWER"][dk]));
        cb.addEventListener("mouseenter", function () { setChipHover(o.room); });
        cb.addEventListener("mouseleave", function () { clearChipHover(); });
        chips.appendChild(cb);
      }
    });
    grp.appendChild(chips);
    if (!opts.length) grp.appendChild(el("span", "hint", "no exits"));
    else if (!inDuct) grp.appendChild(el("div", "hint", "…or click a highlighted room on the map"));
    if (inDuct && !hasGrille) grp.appendChild(el("div", "hint", "No open grille here — crawl to a room with a removed grille to climb out."));
    body.appendChild(grp);

    // USE (items) — swap lives on the back-hand slot in the header
    var floor = CMD.roomFloorItems(s, a.room);
    var handsFull = f !== 255 && b !== 255;
    if (floor.length || f !== 255 || b !== 255) {
      var ug = group("Use");
      var uchips = el("div", "chips");
      floor.forEach(function (id) {
        var b2 = btn("⬇ Get " + D.itemName(id), function () { CMD.getItem(s, sel, id); afterOrder(); }, "chip");
        if (handsFull) { b2.disabled = true; b2.title = "hands full"; }
        uchips.appendChild(b2);
      });
      if (f !== 255 || b !== 255) uchips.appendChild(btn("⇩ Leave item", function () { CMD.leaveItem(s, sel); afterOrder(); }, "chip"));
      ug.appendChild(uchips);
      body.appendChild(ug);
    }

    // SPECIAL
    var sp = CMD.specialFor(s, sel);
    var jonesHere = s.jonesRoom === (a.room & 63) && !(a.room & 64);
    if (sp || jonesHere) {
      var spg = group("Special");
      if (sp && sp.kind === "attack") spg.appendChild(btn("⚔ ATTACK", function () { CMD.attackOrder(s, sel); afterOrder(); }, "wide danger"));
      if (sp && sp.kind === "grille") spg.appendChild(btn("⛏ Remove grille", function () { CMD.removeGrille(s, sel); afterOrder(); }, "wide"));
      if (jonesHere && (f === 16 || f === 17)) spg.appendChild(btn("🐱 Get Jones", function () { JN.getJones(s, sel, game.rng); afterOrder(); }, "wide"));
      else if (jonesHere) spg.appendChild(el("span", "hint", "need Net or Cat Box to catch Jones"));
      body.appendChild(spg);
    }

    // FIXTURE
    var fg = fixtureGroup(s, sel, a);
    if (fg) body.appendChild(fg);

    els.actions.appendChild(body);

    // pending order — pinned bar at the panel foot, countdown updated live
    if (a.t > 0) {
      var bar = el("div", "pendingBar");
      bar.appendChild(el("span", "pendText", orderText(a) + " (" + a.t + ")"));
      bar.appendChild(btn("✖ Cancel", function () { CMD.cancelOrder(s, sel); afterOrder(); }, "chip danger"));
      els.actions.appendChild(bar);
    }
  }

  function fixtureGroup(s, slot, a) {
    var room = a.room & 63, inDuct = (a.room & 64) !== 0;
    if (inDuct) return null;
    var g = group("Fixture"), any = false;
    if (room === D.ROOM.COMMD) { g.appendChild(btn(s.destructArmed ? "⏻ Abort self-destruct" : "☢ Arm self-destruct", function () { A.ship.destructToggle(s); afterOrder(); }, s.destructArmed ? "wide" : "wide danger")); any = true; }
    if (room === D.ROOM.CORRIDOR6) {
      [0, 1].forEach(function (w) {
        var blown = s.shipFlags & (w === 0 ? 2 : 4);
        g.appendChild(btn((blown ? "🔧 Seal Airlock #" : "💥 Blow Airlock #") + (w + 1), function () {
          if (blown) A.ship.sealLock(s, w); else if (confirmVent(w)) A.ship.blowLock(s, w, game.rng); afterOrder();
        }, blown ? "wide" : "wide danger"));
      }); any = true;
    }
    if (room === D.ROOM.CRYO) { g.appendChild(btn("❄ Enter hypersleep", function () { A.ship.hypersleepStart(s, slot); afterOrder(); }, "wide")); any = true; }
    if (room >= 17 && room <= 19 && (s.shipFlags & (8 << (room - 17)))) { g.appendChild(btn("🧯 Fight fire", function () { A.ship.fightFire(s, slot, room); afterOrder(); }, "wide")); any = true; }
    if (room === D.ROOM.NARCISSUS) { g.appendChild(btn("🚀 LAUNCH", function () { A.ship.launchGate(s); afterOrder(); }, "wide danger")); any = true; }
    return any ? g : null;
  }
  function confirmVent(w) { return window.confirm("Blow Airlock #" + (w + 1) + "? Everyone in that room will be killed."); }

  function group(title) { var g = el("div", "actGroup"); g.appendChild(el("div", "actTitle", title)); return g; }
  function btn(label, fn, cls) { var b = el("button", "act" + (cls ? " " + cls : ""), label); b.addEventListener("click", fn); return b; }
  function afterOrder() { renderRoster(); renderActions(); renderTick(); }

  // ---- encounter-overlay command strip -----------------------------------
  // ATTACK beside every escape route, so fleeing is as obvious as fighting.
  // Rebuilt only when the option set changes, and never under the pointer
  // (same freeze rule as the action panel); the pending line updates live.
  function encActionsKey() {
    var s = game.state, a = s.actors[sel];
    var opts = CMD.moveOptions(s, sel).map(function (o) { return o.grille ? "g" : o.byte; }).join(",");
    return [sel, a.room, a.state, a.t > 0 ? 1 : 0, opts].join("|");
  }
  function refreshEncActions() {
    var key = encActionsKey();
    if (key !== encKey) {
      var box = $("encActions");
      var hovering = false; try { hovering = box.matches(":hover"); } catch (e) {}
      if (!hovering) {
        encKey = key;
        clear(box);
        var s = game.state, a = s.actors[sel], inDuct = (a.room & 64) !== 0;
        box.appendChild(btn("⚔ ATTACK", function () { CMD.attackOrder(s, sel); afterOrder(); }, "chip danger"));
        CMD.moveOptions(s, sel).forEach(function (o) {
          if (o.grille) box.appendChild(btn(inDuct ? "🏃 Flee out of the duct" : "🏃 Flee into the duct",
            function () { CMD.moveThroughGrille(s, sel); afterOrder(); }, "chip"));
          else box.appendChild(btn("🏃 Flee to " + D.roomNames[o.room] + ((o.byte & 64) ? " (duct)" : ""),
            function () { CMD.moveTo(s, sel, o.byte); afterOrder(); }, "chip"));
        });
      }
    }
    var a2 = game.state.actors[sel];
    $("encPend").textContent = a2.t > 0 ? orderText(a2) + " (" + a2.t + ")" : "";
  }

  // ---- action-chip <-> map hover linkage --------------------------------
  // Hovering a Move-to chip highlights its room on the map; if the room is on
  // another deck, the view peeks at that deck and reverts on mouse-leave.
  function setChipHover(room) {
    hoverRoom = room; hoverSource = "chip";
    if (sel >= 1 && (game.state.actors[sel].room & 64)) return; // duct view pins its own deck
    var d = D.roomTypeTable[room];
    if (d < 3 && d !== game.state.deck && peekDeck < 0) { peekDeck = game.state.deck; game.state.deck = d; }
  }
  function clearChipHover() {
    if (peekDeck >= 0) { game.state.deck = peekDeck; peekDeck = -1; }
    if (hoverSource === "chip") { hoverRoom = -1; hoverSource = null; }
  }
  // The reverse: hovering a reachable room on the map rings its chip.
  function syncChipHl(room) {
    var cur = els.actions.querySelector(".chip.hl");
    if (cur && +cur.dataset.room !== room) cur.classList.remove("hl");
    if (room >= 0) {
      var next = els.actions.querySelector('.chip[data-room="' + room + '"]');
      if (next) next.classList.add("hl");
    }
  }

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

  // message id -> log-line severity class
  var LOG_SEV = {};
  [1, 8, 9, 10, 13, 16, 18, 21, 25, 26, 28, 29, 33].forEach(function (id) { LOG_SEV[id] = "bad"; });
  [5, 6, 7, 19, 20, 22, 23, 24, 27, 34].forEach(function (id) { LOG_SEV[id] = "warn"; });
  [2, 3, 4, 12, 14, 15, 17, 31, 32].forEach(function (id) { LOG_SEV[id] = "good"; });

  function appendNewLog() {
    var s = game.state, log = s.log;
    // resume after the last entry we appended — by identity, because the log
    // array is a 200-entry ring (shift() breaks index-based tracking)
    var start = logLastEntry ? log.lastIndexOf(logLastEntry) + 1 : 0;
    if (start >= log.length) return;
    // keep autoscroll only when the user is already at the bottom; otherwise
    // offer the "new messages" jump instead of yanking their scroll position
    var atBottom = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 26;
    for (var i = start; i < log.length; i++) {
      var entry = log[i];
      if (logLast.el && entry.text === logLast.text) {   // collapse repeats into "×n"
        logLast.n++;
        if (!logLast.badge) { logLast.badge = el("span", "logN"); logLast.el.appendChild(logLast.badge); }
        logLast.badge.textContent = "×" + logLast.n;
      } else {
        var line = el("div", "logline" + (LOG_SEV[entry.id] ? " " + LOG_SEV[entry.id] : ""));
        line.appendChild(el("span", "logT", "T+" + (entry.frame / 50 | 0) + "s"));
        line.appendChild(el("span", null, entry.text));
        els.log.appendChild(line);
        logLast = { text: entry.text, el: line, badge: null, n: 1 };
      }
      if (ALARM_IDS[entry.id]) audio.beep(196, 0.2, 0.06, "sawtooth"); // low warning tone
    }
    logLastEntry = log[log.length - 1];
    if (atBottom) { els.log.scrollTop = els.log.scrollHeight; els.logJump.hidden = true; }
    else els.logJump.hidden = false;
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
    hoverSource = hoverRoom >= 0 ? "map" : null;
    syncChipHl(sel >= 1 && reachable[hoverRoom] ? hoverRoom : -1);
    els.map.style.cursor = (sel >= 1 && reachable[hoverRoom]) ? "pointer" : "default";
    moveMapTip(ev, r);
  }
  // Room-name tooltip beside the cursor. DOM-based (not canvas-drawn) so it
  // stays live while the game is paused and the rAF loop isn't redrawing.
  function moveMapTip(ev, r) {
    var tip = els.mapTip;
    if (hoverRoom < 0) { tip.hidden = true; return; }
    tip.textContent = D.roomNames[hoverRoom];
    tip.hidden = false;
    var x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
    x = Math.min(x, r.width - tip.offsetWidth - 4);
    y = Math.min(y, r.height - tip.offsetHeight - 4);
    tip.style.left = Math.max(2, x) + "px";
    tip.style.top = Math.max(2, y) + "px";
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
    if (!$("tutorial").hidden) {
      if (ev.key === "Escape" || ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); closeTutorial(); }
      return;
    }
    if (!game) return;
    if (ev.key === " ") { ev.preventDefault(); togglePause(); }
    else if (ev.key >= "1" && ev.key <= "7") { var k = +ev.key; if (game.state.actors[k].status === 0) selectCrew(k); }
    else if (ev.key === "Escape") { encDismissed = true; els.enc.hidden = true; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : this);
