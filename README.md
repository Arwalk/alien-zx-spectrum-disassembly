# Alien ZX Spectrum Disassembly

A fully annotated disassembly of **Alien** (BUGFIX 1.7), a strategy game for the ZX Spectrum 48K based on the 1979 film. The game puts the player in command of the Nostromo's crew as they attempt to deal with the xenomorph moving through the ship's rooms and air ducts — plus a faithful, standalone **web port of the Long Game** built from it.

## Project Goal

Reverse-engineer the complete game logic: room/duct movement, the alien's AI, the traitor android, combat and items, morale, the ship simulation (fires, oxygen, self-destruct, airlocks), sprite rendering, input handling, and screen management — with enough annotation to fully understand how the game works. That goal is reached: every routine and data block in `alien.skool` is annotated, the rebuilt image is byte-identical to the tape, and the rules are re-implemented and regression-tested in `web/`.

## Repository Contents

| File | Description |
|------|-------------|
| `ALIEN (BUGFIX 1.7).tap` | Original ZX Spectrum tape image (read-only) |
| `alien_raw.bin` | **Gold standard**: the pristine 49152-byte load image (`$4000–$FFFF`); `skool2bin.py alien.skool` must reproduce it byte-for-byte |
| `alien.z80` | Z80 snapshot with PC set to the game entry point (`$8E69`) |
| `alien.skool` | Annotated disassembly — the main working document (**decimal** addresses; hex only in comments) |
| `alien.ctl` | Generated block-type map — regenerate with `skool2ctl.py -w b`, do not edit |
| `alien.asm` | Generated plain assembly output (hex, uppercase mnemonics) |
| `alien.map` | Execution trace map (accumulates across `trace.py --map` runs) |
| `html/alien/` | Browsable cross-linked HTML disassembly (gitignored, rebuildable) |
| `PORT_REFERENCE_LongGame.md` | The complete Long-Game mechanics specification distilled from the disassembly |
| `web/` | Backend-free web port of the Long Game (vanilla JS + Canvas, original graphics) — see `web/README.md` |
| `tools/extract_assets.py` | Regenerates `web/assets/graphics.js` from `alien_raw.bin` |
| `tools_play_trace.py` | Scripted-input gameplay tracer (drives skoolkit's simulator through the menus into gameplay) |

## Tools

This project uses [skoolkit 10.0](https://github.com/skoolkid/skoolkit), installed in a local Python virtual environment.

```bash
# Install
uv venv
uv pip install skoolkit==10.0.0

# Verify no assembly errors (after every alien.skool edit)
.venv/bin/skool2asm.py alien.skool > /dev/null

# Byte-identity check (after any edit touching data or code bytes)
.venv/bin/skool2bin.py alien.skool /tmp/check.bin && cmp /tmp/check.bin alien_raw.bin

# Rebuild ASM / HTML outputs
.venv/bin/skool2asm.py -H -u alien.skool > alien.asm
.venv/bin/skool2html.py -d html alien.skool
open html/alien/index.html
```

## Game Architecture

### Memory Map

| Address | Contents |
|---------|----------|
| `$4000–$57FF` | ZX Spectrum display file (pixel data) |
| `$5800–$5AFF` | Attribute file (ink/paper colours) |
| `$6000–$734B` | Sprite pixel data and tile bitmaps |
| `$68F5` | `CharBitmaps` — character/tile bitmap table (8 bytes/tile) |
| `$6E3D` | String/sprite-strip table (10 chars per entry: room names, item names, UI words) |
| `$71F3` / `$72A2` | `RoomAdjCorridors` / `RoomAdjDucts` — the two 5-slot adjacency graphs |
| `$737E` | `ActorRecords` — 8 slots × 8 bytes (slot 0 = the alien, 1–7 = crew) |
| `$73BE` | `CorridorPosTable` — the 19-cell strip driving the whole original UI |
| `$74F4` | `ItemLocations` — one byte per portable item: THE item-system state |
| `$757C` | `RoomGrilleState` — per-room duct-grille byte (255 in place / 0 removed) |
| `$7A09–$7A88` | Game state RAM variables |
| `$7A89–$B1FF` | Z80 machine code routines (`DrawSpriteRow` `$7A89` is the first) |
| `$8E69` | **Game entry point** (`GameEntry`) |
| `$EA60–$F5FF` | Extra data area (tiles, tables) |

### Actor Record (8 bytes, base `$737E` + slot×8)

| Offset | Field |
|--------|-------|
| `IX+0` | Action countdown — fires the queued action on the 1→0 transition; 0 = parked |
| `IX+1` | Current room (bits 0–5) + in-ducts flag (bit 6); `$FF` = removed |
| `IX+2` | Destination room |
| `IX+3` | Action state (1 move, 2 duct transit, 3 remove grille, 4 ATTACK, 5 alien attack tick, 6 hypersleep, 7 android attack) |
| `IX+4` | Strength (0 Dead · 1 Collapsed · 2–3 Wounded · 4+ OK); slot 0 = the alien's wound counter (dies at 15) |
| `IX+5` | Courage (weapon bonuses raise it; grim events knock the whole crew's down) |
| `IX+6` | Morale = courage + companion support (display clamps to the 0–4 band) |
| `IX+7` | Status (0 alive · 1 dead · 2 dead-and-found · `$FF` removed/host) |

### ROM Script System

The AI is driven by a "script" that walks ZX Spectrum ROM bytes, using the low nibble of each byte as a game command (0–15). The script pointer lives at `$7A21` and is seeded from the ZX system variable `FRAMES` (`$5C78`, the 50 Hz frame counter) via `ResetScriptPtr` `$8340`. This gives time-dependent but RNG-free varied behaviour.

### Main Game Loop

One loop pass ≈ 74 ms (~13.5 passes/s — two ~36 ms busy-waits plus the work; all game timers count passes, not video frames). Each pass, in order: `HandleInput` → `FrameTiming` → `UpdateAlien` (android activation) → `TriggerAlienEvent` → `UpdateAlienAI` (the alien's brain) → `TickMessageQueue` → `UpdateJones` → `ResetCrewTimers` (the action-countdown walk) → `AnimateCrewA`/`B` → `PlayMusic` → the second `AnimateCrewA`/`B` + `TickMessageQueue` pass → `UpdateRoomActors` (destruct, trackers, oxygen, fires) → `CheckCrewAlive` → pause-key poll → one script nibble consumed. Key 1 opens `PauseMenu`; pressing 1 again restarts.

### Key Annotated Routines

| Label | Address | Description |
|-------|---------|-------------|
| `GameEntry` | `$8E69` | Entry point: init stack, run screens, enter main loop |
| `ResetScriptPtr` | `$8340` | Seed the ROM-traversal script pointer from `FRAMES` |
| `AdvanceScriptPtr` | `$8335` | Step pointer, return low nibble as command (0–15) |
| `InitGameView` | `$7AB9` | Set up the room view for the current room |
| `DrawSpriteRow` | `$7A89` | Blit one 8px-tall tile column onto the display |
| `DrawSprite` | `$7B92` | Blit a full 10-column × 8-row sprite |
| `HandleInput` | `$877C` | Key scanner and action-key dispatcher |
| `AnimateCrewA` | `$8897` | XOR-blit map marker A (the walking crew figure) |
| `AnimateCrewB` | `$88C8` | XOR-blit map marker B (the blinking box) |
| `PickNextRoom` | `$8F6D` | Choose an actor's next room from the adjacency maps |
| `UpdateAlienAI` | `$909A` | The alien's brain: attack / rip grille / slip ducts / wander |
| `CrewHitsAlien` | `$92D0` | The crew's weapon dispatch against the alien |
| `UpdateRoomActors` | `$95EB` | Per-frame ship simulation driver |
| `LaunchGate` | `$9D14` | The Narcissus launch check (see the §17 bug) |
| `FrameTiming` | `$9D7F` | Frame pacing and one-shot sound player |
| `UpdateAlien` | `$9F7A` | Android activation (per-cycle re-fire once armed) |
| `LongGameInit` | `$A524` | Long-Game setup: host, android, Brett's reseat |
| `ClearDisplay` | `$A605` | Zero the display file (`$4000–$57FF`) |
| `FillAttributes` | `$A613` | Flood-fill the attribute file (`$5800–$5AFF`) |
| `DrawIntroScreen` | `$A655` | Animated Alien title screen |
| `GameModeScreen` | `$A745` | Crew roster + game-mode menu |
| `OptionsScreen` | `$AA5A` | Input-device menu (1–4 pick, 5 = start) |
| `CheckCrewAlive` | `$AD19` | Per-frame crew-extinction gate |
| `ScreenTransition` | `$AE11` | Animated top-to-bottom wipe to black |
| `PauseMenu` | `$AF0F` | Pause overlay; key 1 restarts the game |
| `PlayMusic` | `$AF50` | Beeper music phrase / idle busy-wait |

The full mechanics — combat, morale, items, the ship systems, the endgame scoring, and the four verified original-game bugs — are written up in `PORT_REFERENCE_LongGame.md` and in the `alien.skool` block headers themselves.

## Iterative Annotation Workflow

The main working file is `alien.skool`. After editing:

```bash
# Verify no assembly errors
.venv/bin/skool2asm.py alien.skool > /dev/null

# Verify byte identity against the tape image
.venv/bin/skool2bin.py alien.skool /tmp/check.bin && cmp /tmp/check.bin alien_raw.bin

# Rebuild outputs
.venv/bin/skool2asm.py -H -u alien.skool > alien.asm
.venv/bin/skool2html.py -d html alien.skool

# Regenerate the block map after adding/splitting blocks
.venv/bin/skool2ctl.py -w b alien.skool > alien.ctl
```

To regenerate the snapshot from the tape, or extend the execution trace:

```bash
.venv/bin/tap2sna.py alien.tap alien.z80
.venv/bin/snapmod.py -r pc=36457 alien.z80 alien.z80
.venv/bin/trace.py -m 5000000 --map alien.map alien.z80
```

## The Web Port

`web/` contains a complete, dependency-free web port of the Long Game: original graphics extracted from the tape, the definitive rules (the three fixable original bugs corrected, every other tape quirk reproduced), and a headless engine parity suite (`node web/test/parity.js`). See `web/README.md`.
