# Alien (Nostromo) — web port

A faithful, standalone web port of the **Long Game** from *Alien (BUGFIX 1.7)*
(ZX Spectrum), rebuilt from the annotated disassembly in this repo and the
`PORT_REFERENCE_LongGame.md` specification.

- **Every mechanic** from the original is reproduced: crew orders, the alien AI,
  the traitor android, combat & weapons, items, grilles/ducts, fires, oxygen,
  self-destruct, airlocks, hypersleep, motion trackers, morale/courage, Jones the
  cat, all 34 status messages, and the five endings + Competence Rating.
- **Original graphics**, extracted byte-for-byte from the tape image: the three
  Nostromo deck maps, the seven crew portraits, the four-frame Alien animation,
  Jones, and the ZX font/tiles — rendered crisp (nearest-neighbour) on canvas.
- **Modern mouse + keyboard UI**: click a crew member, click a room on the map (or
  a move chip — hovering one highlights its room, peeking at the target's deck if
  needed) to give orders. Left column = situation (deck map + ship log with
  severity colours and timestamps), right column = controls (compact crew roster
  + a contextual action panel with the selected crew's hands and pending order).
  All of it replaces the original's 19-cell cursor strip.
- **Definitive rules**: the four documented original bugs (LaunchGate all-aboard
  drift, harpoon-vs-android inverted wipe, unreachable scare bonus) are **fixed**;
  the load-bearing 3-crew room cap is kept.

## Run it

No backend, no build step. Either:

- **Open `index.html`** directly in a browser (it works from `file://` — assets and
  code are plain `<script>` files, nothing is `fetch`ed), **or**
- serve the folder statically and browse to it:

  ```bash
  cd web && python3 -m http.server 8000   # then open http://localhost:8000
  ```

## How to play

The first time you press **Start the Long Game** a one-page tutorial ("NOSTROMO —
CREW MANUAL") opens, covering the base mechanics: selecting & moving crew, the
two-hand item system, fighting, tracking, air ducts, and the ship fixtures. It's
shown once per page load (reload to see it again); the HUD's **❓ Help** button
reopens it any time, pausing the game while it's up.

1. **Start the Long Game.** The chestburster host, the android, the alien's lair
   and Jones's start room are randomised (seeded from the clock), exactly as the
   original does from the ROM script stream.
2. **Click a crew member** (roster card, or press `1`–`7`) to select them. The map
   jumps to their deck and highlights the rooms they can reach.
3. **Give one order at a time** — the crew act on a timer, while the ship simulation
   (alien, fires, oxygen, morale, the android) runs underneath:
   - **Move**: click a highlighted room on the map, or a "Move to" button. A
     "Grille" option appears once a room's grille is removed (enter/leave the ducts).
   - **Use**: swap hands, Get an item off the floor, Leave an item.
   - **Special**: **ATTACK** (when the alien or hostile android shares the room),
     Remove Grille, or Get Jones (needs the Net or Cat Box in hand).
   - **Fixture**: arm/abort self-destruct (CommdCentr), blow/seal the airlocks
     (Corridor#6), enter hypersleep (Cryo Vault), fight a fire (burning engine),
     or **launch the Narcissus** (escape).
4. **Win** by killing the alien (15 wounds), or **escape** in the Narcissus — best
   done with the self-destruct armed. Watch the **oxygen** (it drains faster as crew
   die) and **room damage** (100 in any room loses the ship). The alien is hidden on
   the map — track it with a **Tracker** (an "all clear" is worth morale; motion
   makes it beep). `Space` pauses.

## Architecture

Four decoupled layers (per `PORT_REFERENCE` §18): a **state block** → a
**fixed-step update pipeline** (the original main loop measures ~13.5
iterations/s on hardware — the "Normal" speed; "Fast" runs the same steps at
25/s) → a **command layer** (one queued order per crew) → a **render layer**
that is a pure function of state. Plain vanilla JS, no framework.

```
web/
  index.html            ordered <script> includes + layout
  style.css             the "ship terminal" shell
  assets/graphics.js    GENERATED asset bundle (see tools/extract_assets.py)
  src/
    data.js       verbatim static tables (adjacency graphs, timers, items, messages)
    palette.js    ZX colour helpers
    rng.js        PRNG reproducing the weighted 5-way direction + probabilities
    messages.js   34-message table + name/room substitution
    state.js      the save-state struct + actor/room helpers
    init.js       LongGameInit -> CommonGameInit
    movement.js   ScriptNibbleToDirection, PickNextRoom, grille moves, helpers
    morale.js     RecalcMorale / MoraleFromCompanion / decay / death helpers
    jones.js      UpdateJones + the Get-Jones catch roll
    alienai.js    UpdateAlienAI (attack / rip grille / slip duct / wander)
    android.js    arm / activate / attack / anti-android combat (harpoon fixed)
    combat.js     CrewHitsAlien, harpoon primitive, scare check (bonus fixed), alien attack
    ship.js       damage, engine fires, oxygen, self-destruct, airlocks, hypersleep,
                  trackers, launch gate, per-frame UpdateRoomActors
    commands.js   player order layer (move/use/special/fixture) + UI helpers
    engine.js     turn engine (dispatch + PreActionCheck), main loop, endgame + rating
    assets.js     decode the 1bpp ZX bitmaps -> canvases (browser only)
    footprints.js derive each room's map footprint (cells + outline) from the
                  deck tile grid, so highlights hug the drawn compartments
    render.js     draw the deck map + overlays + encounter (browser only)
    ui.js         DOM shell, fixed-step loop, direct-manipulation interaction (browser only)
```

## Regenerating the assets

`web/assets/graphics.js` is generated from the gold-standard tape image:

```bash
.venv/bin/python tools/extract_assets.py          # rewrite graphics.js
.venv/bin/python tools/extract_assets.py --png    # + sanity PNGs (needs Pillow)
```

## Tests / verification

The engine logic tests need **no dependencies** (pure Node):

```bash
node web/test/parity.js     # 33 assertions: init, weighted dir, alien-dies-at-15,
                            # oxygen period, harpoon, launch gate, android, rating, stability
```

Optional headless checks (install the dev dep first):

```bash
npm install --no-save jsdom && node web/test/ui_smoke.js   # boots the real UI, clicks every action
```

`web/test/dump_state.js` + `web/test/composite.py` render an assembled deck-map PNG
(with live crew/damage/fire overlays) for eyeballing without a browser.
