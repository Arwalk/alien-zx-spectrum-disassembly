# Alien ZX Spectrum Disassembly

A fully annotated disassembly of **Alien** (BUGFIX 1.7), a strategy game for the ZX Spectrum 48K based on the 1979 film. The game puts the player in command of the Nostromo's crew as they attempt to deal with the xenomorph moving through the ship's corridors.

## Project Goal

Reverse-engineer the complete game logic: corridor movement, crew AI, alien behaviour, sprite rendering, input handling, and screen management — with enough annotation to fully understand how the game works.

## Repository Contents

| File | Description |
|------|-------------|
| `ALIEN (BUGFIX 1.7).tap` | Original ZX Spectrum tape image (read-only) |
| `alien.z80` | Z80 snapshot with PC set to the game entry point |
| `alien.ctl` | skoolkit control file: code/data classification for every address |
| `alien.skool` | Annotated disassembly — the main working document |
| `alien.asm` | Plain assembly output (hex, uppercase mnemonics) |
| `alien.map` | Execution trace map (5M-instruction trace via `trace.py`) |
| `html/alien/` | Browsable cross-linked HTML disassembly |

## Tools

This project uses [skoolkit 10.0](https://github.com/skoolkid/skoolkit), installed in a local Python virtual environment.

```bash
# Install
uv venv
uv pip install skoolkit

# Rebuild ASM output
.venv/bin/skool2asm.py -H -u alien.skool > alien.asm

# Rebuild HTML documentation
.venv/bin/skool2html.py -d html alien.skool

# Open the browsable disassembly
open html/alien/index.html
```

## Game Architecture

### Memory Map

| Address | Contents |
|---------|----------|
| `$4000–$57FF` | ZX Spectrum display file (pixel data) |
| `$5800–$5AFF` | Attribute file (ink/paper colours) |
| `$6000–$734B` | Sprite pixel data and tile bitmaps |
| `$6935` | Character bitmap table (8 bytes/tile) |
| `$6E3D` | Sprite character table (10 bytes/sprite) |
| `$7386` | Crew data records — 7 × 8 bytes |
| `$73BE` | Corridor position table (19 entries) |
| `$7A00–$7AFF` | Game state RAM variables |
| `$7A89–$B1FF` | Z80 machine code routines |
| `$8E69` | **Game entry point** (`GameEntry`) |
| `$9E38` | Intro screen tile map (15 × 11 entries) |
| `$EA60–$F5FF` | Extra data area (tiles, tables) |
| `$F230` | Tile bitmap array (8 bytes/tile) |

### Crew Data Record (8 bytes, base `$7386`)

| Offset | Field |
|--------|-------|
| `IX+0` | Sprite index |
| `IX+1` | Crew ID (bits 0–5) + direction flag (bit 6) |
| `IX+2` | Current corridor position |
| `IX+3` | Action state (1=idle, 2=move, 3=wait, 5=investigate, 7=attack) |
| `IX+5` | Pixel X coordinate |
| `IX+6` | Pixel Y coordinate |
| `IX+7` | Alive flag (0 = dead) |

### ROM Script System

The alien and crew AI is driven by a "script" that walks through ZX Spectrum ROM bytes, using the low nibble of each byte as a game command (0–15). The script pointer lives at `$7A21` and starts at `$1041` (seeded from the ZX system variable `SEED` at `$5C78`). This gives a deterministic but varied command sequence without requiring any random-number generation code.

### Main Game Loop

Each frame calls these subsystems in order:

1. `HandleInput` — read keys 5/6/7/8/0, dispatch crew movement
2. `FrameTiming` — one-frame timing wait (~1/50s) or play queued sound
3. `UpdateAlien` — move alien, attack reachable crew
4. `UpdateCrewState` — advance per-crew action timers
5. `UpdateCrewAI` — assign new action to the first idle crew member
6. `ProcessAnimQueue` — step pending corridor animations (×2 passes)
7. `UpdateRoomMode` — evaluate current room game state
8. `UpdateCorridors` — advance crew along corridor (×2 passes)
9. `AnimateCrewA` / `AnimateCrewB` — XOR-blit sprite frames (×2 each, double-buffer)
10. `PlayMusic` — output beeper tone phrase
11. `DrawStatusPanel` — refresh crew-alive portrait column

Key 1 during gameplay opens the `PauseMenu`; pressing key 1 again restarts the game.

### Key Annotated Routines

| Label | Address | Description |
|-------|---------|-------------|
| `GameEntry` | `$8E69` | Entry point: init stack, run screens, enter main loop |
| `ResetScriptPtr` | `$8370` | Seed the ROM-traversal script pointer from `SEED` |
| `AdvanceScriptPtr` | `$8365` | Step pointer, return low nibble as command (0–15) |
| `InitGameView` | `$7AA9` | Set up corridor view for the current room |
| `DrawSpriteRow` | `$7A71` | Blit one 8px-tall tile column onto the display |
| `DrawSprite` | `$7BA2` | Blit a full 10-column × 8-row sprite |
| `HandleInput` | `$8A0C` | Keyboard scanner and crew movement dispatcher |
| `AnimateCrewA` | `$88B7` | XOR-blit crew sprite set A (10-frame rate) |
| `AnimateCrewB` | `$88E8` | XOR-blit crew sprite set B (5-frame rate, faster) |
| `RoomHandlerCommon` | `$8963` | Standard corridor room handler (rooms 6–12) |
| `UpdateCrewAI` | `$90D2` | Assign script-sourced action to idle crew member |
| `FrameTiming` | `$9D7F` | Frame-rate limiter and one-shot sound player |
| `UpdateAlien` | `$9F5A` | Alien movement and crew-attack logic |
| `ClearDisplay` | `$A5E5` | Zero the display file (`$4000–$57FF`) |
| `FillAttributes` | `$A5F3` | Flood-fill the attribute file (`$5800–$5AFF`) |
| `DrawIntroScreen` | `$A665` | Animated Alien title screen |
| `DrawShipMap` | `$A785` | Nostromo ship-map / room-selection screen |
| `OptionsScreen` | `$AA72` | Difficulty selection (keys 1–4) |
| `DrawStatusPanel` | `$AD09` | Crew-alive portrait status panel |
| `ScreenTransition` | `$ADF1` | Animated top-to-bottom wipe to black |
| `PauseMenu` | `$AEF7` | Pause overlay; key 1 restarts game |
| `PlayMusic` | `$AF60` | Descending-arpeggio beeper music phrase |

## Iterative Annotation Workflow

The main working file is `alien.skool`. After editing:

```bash
# Verify no assembly errors
.venv/bin/skool2asm.py alien.skool > /dev/null

# Rebuild outputs
.venv/bin/skool2asm.py -H -u alien.skool > alien.asm
.venv/bin/skool2html.py -d html alien.skool
```

To regenerate the snapshot from the tape:

```bash
.venv/bin/tap2sna.py alien.tap alien.z80
.venv/bin/snapmod.py -r pc=36457 alien.z80 alien.z80
```

To re-run the execution trace:

```bash
.venv/bin/trace.py -m 5000000 --map alien.map alien.z80
.venv/bin/sna2ctl.py -m alien.map alien.z80 > alien.ctl
```
