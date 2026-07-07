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
| `$737E` | `ActorRecords` — 8 slots × 8 bytes; slot 0 = alien (its +1 byte $737F = alien's current room), slots 1–7 = crew (slot k ↔ name k). +1 = current room (bit 6 = in ducts), +2 = destination room, +4 = strength (injury 0–3+: Dead/Collapsed/Wounded/OK), +6 = morale (0–4: Broken…Confident), +7 = status (0 alive, $FF removed) |
| `$73BE` | `CorridorPosTable` — the 19-cell strip that is both the corridor row and the action-menu rows; cell value under the cursor is mirrored to `CursorCellValue` `$8395` and is what the action key dispatches on. In the Indicate Location list (modes 2/3) it holds room ids 0–16/17–33 framed by 62 "Other List" and 61 "QUIT" |
| `$74D1` | `RoomTypeTable` — per-room view type: 0–2 = the room's deck (`DrawRoomBackground` `$7A23` draws that deck of `ShipMapData` as the view background, and the room template comes from `$6474`/`$64EB`/`$658C`), 3 = Narcissus (`NarcissusBackground` `$836C` expands the RLE layout at `$7800` with attrs at `$788D`), 4 = alien-encounter screen (runtime-only) |
| `$74F4` | `ItemLocations` — one byte per portable item (ids 0–21): room where it lies (bit 6 = in ducts), or 160+slot / 128+slot = held in that actor's front/back hand, 255 = nonexistent. THE item-system state |
| `$750A` | `RoomItemList` — item ids lying in the viewed room (built by `BuildRoomItemList` `$7C34`) |
| `$7520` | `ItemCourageBonus` — per-item courage/morale bonus applied while carried in the front hand (weapons embolden the crew: prods/extinguishers/spanners +1, incinerators/harpoon/lasers +2) |
| `$7536` | `RoomDamageDigits` — per-room 2-digit ASCII damage meters |
| `$757C` | `RoomGrilleState` — per-room duct-grille byte (255 = in place, 0 = removed; room 13 starts removed, room 33's byte is always 0) |
| `$759E` | `CrewInjuryText`/`CrewMoraleText` — "NAME is Dead and Broken" strings |
| `$75E2` | `ActionMenuTemplate` — 19-byte menu skeleton (cell 0 "move to:", 7 " use:", 12 "Special", 17 "QUIT") copied to `CorridorPosTable` by `ResetActionMenu` `$7FAC` |
| `$7A09–$7AFF` | Game state RAM variables (`$7A00–$7A08` is the tail of the Narcissus attribute map at `$788D`) |
| `$7A89–$B1FF` | Z80 machine code routines |
| `$8E69` | **Game entry point** (`GameEntry`) |
| `$9E38` | Intro screen tile map (15 × 11 entries) |
| `$EA60–$F5FF` | Extra data area (tiles, tables) |
| `$F230` | Tile bitmap array (8 bytes/tile) |

## Game Architecture

### Main Loop (each frame, in order)

1. `HandleInput` `$877C` — key 6 = advance cursor, 7 = retreat, 5/8 = row moves, **0 = action** (on release, dispatches `RoomDispatchTable[$8402]` by room mode `$7A14`; modes 0/1 re-dispatch on the cursor ROW through overlapping halves of the same table — full row map at the `RoomDispatchTable` header). Before the row dispatch, `PreDispatchHook` `$B2B9` forces the special row to "ATTACK" (52) when the alien/Android is in the viewed room; 238 in `CursorCellValue` marks a press that landed on "RmveGrille" during that same swap, so the grille job still starts (see the `$B2B9` header). The chosen input device patches the scanner CALL operand at `$874D` from the vector table at `$A405` (Kempston/AGF/Sinclair/Keyboard)
2. `FrameTiming` `$9D7F` — ~1/50s wait or play queued sound
3. `UpdateAlien` `$9F5A` — Android activation only: once `TriggerAlienEvent` `$A130` has set `AlienActiveFlag` (the alien has taken 6+ wounds while the Android is dormant), the Android turns hostile (state 7, wounds room-mates via `CrewAction7_Handler`). The alien's own attack is `CrewAction5_AlienAttack` `$9958` (drains a strength point per tick; may drag a corpse off-ship into its +5 byte); the crew's counter-attack is `CrewHitsAlien` `$92D0` (weapon dispatch on the attacker's front-hand item: Net = single-use disable, Harpoon Gun fires the kill primitive `$9365` killing attacker+bystanders with +15 room damage, prods/spanners/incinerators wound +1, trackers shatter but still wound, extinguishers only scare (`AlienScareCheck` `$9468`), lasers wound +2 and scorch the room +6). Attacks require attacker strength ≥ 2 AND morale ≥ 2, and land on whatever hostile shares the attacker's room
4. `UpdateCrewState` — advance per-crew action timers
5. `UpdateAlienAI` `$90D2` — the ALIEN's brain (crew act only on player orders): when its countdown is parked, attack room-mates (state 5), rip out the room's grille, slip through an open grille, or wander — damaging the room +1 when it stays put
6. `ProcessAnimQueue` — step corridor animations (×2 passes)
7. `UpdateJones` `$8FFB` — walk Jones the cat one room per ~5s (room in `$83AA`); draws the cat into corridor cell 14, enqueues msg #0 when seen, avoids the alien's room
8. `UpdateCorridors` — advance crew along corridor (×2 passes)
9. `AnimateCrewA` `$88A7` / `AnimateCrewB` `$88D8` — animate the two map markers: channel A = walking crew figure on the viewed room, channel B = blinking box on a candidate room (XOR-blit)
10. `PlayMusic` `$AF60` — beeper tone phrase
11. `CheckCrewAlive` `$AD19` — end the game (Endgame_CrewLost) if no human crew member is left alive; the Android's slot doesn't count

Key 1 opens `PauseMenu` `$AF0F`; pressing 1 again restarts.

### Screen flow

Intro (any key) → crew roster + game-mode menu (`GameModeScreen`: 1 = Short
Game, 2 = Long Game, 3 = Introduction; **4 = confirm** via
`GameModeDispatchTable` `$A87F`) →
input-device menu (`OptionsScreen`: 1 Kempston / 2 AGF-Protek / 3 Sinclair /
4 Keyboard, **5 = SELECT**; choosing Keyboard offers Y = redefine keys) →
gameplay. The Long Game opens with the film's dinner scene (Dallas/Kane/Ripley
on the bridge, Ash/Lambert/Parker in the Mess, chestburster host picked by ROM
script from {Dallas, Kane, Lambert}; Brett — initialised in room 0 — is
seated into the host's vacated place so both groups stay at three); the
Short Game is the final act (only Ripley, Lambert, Parker aboard).

Mode 3 "Introduction" (`IntroductionMode` `$A8EA`) is a MAPPING SYMBOLS
legend page: map-symbol key, the two animated map markers beside their
captions, and three captioned sound demos (door / grille / tracker).

The alien-encounter screen (view type 4) has two animation layers: the big
alien body (4 LDIR frames, 48×63 px, `BlitAlienFrame` `$9B54`) and the
"Jones" channel — the cat sprinting horizontally across char rows 9–11
(5-frame run cycle, XOR erase/advance/redraw 4 px per tick,
`BlitJonesFrame` `$9B98`; `JonesPos` `$9B46` is a pixel **X** offset).

### Ship simulation (driven by `UpdateRoomActors` `$95EB`; the fixture handlers follow it as their own routines from `FixtureAction` `$95FE`)

Corridor-strip cell values are the interaction vocabulary: 53/54 = closed
airlock doors (action = BlowLock: kills everyone in the room, may eject the
alien — it can die or re-enter via ShuttleBay; both doors are operated from
Corridor#6), 55/56 = blown doors (action = SealLock), 70/72 = destruct lever
off/armed (ASCII 5:00 countdown at `DestructMinutes`/`DestructSeconds`
`$95CC+`, BOOM at expiry), 74 = hypersleep pod (Cryo Vault; the sleeper
leaves play, his items stack in the room), 76 = fire (needs a charged
front-hand extinguisher; 1–3 squirts by damage severity), 78 = Narcissus
launch console (`LaunchGate` `$9D14`: intended rule = all living crew +
Jones aboard — see the verified-bugs list below).
Per-room damage meters are ASCII pairs at `RoomDamageDigits` `$7536`
(`AddRoomDamage` `$9532`, half-steps of the tens digit); tens digit '3'
raises alarms #22–#25 or sets an engine room on FIRE (`ShipSystemFlags`
bits 3–5), '7' = structural damage, past '9' = ship lost. The oxygen clock
at `$95DE` drains faster the fewer actors live (period = 2× live count);
borrow past its digits = Endgame_OxygenOut. Trackers (and the caught cat)
are motion detectors: `FindTrackerHolders` `$9707` sweeps rooms adjacent to
front-hand holders into `NearRoomList` `$8394` — "all clear" is worth +1
morale, motion makes the viewed holder's tracker beep (or Jones uneasy).
All 34 status-message triggers are documented at the `MessageTextTable`
header (`$8464`). The endgame Competence Rating = Σ 2×strength over live
human crew + 1 per room with damage < 20 + 2× the oxygen counter's leading
digit, capped at 100 — which terms an ending adds depends on the outcome
(`EndgameScreen` `$AC5D` header).

### Item system

22 portable items (ids 0–21 → names via `ItemIdToString` `$7C71`: 3 prods,
3 incinerators, 2 trackers, 4 extinguishers, harpoon gun, 3 laser pistols,
net, cat box, 2 spanners, plus "Cat in Net"/"Cat in Box" created when Jones
is caught). All state lives in `ItemLocations` `$74F4`. The room view's
" use:" menu rows are: 8 = front-hand item (no-op), 9 = back-hand item
(`SwapHeldItems` `$8A7B`), 10 = "Get Item" (`GetItemMenu` `$8B36` opens a
picker strip; room mode 4 → `GetItemPick` `$8AFA` writes the hand marker),
11 = "Leave Item" (`LeaveItemHandler` `$8B8D` writes the room number back).
Weapons act via `CrewHitsAlien`'s front-hand dispatch. Duct grilles:
`RoomGrilleState` `$757C`; "RmveGrille" queues crew action state 3
(`CrewAction3_RemoveGrille` `$8D36`), and a removed grille adds "Grille" as
a move-to row → `MoveThroughGrille` `$8AE8` (destination = same room,
bit 6 flipped).

### Original-game bugs (verified, documented in the skool headers)

- **LaunchGate `$9D14`**: the all-aboard walk drifts off the +7 status
  column after the first LIVE crew member (it steps +8 from the +1 room
  byte), so the launch really only requires the first-listed living crew
  member (plus Jones) to be aboard; a later crew member standing in
  Airlock #1 (room 0) bogusly countermands. Simulator-verified.
- **CrewHitsAndroid's harpoon path (`$A0AE` loop)**: the item-wipe's final
  compare is inverted vs the alien-side loop — it destroys every
  `ItemLocations` entry EXCEPT items lying loose in the room (everything
  held by anyone or lying anywhere else is wiped), and the Android itself
  takes no wound. Simulator-verified.
- **AlienScareCheck `$9468`**: the "armed with a serious weapon" scare
  bonus is unreachable (two mutually exclusive equality tests both
  required).
- `RecalcMorale` would spill a third room-mate's slot into `RoomModeByte`,
  but `PreActionCheck`'s 3-crew room-occupancy cap prevents it (ducts are
  single-occupancy for the same reason).

### Movement model

Actors move room-to-room on two overlaid graphs: `RoomAdjCorridors` `$71F3`
(doors) and `RoomAdjDucts` `$72A2` (crawlways; record byte +1 bit 6 = in
ducts). `PickNextRoom` `$8F6D` chooses a destination by feeding a ROM-script
nibble through `ScriptNibbleToDirection` `$8F9B` into the actor's current
room's 5 direction slots (slot value = destination; own ID = no exit).

### ROM Script System (AI/randomness)

The alien and crew AI consumes a "script" of commands by walking ZX Spectrum ROM bytes. The low nibble of each byte is used as a command (0–15). The script pointer lives at `$7A21` and is seeded from ZX system variable `SEED` (`$5C78`) via `ResetScriptPtr` `$8370`. This provides deterministic but varied behaviour without any RNG code.

### Actor record (8 bytes, base `$737E` + slot×8, accessed via IX)

Same records as `ActorRecords` above (`$7386` = slot 1); in the room view the per-frame code re-points IX at the selected slot (`$7A09`), so the menu dispatch handlers can use IX+n directly.

| Offset | Field |
|--------|-------|
| `IX+0` | Action countdown — fires the queued action via `DispatchCrewAction` on the 1→0 transition; 0 = parked (`SetActionTimer` `$8BE6` = base + per-slot + per-strength adjustments) |
| `IX+1` | Current room (bits 0–5) + in-ducts flag (bit 6); `$FF` = HostMarker |
| `IX+2` | Destination room |
| `IX+3` | Action state (1=move to `IX+2` / idle, 2=duct transit through the grille, 3=remove grille, 4=ATTACK order, 5=alien attack tick, 6=hypersleep completion, 7=Android attack) |
| `IX+4` | Strength/injury (0=Dead, 1=Collapsed, 2=Wounded, 3+=OK); slot 0 = the alien's wound counter (dies at `AlienKillThreshold` = 15) |
| `IX+5` | Base courage — raised by carried weapons (`ItemCourageBonus`), decays over time (`DecayCrewCourage` `$8E4C`); slot 0 = the slot of a corpse the alien has dragged off-ship |
| `IX+6` | Morale (0–4 index into `CrewMoraleText`) = courage + companion support, recomputed by `RecalcMorale` `$8D5B`; witnesses of a death lose morale (`KillActorMoraleHit` `$B211`) |
| `IX+7` | Status (0 = alive, 1 = dead, `$FF` = removed / chestburster host) |

### Key Annotated Routines

| Label | Address | Description |
|-------|---------|-------------|
| `GameEntry` | `$8E69` | Entry: init stack, run screens, enter main loop |
| `ResetScriptPtr` | `$8370` | Seed ROM-traversal pointer from `SEED` |
| `AdvanceScriptPtr` | `$8365` | Step pointer, return low nibble (0–15) |
| `DrawSpriteRow` | `$7A71` | Blit one 8px-tall tile column onto display |
| `DrawSprite` | `$7BA2` | Blit full 10-column × 8-row sprite |
| `DrawIntroScreen` | `$A665` | Animated Alien title screen |
| `GameModeScreen` | `$A785` | Crew-roster + game-mode menu screen (ex-"DrawShipMap" — no map is drawn) |
| `OptionsScreen` | `$AA5A` | Input-device menu: 1–4 pick joystick/keyboard, 5 = start; Y = redefine keys |
| `PickNextRoom` | `$8F6D` | Choose an actor's next room from the adjacency maps |
| `RedrawRoomScene` | `$7FCF` | Rebuild the full room view: menu strip, info panel, actors |
| `DrawDoorArm` | `$81C7` | Walk a wall path from the room anchor, painting an exit arm cyan (corner glyphs 128–131 steer it) |
| `FindHeldItems` | `$7C4F` | Load an actor's front/back-hand item ids from `ItemLocations` |
| `UpdateJones` | `$8FFB` | Jones the cat's per-move wander/draw/message logic |
| `ClearDisplay` | `$A5E5` | Zero display file `$4000–$57FF` |
| `FillAttributes` | `$A5F3` | Flood-fill attribute file `$5800–$5AFF` |
| `ScreenTransition` | `$ADF1` | Animated top-to-bottom wipe to black |
