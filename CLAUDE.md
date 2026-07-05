# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Annotated disassembly of **Alien (BUGFIX 1.7)**, a ZX Spectrum 48K strategy game. The goal is to fully reverse-engineer the game: corridor movement, crew AI, alien behaviour, sprite rendering, input handling, and screen management.

The original tape image (`ALIEN (BUGFIX 1.7).tap`) is read-only. All annotation work happens in `alien.skool`.

## Toolchain

Uses [skoolkit 10.0](https://github.com/skoolkid/skoolkit) in a local Python venv (`.venv/`).

```bash
# Verify no assembly errors (run this after every edit to alien.skool)
.venv/bin/skool2asm.py alien.skool > /dev/null

# Rebuild ASM output (hex addresses, uppercase mnemonics)
.venv/bin/skool2asm.py -H -u alien.skool > alien.asm

# Rebuild browsable HTML cross-linked disassembly
.venv/bin/skool2html.py -d html alien.skool

# Regenerate snapshot from tape (rarely needed)
.venv/bin/tap2sna.py alien.tap alien.z80
.venv/bin/snapmod.py -r pc=36457 alien.z80 alien.z80

# Extend execution trace (addresses accumulate into alien.map)
.venv/bin/trace.py -m 5000000 --map alien.map alien.z80

# Regenerate the block-type map after adding/splitting blocks
.venv/bin/skool2ctl.py -w b alien.skool > alien.ctl
```

If `.venv/bin/*.py` scripts are missing, reinstall with `uv pip install --python .venv/bin/python --force-reinstall skoolkit==10.0.0`.

The `html/` directory is gitignored.

## File Roles

| File | Role |
|------|------|
| `alien.skool` | **Main working document** — annotated disassembly with comments, labels, directives. Uses **decimal** addresses (e.g. `36457` = `$8E69`) |
| `alien.ctl` | Generated block-type map (code/data/text per block). Regenerate with `skool2ctl.py -w b alien.skool > alien.ctl` after adding/splitting blocks — do not edit directly |
| `alien.asm` | Generated plain assembly — do not edit directly |
| `alien.z80` | Z80 snapshot built from the tape by `tap2sna.py`, PC forced to game entry (`$8E69`) |
| `alien.map` | Execution trace: plain-text list of executed addresses, one `$XXXX` per line (accumulates across `trace.py --map` runs) |
| `alien_raw.bin` | **Gold standard**: the pristine 49152-byte tape load image (`$4000-$FFFF`), extracted via `tap2sna.py`. `skool2bin.py alien.skool` must reproduce it byte-for-byte |
| `tools_play_trace.py` | Scripted-input gameplay tracer: drives skoolkit's simulator with simulated keypresses through the menus into real gameplay, emitting an exec map (see `--help`) |

## Byte-identity invariant

`alien.skool` is a byte-perfect, address-faithful transcription of the tape.
After any edit that touches DEFB/DEFM/DEFW data or code bytes, verify:

```bash
.venv/bin/skool2bin.py alien.skool /tmp/check.bin && cmp /tmp/check.bin alien_raw.bin
```

The output must be exactly 49152 bytes (`start=16384, end=65536`) and identical
to `alien_raw.bin`. (A July 2026 audit found and fixed ~30 corrupted bytes, a
dropped 3-byte instruction and two misrepresented overlapping-instruction
tricks that had made the rebuilt image drift by 3 bytes.)

## skool File Format

Addresses in `alien.skool` are **decimal** (`36457`, not `$8E69`); hex appears only in comments. Lines follow this structure:
- `cADDR MNEMONIC operands` — code entry point
- `bADDR DEFB bytes` — data block
- `wADDR DEFW words` — word (16-bit) data block
- ` ADDR ...` — continuation line (leading space = same block)
- `; comment` — block comment
- `@ ADDR label=NAME` — attach a label to an address
- `@ ADDR ignoreua` — suppress "unused address" warnings

## Memory Map

| Address | Contents |
|---------|----------|
| `$4000–$57FF` | ZX Spectrum display file (pixel data) |
| `$5800–$5AFF` | Attribute file (ink/paper colours) |
| `$6000–$734B` | Sprite pixel data and tile bitmaps |
| `$6935` | Character/tile bitmap table (8 bytes/tile, indexed by char code) |
| `$6E3D` | String/sprite-strip table (10 chars per entry): entries 0–34 = room names, 35+ = item names, actions, UI words; also used as 10-tile sprite strips (51 = Jones) |
| `$71F3` | `RoomAdjCorridors` — 35 rooms × 5 direction slots, the ship's door/corridor connectivity map |
| `$72A2` | `RoomAdjDucts` — air-duct network over the same rooms (34 entries, no Narcissus) |
| `$734C` | `CrewNameTable`: ALIEN, Dallas, Kane, Ripley, Ash, Lambert, Parker, Brett ($FF-separated) |
| `$737E` | `ActorRecords` — 8 slots × 8 bytes; slot 0 = alien (its +1 byte $737F = alien's current room), slots 1–7 = crew (slot k ↔ name k). +1 = current room (bit 6 = in ducts), +2 = destination room, +4 = strength, +7 = status (0 alive, $FF removed) |
| `$73BE` | Corridor position table (19 entries) |
| `$7A00–$7AFF` | Game state RAM variables |
| `$7A89–$B1FF` | Z80 machine code routines |
| `$8E69` | **Game entry point** (`GameEntry`) |
| `$9E38` | Intro screen tile map (15 × 11 entries) |
| `$EA60–$F5FF` | Extra data area (tiles, tables) |
| `$F230` | Tile bitmap array (8 bytes/tile) |

## Game Architecture

### Main Loop (each frame, in order)

1. `HandleInput` `$8A0C` — key 6 = advance cursor, 7 = retreat, 5/8 = row moves, **0 = action** (on release, dispatches the current room's handler via `RoomDispatchTable` `$8402` — this opens room action menus)
2. `FrameTiming` `$9D7F` — ~1/50s wait or play queued sound
3. `UpdateAlien` `$9F5A` — alien/Android activation logic; the alien kills crew that enter its room (slot 0 byte +1) via `CrewHitsAlien` `$92D0` → kill primitive `$9365`
4. `UpdateCrewState` — advance per-crew action timers
5. `UpdateCrewAI` `$90D2` — assign script-sourced action to idle crew
6. `ProcessAnimQueue` — step corridor animations (×2 passes)
7. `UpdateJones` `$8FFB` — walk Jones the cat one room per ~5s (room in `$83AA`); draws the cat into corridor cell 14, enqueues msg #0 when seen, avoids the alien's room
8. `UpdateCorridors` — advance crew along corridor (×2 passes)
9. `AnimateCrewA` `$88B7` / `AnimateCrewB` `$88E8` — XOR-blit sprite frames
10. `PlayMusic` `$AF60` — beeper tone phrase
11. `DrawStatusPanel` `$AD09` — crew-alive portrait column

Key 1 opens `PauseMenu` `$AEF7`; pressing again restarts.

### Screen flow

Intro (any key) → ship map + game-mode menu (1 = Short Game, 2 = Long Game,
3 = Introduction; **4 = confirm** via `GameModeDispatchTable` `$A87F`) →
input-device menu (`OptionsScreen`: 1 Kempston / 2 AGF-Protek / 3 Sinclair /
4 Keyboard, **5 = SELECT**; choosing Keyboard offers Y = redefine keys) →
gameplay. The Long Game opens with the film's dinner scene (Dallas/Kane/Ripley
on the bridge, Ash/Lambert/Parker in the Mess, chestburster host picked by ROM
script); the Short Game is the final act (only Ripley, Lambert, Parker aboard).

### Movement model

Actors move room-to-room on two overlaid graphs: `RoomAdjCorridors` `$71F3`
(doors) and `RoomAdjDucts` `$72A2` (crawlways; record byte +1 bit 6 = in
ducts). `PickNextRoom` `$8F6D` chooses a destination by feeding a ROM-script
nibble through `ScriptNibbleToDirection` `$8F9B` into the actor's current
room's 5 direction slots (slot value = destination; own ID = no exit).

### ROM Script System (AI/randomness)

The alien and crew AI consumes a "script" of commands by walking ZX Spectrum ROM bytes. The low nibble of each byte is used as a command (0–15). The script pointer lives at `$7A21` and is seeded from ZX system variable `SEED` (`$5C78`) via `ResetScriptPtr` `$8370`. This provides deterministic but varied behaviour without any RNG code.

### Crew Data Record (8 bytes, base `$7386`, accessed via IX)

| Offset | Field |
|--------|-------|
| `IX+0` | Sprite index |
| `IX+1` | Crew ID (bits 0–5) + direction flag (bit 6) |
| `IX+2` | Current corridor position |
| `IX+3` | Action state (1=idle, 2=move, 3=wait, 5=investigate, 7=attack) |
| `IX+5` | Pixel X coordinate |
| `IX+6` | Pixel Y coordinate |
| `IX+7` | Alive flag (0 = dead) |

### Key Annotated Routines

| Label | Address | Description |
|-------|---------|-------------|
| `GameEntry` | `$8E69` | Entry: init stack, run screens, enter main loop |
| `ResetScriptPtr` | `$8370` | Seed ROM-traversal pointer from `SEED` |
| `AdvanceScriptPtr` | `$8365` | Step pointer, return low nibble (0–15) |
| `DrawSpriteRow` | `$7A71` | Blit one 8px-tall tile column onto display |
| `DrawSprite` | `$7BA2` | Blit full 10-column × 8-row sprite |
| `DrawIntroScreen` | `$A665` | Animated Alien title screen |
| `DrawShipMap` | `$A785` | Nostromo ship-map / room-selection screen |
| `OptionsScreen` | `$AA5A` | Input-device menu: 1–4 pick joystick/keyboard, 5 = start; Y = redefine keys |
| `PickNextRoom` | `$8F6D` | Choose an actor's next room from the adjacency maps |
| `UpdateJones` | `$8FFB` | Jones the cat's per-move wander/draw/message logic |
| `ClearDisplay` | `$A5E5` | Zero display file `$4000–$57FF` |
| `FillAttributes` | `$A5F3` | Flood-fill attribute file `$5800–$5AFF` |
| `ScreenTransition` | `$ADF1` | Animated top-to-bottom wipe to black |
