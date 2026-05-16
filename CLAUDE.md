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

# Re-run execution trace (5M instructions) and rebuild control file
.venv/bin/trace.py -m 5000000 --map alien.map alien.z80
.venv/bin/sna2ctl.py -m alien.map alien.z80 > alien.ctl
```

The `html/` directory is gitignored.

## File Roles

| File | Role |
|------|------|
| `alien.skool` | **Main working document** — annotated disassembly with comments, labels, directives |
| `alien.ctl` | Control file: classifies every address as code (`c`), data (`b`/`w`), or text |
| `alien.asm` | Generated plain assembly — do not edit directly |
| `alien.z80` | Z80 snapshot with PC at game entry (`$8E69`) |
| `alien.map` | Execution trace bitmap (which addresses were executed) |
| `alien_raw.bin` | Raw binary extracted from the tape |

## skool File Format

Lines in `alien.skool` follow this structure:
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

## Game Architecture

### Main Loop (each frame, in order)

1. `HandleInput` `$8A0C` — keyboard (keys 5/6/7/8/0), crew movement dispatch
2. `FrameTiming` `$9D7F` — ~1/50s wait or play queued sound
3. `UpdateAlien` `$9F5A` — alien movement and crew-attack logic
4. `UpdateCrewState` — advance per-crew action timers
5. `UpdateCrewAI` `$90D2` — assign script-sourced action to idle crew
6. `ProcessAnimQueue` — step corridor animations (×2 passes)
7. `UpdateRoomMode` — evaluate current room game state
8. `UpdateCorridors` — advance crew along corridor (×2 passes)
9. `AnimateCrewA` `$88B7` / `AnimateCrewB` `$88E8` — XOR-blit sprite frames
10. `PlayMusic` `$AF60` — beeper tone phrase
11. `DrawStatusPanel` `$AD09` — crew-alive portrait column

Key 1 opens `PauseMenu` `$AEF7`; pressing again restarts.

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
| `OptionsScreen` | `$AA72` | Difficulty selection (keys 1–4) |
| `ClearDisplay` | `$A5E5` | Zero display file `$4000–$57FF` |
| `FillAttributes` | `$A5F3` | Flood-fill attribute file `$5800–$5AFF` |
| `ScreenTransition` | `$ADF1` | Animated top-to-bottom wipe to black |
