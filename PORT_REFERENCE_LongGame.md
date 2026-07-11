# Alien (ZX Spectrum) — Long Game Mechanics Reference for a Port

This document gathers everything the disassembly (`alien.skool`) tells us about how
**Alien (BUGFIX 1.7)** actually plays, written as a *functional specification* for a
re-implementation. It focuses on the **Long Game** variant but describes the Short
Game where the two differ. Rendering/beeper details are deliberately summarised — the
goal here is the **simulation model and rules**, which a port must reproduce; the
graphics can be redrawn freely.

Every rule below was read out of the annotated Z80 and, where noted, verified in the
skoolkit simulator. Addresses are given as `label $hex` (decimal in the skool) so any
claim can be traced back to source. Numbers are the exact constants the game uses.

> **Terminology.** "Slot" = one of the 8 actor records (slot 0 = the alien, slots 1–7
> = the seven named crew). "Room" = one of 35 locations (ids 0–34). "Cell"/"strip row"
> = one of the 19 rows of the right-hand menu/corridor strip that is the whole player
> interface. "Script"/"nibble" = the ROM-byte pseudo-random stream (see §6).

---

## 1. Concept and session flow

You command the crew of the *Nostromo*; a xenomorph is loose in the ship's rooms and
air-ducts. You cannot control the alien and you cannot directly puppet the crew in
real time — you **issue one queued order at a time** to a chosen crew member through a
menu, and the ship-simulation (alien, fires, oxygen, self-destruct, morale, the
traitor android) runs continuously underneath. You win by **killing the alien** or by
**escaping in the shuttle** (ideally with the ship set to self-destruct behind you),
and you are graded 0–100 (Competence Rating).

### Screen flow

```
Intro title  ──any key──▶  Game-mode menu  ──"4: Select"──▶  Input-device menu  ──"5: Select"──▶  Gameplay
(DrawIntroScreen)          (GameModeScreen)                  (OptionsScreen)                      (main loop)
                             1 Short Game                      1 Kempston
                             2 Long Game                       2 AGF/Protek
                             3 Introduction (legend page,      3 Sinclair
                               loops back to this menu)        4 Keyboard (Y = redefine keys)
```

- `GameModeScreen $A745` shows all seven crew portraits + a 3-line menu; key **4** is
  *confirm* (not a fourth mode). It dispatches through `GameModeDispatchTable $A87F`:
  0 → `ShortGameInit`, 1 → `LongGameInit`, 2 → `IntroductionMode` (a "MAPPING SYMBOLS"
  legend page that returns to this menu).
- `OptionsScreen $AA5A` picks the input device; key **5** starts. Choosing Keyboard
  offers **Y** to redefine keys. The chosen device patches the key-scanner call so the
  rest of the code is input-agnostic.
- After device selection: `ScreenTransition` (wipe), one companion-morale pass
  (`UpdateAllCrew`), `InitGameView` draws the initial **orders screen**, then the game
  enters the per-frame main loop (§5).

### The two variants at a glance

| | **Long Game** | **Short Game** |
|---|---|---|
| Fiction | The full film: dinner scene → hunt | The final act (escape) |
| Active crew | All 7 minus one chestburster host (= 6) | Ripley, Lambert, Parker only |
| Chestburster host | 1 random slot from {Dallas, Kane, Lambert} | none (4 slots pre-removed) |
| Android (traitor) | 1 random slot from {Dallas, Kane, Ash, Parker}, ≠ host | none (`AlienTargetID` = 9 ⇒ disabled) |
| Opening message | #33 "Alien has hatched from {host}" | none |
| Randomisation | ROM-script driven (host, android, alien lair, Jones) | deterministic except alien lair/Jones |

Everything else (world, items, combat, ship systems, scoring) is **identical** between
the two — they share `CommonGameInit` and the whole main loop. A port can implement one
engine and select the initial state per variant.

---

## 2. Core state model — the data a port must hold

All gameplay state lives in a small block of bytes. This is effectively the "save
state". Reproduce these structures faithfully; the graphics and text are derived from
them each frame.

### 2.1 Actor records — 8 slots × 8 bytes (`ActorRecords $737E`)

Slot k's name is entry k of the crew-name table: **0 = ALIEN, 1 = Dallas, 2 = Kane,
3 = Ripley, 4 = Ash, 5 = Lambert, 6 = Parker, 7 = Brett.**

| Byte | Field | Notes |
|---|---|---|
| +0 | **Action countdown** | Ticks down each frame; the queued action (byte +3) *fires on the 1→0 transition*. 0 = parked/idle. Set by `SetActionTimer` (§15). |
| +1 | **Current room** | bits 0–5 = room id 0–34; **bit 6 = "in the air-ducts"**. `$FF` = *HostMarker* (slot excluded from all normal processing — the chestburster host). |
| +2 | **Destination room** | Written by `PickNextRoom`/menu move; bit 6 carries the duct flag. |
| +3 | **Action state** | 1 = move/arrive, 2 = duct transit (through a grille), 3 = remove grille, 4 = ATTACK order, 5 = alien attack tick, 6 = hypersleep completion, 7 = android attack. 0 = none. |
| +4 | **Strength / hit points** | Condition-line bands: 0 Dead · 1 Collapsed · 2–3 Wounded · 4+ OK (`DrawCrewCondition $7E81` folds 3 into "Wounded"). Combat needs ≥ 2; the scare total counts fighters at ≥ 3. **Slot 0 (alien) uses +4 as a *wound counter that climbs*; the alien dies at 15** (`AlienKillThreshold`). |
| +5 | **Courage** | Base bravery; raised by a carried front-hand weapon, knocked down by grim events (a body found / a kill witnessed: `DecayCrewCourage` −1 crew-wide), ±1 for duct crawl/exit. Clamped ≥0, and ≤8 by the scare bonus. *(Slot 0 reuses +5 to remember the slot of a corpse it is dragging off-ship.)* |
| +6 | **Morale** | Display bands 0 Broken · 1 Shaken · 2 Uneasy · 3 Stable · 4 Confident (the byte itself can exceed 4; the display clamps). Recomputed from courage + companions (§14). Combat needs morale ≥ 2. |
| +7 | **Status** | 0 = alive · 1 = killed · 2 = dead-and-found (a discovered body; doubles as the defeated android's re-activation lockout) · `$FF` = removed from play (hypersleep, or the host). |

> **Note on +5/+6.** These bytes were once mis-read as "sprite X/Y" (the skool header
> has since been corrected); the *combat and morale code* unambiguously treats **+5 =
> courage, +6 = morale** (e.g. `MoraleFromCompanion` reads +5, writes +6;
> `SwapHeldItems`, `DecayCrewCourage`, the scare bonus all operate on +5/+6).

Injury and morale are shown to the player as text bands, keyed by +4 and +6
respectively (`CrewInjuryText $759E` / `CrewMoraleText $75BC`).

### 2.2 Item locations — 1 byte per item (`ItemLocations $74F4`, 22 items)

The **single source of truth for the item system**. Each of the 22 portable items
(ids 0–21) stores where it is:

- `0–34` (+ bit 6 for ducts) = **lying on the floor** of that room.
- `160 + slot` = **held in that actor's front hand**.
- `128 + slot` = **held in that actor's back hand**.
- `255` = **does not exist** (the two "Cat in …" items until Jones is caught).

Get/Leave/Swap and every weapon/hand operation just rewrite these bytes.

### 2.3 Per-room arrays (one byte per room unless noted)

| Array | Addr | Contents |
|---|---|---|
| `RoomDamageDigits` | `$7536` | **2 ASCII digits per room** ("00"…"99"), 35×2 bytes. The damage meter. |
| `RoomGrilleState` | `$757C` | 255 = grille in place, 0 = removed. Rooms 0–33 (Narcissus has none). |
| `RoomTypeTable` | `$74D1` | View/deck type: 0/1/2 = which of 3 deck maps this room is drawn on, 3 = Narcissus. (4 = alien-encounter is runtime-only.) |
| `ItemCourageBonus` | `$7520` | Courage/morale bonus while item is carried **front-hand** (see §3.4). |

### 2.4 Ship-wide flags & counters

| Name | Addr | Meaning |
|---|---|---|
| `ShipSystemFlags` | `$7A15` | bit0 = self-destruct armed; bit1/bit2 = Airlock #1/#2 blown open; bit3/4/5 = Engine #1/#2/#3 on fire. |
| `AlienTargetID` | `$83A7` | The android's slot (Long Game 1/2/4/6; Short Game 9 = "none"). |
| `AlienTargetPtr` | `$83A5` | Pointer to the android's actor record. |
| `AlienActiveFlag` | `$83A8` | 0 = android dormant, 255 = android turned hostile. |
| `JonesRoom` | `$83AA` | Jones's room (255 = caught/off-map). |
| `JonesMoveTimer` | `$83AB` | Frame countdown to Jones's next step. |
| `AlienKillThreshold` | `$83D1` | 15 (alien wounds needed to kill it). |
| `ItemCharges` | `$83D2` | 16 bytes: per-item ammo/charge (items 0–15; §3.4). |
| oxygen digits | `OxygenHi $95E6` | 4 ASCII digits, "7500" at start, counting down. |
| destruct time | `DestructMinutes $95DC` | `TIME:` + minutes `:` seconds ASCII, "5:00" when armed. |
| `ShipTickCounter` | `$95D2` | 100-frame ship-systems tick (fires/etc). |
| `EventPaceCounter`| `$95EA` | free-running; gates the tracker beep to every 8th pass. |
| `ScriptPointer` | `$7A21` | current position in the ROM pseudo-random stream (§6). |

### 2.5 Room-view / UI scratch (only needed while a room is on screen)

`CurrentRoom $7A0A` (the viewed room), `RoomModeByte $7A14` (which UI is up),
`HeldItemFront/Back $7A10/$7A11`, `RoomMateA/B $7A12/$7A13`, `CorridorPosTable $73BE`
(the 19-cell strip), `CorridorCursor $8393`, `CursorCellValue $8395`,
`NearestCrewC/A/B $839F-$83A1` (combat/morale scratch), `NearRoomList $839C` (tracker
"all-clear" rooms), `DrawSlotIndex $7A09` (viewed slot 1–7).

---

## 3. World data (static tables)

### 3.1 Rooms (ids 0–34)

```
 0 Airlock #1    7 Computer    14 Corridor#7   21 Infirmary    28 RecrtnArea
 1 Airlock #2    8 Corridor#1  15 Cryo Vault   22 Inf Stores   29 Stores #1
 2 Armoury       9 Corridor#2  16 Engineerng   23 Laboratory   30 Stores #2
 3 Cargopod#1   10 Corridor#3  17 Engine #1    24 Lab Stores   31 Stores #3
 4 Cargopod#2   11 Corridor#4  18 Engine #2    25 Life Suppt   32 ShuttleBay
 5 Cargopod#3   12 Corridor#5  19 Engine #3    26 Livng Qtrs   33 Shttlstore
 6 CommdCentr   13 Corridor#6  20 Eng Stores   27 Mess         34 Narcissus
```

`RoomTypeTable $74D1` assigns each room to a deck map for drawing (0/1/2), with 34 =
Narcissus (its own RLE screen). This matters for the port's map view only, not for the
simulation.

### 3.2 Movement graphs — two overlaid networks

Actors move room-to-room on **two graphs**, each stored as **5 direction slots per
room** (a slot holding the room's own id = "no exit that way"). The graphs are
symmetric (doors work both ways) apart from two intentional one-way duct links.

- `RoomAdjCorridors $71F3` — the door network, 35 rooms × 5 slots.
- `RoomAdjDucts $72A2` — the air-duct network, 34 rooms × 5 slots (**no Narcissus**).

An actor with **bit 6 set on its current-room byte** travels the duct graph; a
destination fetched from the duct graph keeps bit 6 set until a handler clears it.

The full adjacency data is in `alien.skool` at those two labels — a port should copy
both tables verbatim (they are hand-authored ship topology, not derivable). Example
rows:

```
Corridor#6 (13) doors  -> {Mess 27, Airlock#1 0, Computer 7, Stores#3 31, Airlock#2 1}
Corridor#1 (8)  doors  -> {CommdCentr 6, Infirmary 21, Corridor#2 9, Laboratory 23, Livng Qtrs 26}
Mess (27)       ducts  -> {Airlock#1 0, Corridor#6 13, Airlock#2 1, (self), (self)}
```

Direction choice is by the script stream via `ScriptNibbleToDirection` (§6/§7).

### 3.3 Fixtures per room

Certain rooms carry an interactive fixture, drawn into strip cells 15/16 of the room
view and actioned with the action key (`DrawRoomSpecials`, `FixtureAction $95FE`):

| Room | Fixture | Strip cell value | Action |
|---|---|---|---|
| CommdCentr (6) | Self-destruct lever | 70 off / 72 armed | arm/abort 5:00 countdown |
| Corridor#6 (13) | Airlock #1 & #2 doors | 53/54 closed, 55/56 blown | Blow (vent room 0/1) / Seal |
| Cryo Vault (15) | Hypersleep pod | 74 | Enter hypersleep (crew leaves play) |
| Engine #1/#2/#3 (17/18/19) | Fire (only if burning) | 76 | Fight fire (needs charged extinguisher) |
| Narcissus (34) | Launch console | 78 | Launch the shuttle (escape) |

Note the airlock doors are physically operated from **Corridor#6**, but blowing them
vents **Airlock #1 (room 0)** or **Airlock #2 (room 1)** respectively.

### 3.4 Items (ids 0–21)

| id | Name | Start room | Charges | Front-hand courage bonus |
|---|---|---|---|---|
| 0 | Electric Prod | Lab Stores (24) | — | +1 |
| 1 | Electric Prod | Infirmary (21) | — | +1 |
| 2 | Electric Prod | Eng Stores (20) | — | +1 |
| 3 | Incinerator | CommdCentr (6) | — | +2 |
| 4 | Incinerator | CommdCentr (6) | — | +2 |
| 5 | Incinerator | Engineerng (16) | — | +2 |
| 6 | Tracker | CommdCentr (6) | — | 0 |
| 7 | Tracker | Engineerng (16) | — | 0 |
| 8 | Fire Extinguisher | Mess (27) | 3 | +1 |
| 9 | Fire Extinguisher | Engine #1 (17) | 3 | +1 |
| 10 | Fire Extinguisher | Engine #2 (18) | 3 | +1 |
| 11 | Fire Extinguisher | Engine #3 (19) | 3 | +1 |
| 12 | Harpoon Gun | ShuttleBay (32) | 1 | +2 |
| 13 | Laser Pistol | Armoury (2) | 8 | +2 |
| 14 | Laser Pistol | Armoury (2) | 8 | +2 |
| 15 | Laser Pistol | Armoury (2) | 8 | +2 |
| 16 | Net | Lab Stores (24) | — | 0 |
| 17 | Cat Box | Laboratory (23) | — | 0 |
| 18 | Spanner | Stores #3 (31) | — | +1 |
| 19 | Spanner | Eng Stores (20) | — | +1 |
| 20 | Cat in Net | (created on catch) | — | +1 |
| 21 | Cat in Box | (created on catch) | — | +1 |

`ItemCharges` (`$83D2`) holds 16 entries; items 0–7 are 0 (prods/incinerators/trackers
have no "ammo"), items 8–15 = `3,3,3,3,1,8,8,8`. A carried front-hand item adds its
`ItemCourageBonus` to the holder's courage **and** morale (removed on Leave, adjusted
on Swap).

### 3.5 Crew starting strengths (Long Game, `LongGameCrewInit $A1E4`)

| Slot | Name | Room | Strength | Courage | Morale |
|---|---|---|---|---|---|
| 1 | Dallas | CommdCentr (6) | 6 | 4 | 4 |
| 2 | Kane | CommdCentr (6) | 5 | 4 | 4 |
| 3 | Ripley | CommdCentr (6) | 4 | 3 | 3 |
| 4 | Ash | Mess (27) | 5 | 4 | 4 |
| 5 | Lambert | Mess (27) | 6 | 4 | 4 |
| 6 | Parker | Mess (27) | 6 | 4 | 4 |
| 7 | Brett | (host's vacated seat) | 5 | 3 | 3 |

Dallas/Kane/Ripley open on the bridge, Ash/Lambert/Parker in the Mess — the film's
dinner scene. Brett is seated into whichever seat the chestburster host vacates so both
groups stay at three (see §4).

---

## 4. Long Game initialization (exact sequence)

`LongGameInit $A524` → falls into `CommonGameInit $A58C`.

1. **Empty the message queue**, clear the two message run-state bytes, reset the
   duplicate-message marker and **reseed the script pointer** from ZX `FRAMES`.
2. **Copy the 64-byte crew template** `LongGameCrewInit` into the 8 actor records.
3. **Pick the chestburster host**: pull a script nibble, index
   `LongGameHostSlotTable` (values restricted to **{1, 2, 5}** = Dallas/Kane/Lambert).
   - Read that slot's starting room, **write it into Brett's (slot 7) +1** so Brett
     takes the host's seat.
   - Stamp the host slot's +1 **and** +7 with `$FF` (the HostMarker → removed from
     play).
4. **Pick the android**: repeatedly pull a script nibble and index
   `LongGameTargetTable` (values **{1, 2, 4, 6}** = Dallas/Kane/Ash/Parker) **until it
   differs from the host slot**. Store as `AlienTargetID`; compute `AlienTargetPtr`.
5. **Enqueue message #33** "Alien has hatched from {host}".
6. `CommonGameInit`:
   - `AlienActiveFlag = 0` (android dormant); freeze all animation channels.
   - **Place items**: copy `InitialItemRooms` → `ItemLocations` (the start rooms in
     §3.4).
   - **Grilles**: set rooms 0–32 to 255 (in place); **room 13 (Corridor#6) starts
     removed**; room 33 (Shttlstore) is always open.
   - `ShipSystemFlags = 0`.
   - **Jones** starts in a random room 0–15 (one script nibble).
   - **Alien lair**: one nibble indexes `AlienInitTable`
     (`{3,4,5,9,10,11,13,14,18,19,20,20,22,24,25,30}`), then **OR 64** — the alien
     starts *in the ducts above* that room. Written to slot 0's +1.
   - **Item charges**: load `3,3,3,3,1,8,8,8` into the extinguisher/harpoon/laser
     charge slots.
   - **Damage meters** all "00"; **oxygen** " 7500"; **display deck** = 1.
7. Control returns; `GameEntry` then draws the orders screen and starts the main loop.

*(Short Game: `ShortGameInit $AEC2` clears the message queue, hard-wires
`AlienTargetID = 9`, copies `ShortGameCrewInit` (Dallas/Kane/Ash/Brett pre-stamped with
the HostMarker; Ripley/Lambert/Parker on the bridge, strengths 4/4/6), then jumps to
`CommonGameInit`.)*

---

## 5. The frame loop (turn structure)

`MainLoop $8E81` runs forever. One iteration = one game "frame", but it is **not**
a 50 Hz video frame: the loop is not interrupt-synced. An idle iteration contains
two ~36 ms `BusyWait` delays (steps 2 and 10) plus the real work — measured
~260,000 T-states ≈ **74 ms ≈ 13.5 iterations/s** (skoolkit simulator, median of
200 idle gameplay passes; a queued sound effect adds ~0.25 s to its iteration).
The **order matters** — copy it:

1. `HandleInput` — scan device, move cursor, and *on action-key release* dispatch the
   selected menu row (this is the only place the player affects the world).
2. `FrameTiming` — ~36 ms busy-wait, or play one queued sound effect.
3. `UpdateAndroid` — **android activation only** (see §10). Re-fires each time the
   android's countdown parks, until the defeat lockout.
4. `TriggerAlienEvent` — arm the android once the alien has taken ≥6 wounds (§10).
5. `UpdateAlienAI` — **the alien's brain**: decide its next queued action (§8).
6. `TickMessageQueue` — advance the status-line teletype.
7. `UpdateJones` — walk the cat one room when its timer expires (§9).
8. `ResetCrewTimers` — **walk all 8 actors, decrement +0, fire the action on 1→0**
   through `DispatchCrewAction` → `CrewActionDispatch` (this is the turn engine; §5.1).
9. `AnimateCrewA` / `AnimateCrewB` — draw the two blinking map markers (XOR blit).
10. `PlayMusic` — one beeper phrase if queued, else the second ~36 ms busy-wait.
11. `AnimateCrewA` / `AnimateCrewB` again (XOR erase — double-buffer).
12. `TickMessageQueue` again.
13. `UpdateRoomActors` — **the ship simulation**: destruct ticker, motion-tracker scan,
    oxygen clock, viewed-tracker beep, engine fires, and the encounter animation (§13).
14. `CheckCrewAlive` — if **no human crew is alive**, end the game (`Endgame_CrewLost`).
    The android's slot does **not** count as a survivor.
15. Poll key **1** → `PauseMenu` (press 1 again to restart).
16. Advance the script pointer one nibble; two consecutive 0-nibbles reseed it.

### 5.1 The crew-action turn engine

Every queued action is a `(state in +3, countdown in +0)` pair. `ResetCrewTimers`
decrements each actor's +0 and, when it reaches 0, calls `DispatchCrewAction`, which:

- first runs `PreActionCheck` (permission gate, below),
- then jumps through `CrewActionDispatch` by +3:

| +3 | Handler | Meaning |
|---|---|---|
| 1 | `CrewAction1_Arrive` | complete a move: current room := destination (door sound unless in ducts). Arriving in a *blown* airlock (0/1) dumps you into Corridor#6 (13) instead. |
| 2 | `CrewAction2_DuctTransit` | cross a grille: flip bit 6 of current room; costs −1 courage to enter the ducts, +1 to climb out. |
| 3 | `CrewAction3_RemoveGrille` | set `RoomGrilleState[room] = 0`; sound; rebuild view. |
| 4 | `CrewAction4_Handler` | ATTACK order: if standing in the alien's room → `CrewHitsAlien`; if in the android's room → `CrewHitsAndroid` (§11). |
| 5 | `CrewAction5_AlienAttack` | the alien's attack tick (§8/§11). |
| 6 | `CrewAction6_Handler` | hypersleep complete: remove sleeper, stack items in Cryo Vault (§13). |
| 7 | `CrewAction7_Handler` | the android's attack tick (§10). |

**`PreActionCheck` (permission gate)** — returns "cancel" or "proceed" before a queued
action fires:

- The **alien (slot 0)** is always allowed.
- The **android** silently refuses an ATTACK order — it is re-assigned a wander.
- A crew member at **morale 0 (Broken) panics**: in the ducts he rips the grille and
  climbs out; in a room he **drops everything he carries onto the floor** and flees to
  a random adjacent room.
- A pending **move is held back** (retried in ~32+ frames) if the destination duct cell
  is already occupied (**ducts are single-file**) or the destination room already holds
  **3 crew** (the room-occupancy cap).
- Entering the ducts also requires **morale ≥ 2**; a more shaken crew member panics
  instead.

The 3-crew room cap and single-file ducts are load-bearing: they prevent
`RecalcMorale` from spilling a third room-mate's slot into adjacent state (an otherwise
latent bug).

---

## 6. Randomness — the ROM-script system

The game has **no RNG code**. Instead it walks bytes of the ZX Spectrum ROM as a
pseudo-random stream:

- `ScriptPointer $7A21` is seeded from the ROM's 50 Hz frame counter `FRAMES $5C78`
  (`ResetScriptPtr`), so it depends on real time but is otherwise deterministic.
- `AdvanceScriptPtr` steps the pointer and returns the **low nibble (0–15)** of the
  byte as a "command".
- Two consecutive 0-nibbles in the main loop reseed the pointer from `FRAMES` again.

`ScriptNibbleToDirection` folds a nibble into a **weighted** 5-way direction:

| nibble | 0–2 | 3–5 | 6–8 | 9–11 | 12–15 |
|---|---|---|---|---|---|
| direction slot | 0 | 1 | 2 | 3 | 4 |

So direction 4 is slightly more likely (4/16) than 0–3 (3/16 each). All AI movement,
the host/android/lair/Jones picks, combat "who gets hit", the scare roll, the Jones
catch roll, etc. draw from this stream.

**Port guidance:** a port can replace this with any PRNG. The *only* observable
consequences are (a) the weighted direction distribution above and (b) any specific
probabilities quoted in later sections (e.g. "3 in 16", "14 in 16"). Preserve those
probabilities; the ROM-byte mechanism itself is an implementation detail.

---

## 7. Movement model

`PickNextRoom` chooses a destination for the actor at `IX`:

```
map   = (current_room has bit6) ? RoomAdjDucts : RoomAdjCorridors
base  = map + (current_room & 63) * 5
dir   = ScriptNibbleToDirection(next nibble)     // 0..4
dest  = base[dir]                                // a room id (or self = no exit)
if in ducts: dest |= 64
record.+2 = dest
```

`CrewAction1_Arrive` later copies +2 into +1 (with the airlock-vent redirect). A move
where `dest == current` is a no-op idle (the AI parks wanderers this way, and the alien
damages its room when it "goes nowhere" — see §8).

---

## 8. Alien AI (`UpdateAlienAI $909A`)

The alien acts autonomously; crew act only on player orders. When the alien's countdown
(+0) is parked, it picks a new action (after a duct-escape safety check that rescues it
from an out-of-bounds "over the Narcissus" spot):

1. **Crew share its spot?** → action state **5** (attack tick), timer **60**.
2. **Alone, grille still in place?** → **3-in-16** chance (a direction-0 roll) to
   **rip the grille out itself**: state **3**, timer **50**.
3. **Alone, grille already open?** → **6-in-16** chance (direction 0 or 1) to **slip
   through the grille** into/out of the ducts: state **2**, timer **50**.
4. **Otherwise wander** to an adjacent room: state **1**, timer **80**. If the roll
   leaves it where it stands, it **damages the current room by +1** instead (the alien
   trashes whatever it's lurking in).

The alien's attack tick (`CrewAction5_AlienAttack`) is covered in §11. Its wound counter
(+4) is what climbs toward the kill threshold of 15.

---

## 9. Jones the cat (`UpdateJones $8FFB`)

Jones wanders one room roughly every ~255 frames (`JonesMoveTimer`). `JonesRoom = 255`
means caught/off-map.

- Steps along the **corridor graph** via the same `ScriptNibbleToDirection` mechanism.
- If Jones **leaves the viewed room**, his strip cell (14) is cleared.
- After moving, if **any living crew member** occupies Jones's new room, enqueue
  **message #0** "{actor} sees Jones the cat".
- If Jones would step into the **alien's room**, the move is **re-rolled** — the cat
  refuses to share with the alien.
- If Jones **enters the viewed room**, his sprite is drawn into strip cell 14.

Jones is caught via the "Get Jones" menu row (§12) and becomes the "Cat in Net"/"Cat
in Box" item, which then acts as a motion detector (§13).

---

## 10. The Android (traitor) subsystem — Long Game only

One crew slot (`AlienTargetID`, chosen at init) is a **dormant android**. It behaves
like a normal crew member (you can even order it) until it activates, then it hunts the
crew.

- **Arming** (`TriggerAlienEvent`, each frame): once the **alien has taken ≥6 wounds**
  (slot 0 +4 ≥ 6) **and** `AlienTargetID < 8` **and** the android is still dormant
  (+7 == 0) → set `AlienActiveFlag = 255`.
- **Activation** (`UpdateAndroid`, each frame): fires whenever the android's
  countdown is parked (+0 == 0) and it is not defeated (+7 == 0) — first time on the
  frame after arming, then **once per parked cycle** until the defeat lockout:
  - stamp android +0 = 80 (holds this branch shut while the countdown runs),
  - gather up to two other crew in the android's room,
  - if one is alive → **message #30** "{android} is attacking {victim}", set android
    state **7**, timer **40**;
  - else wander (state 1, timer 60).
- **Attack tick** (`CrewAction7_Handler`, state 7): wound the first live room-mate:
  strength −1. Below 2 → collapse (`VictimItemDrop`, msg #21); at 2–3 → **message #29**
  "{android} is attacking {victim}"; 4+ silent.
- **Killing the android** (`CrewHitsAndroid`, from an ATTACK order in the android's
  room): parallels the anti-alien combat (§11) but with messages #31/#32. When its
  strength drops below 2 it **collapses**: +7 = 2 (permanent lockout) and
  `AlienActiveFlag` is cleared.

At the endgame the android is **named** ("{name} was the Android") and is **excluded**
from the crew-survivor check and the crew scoring term.

---

## 11. Combat

All combat is **room co-location + queued ATTACK order**. The dispatched weapon is the
attacker's **front-hand item id** (`ItemLocations` → `HeldItemFront`).

### 11.1 Crew attacks the alien (`CrewHitsAlien $92D0`)

Guards: attacker must be **in the alien's room**, **strength ≥ 2**, **morale ≥ 2**.
Then dispatch on the front-hand item:

| Front-hand item | Effect |
|---|---|
| 17 Cat Box, ≥20 (Cat items), 255 bare hands | **no-op** (useless) |
| 16 Net | alien +0 := 255 (disabled/netted); net destroyed; **msg #3** |
| 0–5 prods/incinerators, 18–19 spanners | **wound +1** (alien +4 counter +1) |
| 6–7 Tracker | tracker shatters (destroyed, **msg #5**) but **still wounds +1** |
| 8–11 Extinguisher | if charged: spend one, **no wound**, → scare check; else **msg #6** empty |
| 12 Harpoon Gun | **AlienKillPrimitive** (below): +5 to the alien's wound counter |
| 13–15 Laser Pistol | if charged: spend one, **+6 room damage**, **wound +2**; else **msg #7** exhausted |

After any wound, if the alien's wound counter reaches **15** → the alien dies →
`EndgameScreen` ("The Alien has been killed"). Otherwise → `AlienScareCheck`.

**AlienKillPrimitive (harpoon):** devastating to *both* sides. It gathers the attacker
+ up to two other crew in the alien's room; for **each**, destroys every item they hold
*and every item lying in the alien's room* (set to 255), and if still alive marks them
**killed** (+7 = 1, strength = 0). Then **+15 room damage**, alien wound counter **+5**
(→ likely death). Firing the harpoon kills the firer and every bystander.

### 11.2 The alien attacks crew (`CrewAction5_AlienAttack`)

Gather up to three crew on the alien's spot; **pick one by script roll**; drain **1
strength**:

- **< 2** → victim **collapses**: `VictimItemDrop` marks dead with witness-morale hit,
  drops all carried items on the floor, **msg #21** "{actor} has collapsed".
- **2–3** → **msg #10** "{actor} is being wounded".
- **4+** → **msg #1** "The ALIEN is attacking {actor}".

If the chosen victim is **already dead**, a **4-in-16** roll lets the alien **drag the
corpse off-ship** (its room → 255, slot remembered in the alien's +5), otherwise it
tries another gathered slot or moves on.

### 11.3 AlienScareCheck (will the alien flee?)

Runs after most successful crew attacks. Compute a **scare total**:

```
total = 0
for each of up to 3 crew in the room:
    if strength >= 3 AND action_state == 4 AND morale >= 4:  total += 1
total += (alien_wound_counter / 4)          // a hurt alien is easier to drive off
roll = next nibble (0..15)
if roll != 15 AND roll < total:
    alien flees to a random adjacent room (re-rolled until it actually leaves)
    each fighter present: +1 courage (cap 8) and +1 morale
```

*(A "serious weapon" bonus was intended but is **unreachable** — an original bug, §17.
The shipped compare shape hints the intended set was weapon ids 6–12; the web port
fixes the bonus with the semantic set **{3–5 incinerators, 12 harpoon, 13–15 lasers}**.)*

### 11.4 Crew attacks the android (`CrewHitsAndroid $9FED`)

Same guards and weapon dispatch as §11.1, but aimed at the android (messages #31/#32).
Differences: prods/spanners/tracker/laser **wound the android −1 strength** (it
collapses below 2 → +7 = 2, `AlienActiveFlag` cleared). The Net disables it. **The
harpoon path has an inverted item-wipe bug** (§17) and does **not** wound the android.
*(The web port's fix mirrors the alien-side primitive: gathered crew die, items they
hold or that lie in the room are wiped, +15 room damage, and the android takes −5
strength → collapse.)*

---

## 12. Player interaction (the command model)

The entire UI is the **19-cell right-hand strip** plus a cursor. Keys (after device
mapping): **6** = cursor forward, **7** = cursor back, **5/8** = row moves (multi-row
views), **0** = action (dispatched on *release*), **1** = pause/restart.

### 12.1 Orders screen (room mode 0)

Drawn by `InitGameView` from `OrdersMenuTemplate`. Rows:

- **1–7** = the seven crew names → selecting one **opens that crew member's room view**
  (mode 1). (Bounces back if the slot is removed, or if the alien is currently
  targeting that crew member — the encounter owns the screen.)
- **8** " Indicate " / **9** " Location " → opens the **room-location list** (modes
  2/3): a pageable list of all rooms; picking one shows its deck with a blinking
  indicator box. (Page 1 = rooms 0–16, page 2 = 17–33; Narcissus never listed.)
- **10–11** " Display "/" Level " header; **12–14** Upper/Middle/Lower Deck → redraw
  the map pane for that deck.

### 12.2 Room view (room mode 1) — the action menu

Opening a crew member points `IX` at their record and builds a menu from
`ActionMenuTemplate`:

- **cell 0** "move to:" header; **cell 1** "Grille" (only if this room's grille is
  removed → duct move); **cells 2–6** the room's door exits.
- **cell 7** " use:" header; **cell 8** front-hand item (no-op, but cancels a pending
  timed job); **cell 9** back-hand item (**Swap** hands); **cell 10** "Get Item";
  **cell 11** "Leave Item".
- **cell 12** "Special" header; **cell 13** the special action ("RmveGrille", or
  "ATTACK" when a hostile shares the room); **cell 14** "Get Jones" (only if Jones is
  here); **cells 15/16** the room fixture (§3.3).
- **cell 17** "QUIT".

Dispatch is via `RoomDispatchTable`: the action key first indexes by room mode, then
(modes 0/1) re-indexes by the cursor **row**. When a hostile (alien/android) is in the
viewed room, `PreDispatchHook` forces the Special row to "ATTACK".

### 12.3 Item actions

- **Move to** (rows 2–6): set destination room (duct move if in ducts), state 1, timer
  64 (+adjustments).
- **Swap** (row 9): exchange front/back hands; adjust courage & morale by
  `bonus[back] − bonus[front]`; flip the two `ItemLocations` markers by ±32.
- **Get Item** (row 10): opens a picker of the room's floor items (mode 4); picking one
  writes the front-hand marker `160+slot`, applies its courage bonus.
- **Leave Item** (row 11): drop the back-hand item, else the front-hand item (undoing
  its courage bonus); the item's `ItemLocations` becomes the current room.
- **Get Jones** (row 14): needs the **Net (16)** or **Cat Box (17)** in the front hand.
  Roll a nibble against `JonesCatchBySlot` = `[0,14,14,13,13,13,15,14]` (per slot);
  succeeds when **nibble ≥ threshold**, and the **Net lowers the threshold by 4** (much
  easier). Success destroys the tool, puts "Cat in Net/Box" (tool+4) in hand, sets
  `JonesRoom = 255`, +1 courage/morale, **msg #2**. Failure spooks Jones into moving
  immediately.

### 12.4 Grilles & ducts

- `RemoveGrille` (Special row, or the alien's own AI): queues state 3 for a
  crew-dependent duration (`GrilleTimeBySlot` = `[0,100,120,180,100,180,80,80]` frames),
  then clears `RoomGrilleState[room]`.
- Once removed, the room offers a **"Grille"** move-to row → `MoveThroughGrille`:
  destination = same room with **bit 6 flipped** (enters/leaves the duct network).

### 12.5 Fixture actions (`FixtureAction`, cells 15/16)

Dispatched on the strip cell value: 70/72 destruct arm/abort, 74 hypersleep, 76 fight
fire, 78 launch, 53/54 blow airlock, 55/56 seal airlock. Behaviour in §13.

---

## 13. Ship simulation systems

Driven by `UpdateRoomActors $95EB` each frame.

### 13.1 Damage model (`AddRoomDamage $952A`)

Each room has a 2-ASCII-digit meter ("00"…"99"). Damage is added in **half-steps** of
the tens digit (units cycle 0 → 5 → carry into tens). No meters exist in the ducts
(bit 6). Thresholds on the **tens digit**:

- **'3' (30 damage)** → room-specific alarm:
  - CommdCentr (6): **msg #22** "Partial loss of control systems"
  - Computer (7): **msg #23** "Computer Malfunction detected"
  - Life Suppt (25): **msg #24** "Environmental irregularities"
  - Narcissus (34): **msg #25** "Narcissus status RED"
  - Engine #1/#2/#3 (17/18/19): the room **catches fire** — set `ShipSystemFlags`
    bit 3/4/5, **msg #9** "WARNING:Fire in {room}".
- **'7' (70 damage)** → **msg #8** "Structural Damage in {room}".
- **past '9' (100 damage)** → the hull gives way → screen-flash → `DamageGameOver`
  ("The Nostromo has exploded").

### 13.2 Engine fires (`EngineStateScan`/`FireDamageTick`)

For each engine room on fire: the number of **extinguisher squirts needed** grows with
existing damage — **1** below 60, **2** at 60–79, **3** at 80+ (per-room progress in
`EngineFixCounts`). Enough squirts → fire out (clear the flag, **msg #15**). Not enough
→ the fire adds **+1 damage every 100-frame ship tick** (spreads/worsens).

### 13.3 Oxygen clock (`OxygenTick $9A6B`)

A countdown whose **period = 2 × the number of live actors** (fewer crew ⇒ faster
drain). Each expiry decrements the 4-digit ASCII counter (starts "7500"), borrow
rippling left. At exactly **"0500"** → **msg #26** "Oxygen status CRITICAL". When the
borrow eats past the digits → `Endgame_OxygenOut`.

### 13.4 Self-destruct (`DestructArm`/`DestructTicker`)

Armed from the CommdCentr lever: sets a **5:00** countdown and `ShipSystemFlags` bit 0
(**msg #13**; aborting = **msg #14**). One game-second = 20 frames; the border flashes
from the seconds digit. At **0:00** → BOOM (`DamageOverflowFlash` → `DamageGameOver`).
An armed destruct **changes the ending scoring** (§16) — it is how you "win clean" by
escaping while the ship self-destructs.

### 13.5 Airlocks (`BlowLock`/`SealLock`)

Operated from Corridor#6 (13). **Blowing** an airlock (cell 53/54) vents room 0 or 1:
**everyone in that room is killed** (marked dead, item markers cleared), **msg #16**.
Sweeps **all 8 slots including the alien** — if the alien was inside:

- if already wounded 3+ times → it **dies in space** → endgame;
- else roll a nibble: **≥2 (14-in-16)** → it dies; otherwise it **survives and crawls
  back via ShuttleBay (32)**, **msg #18**.

**Sealing** (cell 55/56) repressurises, clears the flag, **msg #17**. Crew who *arrive*
in a still-blown airlock are dumped into Corridor#6 instead (§5.1).

### 13.6 Hypersleep (`HypersleepStart`/`CrewAction6_Handler`)

At the Cryo Vault (15) a crew member can enter hypersleep: state 6, 255-frame countdown,
**msg #11**. On completion the sleeper **leaves play** (+7 = 255, room = 255) and
whatever he carried is **stacked in the Cryo Vault (15)**, **msg #12**. (A way to safely
bank a crew member and their gear.)

### 13.7 Narcissus launch (`LaunchGate $9D14`)

At the launch console (Narcissus, 34): *intended* rule — the launch is **countermanded**
(msg #28) unless **every living crew member is aboard the Narcissus**, and then **Jones
must be aboard too** (in room 34 on his own paws, or the caught "Cat in Net/Box" item
present/held) or **msg #27** "BioUnit Jones not present" fires. On success:
`LaunchSequence` (flash + engine noise) → **escape ending**.

> **Bug (verified):** the all-aboard walk drifts off the +7 status column after the
> first *living* crew member, so the launch really only requires **the first-listed
> living crew member (plus Jones)** to be aboard — later crew are skipped, and a later
> crew member standing in Airlock #1 (room 0) bogusly countermands. See §17.

### 13.8 Motion trackers (`FindTrackerHolders`/`ViewedTrackerCheck`)

The two Trackers (items 6/7) and the caught cat ("Cat in Net/Box", 20/21), while held
in a **front hand**, are motion detectors. For each, sweep the rooms adjacent to the
holder (corridor or duct graph):

- **nothing moving next door** → "all clear": the holder's room is written to
  `NearRoomList` — standing in an all-clear room is worth **+1 morale** (§14).
- **Jones / the alien / any live actor next door** → the entry becomes 255 → the
  **viewed** holder's tracker **beeps** (every 8th pass) or, if he carries the cat,
  **msg #19** "Jones is looking uneasy".

Quirks (tape-authentic, reproduced by the port): the own-room skip compares the
**unmasked** holder byte, so a tracker held **in the ducts** always reports motion
(the holder detects himself); entries are only written while their tracker is
front-held, so a dropped tracker's last reading **persists** — a stale "all clear"
room keeps paying its +1 morale; and a vented alien that crawls back aboard keeps
status 1, making it **invisible to trackers** (and absent from the oxygen
live-count).

---

## 14. Morale & courage

Two per-crew stats drive everything soft about the crew.

- **Courage (+5):** the base stat. Modified by:
  - a **carried front-hand weapon**: +`ItemCourageBonus` (removed on Leave, adjusted on
    Swap);
  - **duct crawling**: −1 to enter, +1 to climb out;
  - **decay**: grim events (finding a body, witnessing a kill) apply −1 courage to the
    whole crew (`DecayCrewCourage`), clamped ≥0;
  - **fleeing the alien** (§11.3): +1, capped at 8.

- **Morale (+6):** recomputed from courage + social context (`RecalcMorale` →
  `MoraleFromCompanion`) after any move:

  ```
  morale = courage
  for each companion (up to 2 in the same room/duct-side):
      if companion alive:            morale += companion.courage - 2   // brave friend reassures, coward unnerves
      elif companion just died (+7==1):
          "find the body": whole crew courage decays, msg #20, body.+7 := 2 (found once)
          morale -= 1
      else (already-found corpse):   morale -= 1
  if actor's room is an "all-clear" tracker room:  morale += 1
  clamp morale >= 0
  ```

Morale is displayed in 5 bands (Broken/Shaken/Uneasy/Stable/Confident; the value can
exceed 4 — the display clamps to "Confident") and **gates combat** (needs ≥ 2). Injury
is displayed by strength: Dead/Collapsed/Wounded for 0/1/2–3 — "OK" only from 4
(`DrawCrewCondition $7E81` folds 3 into "Wounded"). Witnessing a death applies a
morale hit to onlookers (`KillActorMoraleHit`).

The 3-crew room cap (§5.1) is what keeps `RecalcMorale` from processing a third
room-mate (which would overwrite adjacent state).

---

## 15. Action timers & key constants

Every queued crew action arms +0 with:

```
countdown = base + ActionTimeBySlot[slot] + ActionTimeByStrength[strength & 7]
```

| Table | Values (index) |
|---|---|
| `ActionTimeBySlot` | `[0, 7, 5, 0, 7, 3, 10, 5]` (slots 0–7: alien, Dallas, Kane, Ripley, Ash, Lambert, Parker, Brett) |
| `ActionTimeByStrength` | `[0, 0, 48, 16, 0, 0, 0, 0]` — **Wounded (2) +48, strength 3 +16**, else 0 |
| Move base | 64 |
| Grille base | `GrilleTimeBySlot = [0,100,120,180,100,180,80,80]` |
| Hypersleep base | 255 |
| Re-queue (blocked move) | 32 |
| Alien attack timer | 60 · alien wander 80 · alien grille/duct 50 |
| Android attack timer | 40 · android wander 60 |

Other headline constants:

| Constant | Value |
|---|---|
| Alien kill threshold (wounds) | **15** |
| Wound per prod/spanner/tracker hit | +1 |
| Wound per laser hit | +2 (and +6 room damage, uses 1 of 8 charges) |
| Wound per harpoon | +5 (and +15 room damage, kills firer+bystanders) |
| Android activation trigger | alien wounds ≥ **6** |
| Extinguisher charges | 3 · Harpoon 1 · Laser 8 |
| Fire squirts needed | 1 (<60 dmg) / 2 (60–79) / 3 (80+) |
| Damage tens thresholds | 30 alarms · 70 structural · 100 hull loss |
| Oxygen start / critical | 7500 / "0500" |
| Oxygen drain period | 2 × live actors (frames between ticks) |
| Self-destruct | 5:00, 20 frames/sec |
| Alien-survives-airlock roll | nibble ≥ 2 (14/16) survives, re-enters ShuttleBay |
| Room-occupancy cap | 3 crew; ducts single-file |

---

## 16. Endgame conditions & Competence Rating

`EndgameScreen $AC5D` has five entry points; each zeroes `RatingScore`, adds only the
terms that outcome earns, then prints the dead roster, the android reveal, and the
rating (clamped to 100), and restarts.

| Ending | Trigger | Text | Scoring terms |
|---|---|---|---|
| **Alien killed** | wound counter ≥ 15, or died in space/airlock | "The Alien has been killed" | crew + rooms + oxygen |
| **Escape** | Narcissus launched | "The Narcissus is launched" + (destruct armed → "Nostromo will explode in m:ss"; else "Alien … unleashed upon the Earth") | destruct armed: crew + oxygen · **not armed: 0 (alien survives)** |
| **Crew lost** | no human alive (`CheckCrewAlive`) | "Humanoid life levels minimal" | same destruct-armed split (crew+oxygen / 0) |
| **Oxygen out** | oxygen counter exhausted | "Life Support Systems exhausted" (marks all dead) | same destruct-armed split |
| **Ship destroyed** | any room hits 100 damage, or destruct expired | "The Nostromo has exploded" | oxygen only |

**Rating terms** (`ComputeRating`/`CountRoomDamage`/`OxygenScore`):

- **Crew:** `+= 2 × strength` for every **living human** crew member (android excluded).
- **Rooms:** `+= 1` for every room whose damage tens digit is **< '2'** (i.e. < 20
  damage), across all 34 rooms.
- **Oxygen:** `+= 2 × leading digit` of the oxygen counter ('7' at the start → up to
  14 for a quick finish).
- Final score **clamped to 100**.

So the ideal Long Game win: **kill the alien fast, with little room damage and lots of
oxygen left** (or escape with the destruct armed). Letting the alien survive scores 0.

The dead roster lists "{name} is dead" per fallen crew; the Long Game adds "{name} was
the Android".

---

## 17. Original-game bugs (replicate-or-fix decisions for the port)

These are all in the shipped BUGFIX 1.7 image; a faithful port should decide per-bug
whether to preserve or correct. All are simulator-verified where noted.

1. **LaunchGate crew-walk drift** (§13.7): the "all aboard" check reads later crew's
   *room* bytes as *status* bytes, so effectively **only the first living crew member +
   Jones** need be aboard, and a later crew member in Airlock #1 (room 0) bogusly
   countermands. — *Recommend: fix (intended rule = all living crew + Jones), but it's a
   design call; the bug makes escaping much easier.*
2. **Harpoon vs Android inverted wipe** (§11.4): the item-destroy loop's final compare
   is inverted vs the alien-side loop, so it **destroys every item on the ship EXCEPT
   floor items in the android's room**, and the **android takes no wound**. —
   *Recommend: fix to mirror the alien-side harpoon (kill bystanders + wound target).*
3. **AlienScareCheck weapon bonus unreachable** (§11.3): two mutually exclusive equality
   tests (`==6` and `==7`) both required, so the "armed with something serious"
   scare-bonus never applies. — *Recommend: fix (was meant to make well-armed crew
   scarier to the alien), or drop the dead code. The web port fixes it with the
   semantic set {3–5 incinerators, 12 harpoon, 13–15 lasers}; the shipped compare
   shape arguably pointed at a 6–12 range instead.*
4. **RecalcMorale third-room-mate spill**: `RecalcMorale` would write a third
   room-mate's slot past `RoomMateB` into adjacent state, but `PreActionCheck`'s 3-crew
   room cap and single-file ducts prevent the condition arising. — *Recommend: keep the
   cap (or bound the loop) rather than reproduce the latent overflow.*

Minor quirks worth noting: the oxygen label is stored on tape as "TOOH:" (sic); the
Narcissus attribute flash uses stride 29 (one cell of drift on the second row).

---

## 18. Porting recommendations & open questions

**Architecture.** Model the game as: (a) the state block of §2 (actor records, item
locations, per-room arrays, ship flags/counters), (b) a fixed per-frame update pipeline
(§5), (c) a command layer that queues one action per crew member (§12), and (d) a
rendering layer that is a *pure function of state* (redraw freely). The original's
tight coupling of drawing into the logic (e.g. handlers that rebuild the strip inline)
is an artefact of the 48K target — separate them.

**Determinism / RNG.** Replace the ROM-byte script with any PRNG, but **preserve the
probabilities** quoted here (weighted 5-way direction 3:3:3:3:4, "3-in-16" grille,
"6-in-16" duct, "14-in-16" airlock survival, per-slot Jones-catch thresholds, the scare
comparison). Seed from wall-clock time to match the original's FRAMES-seeded feel.

**Timing.** The original expresses every duration in "frames" = main-loop iterations,
but the loop is **not** 50 Hz: it free-runs at ~13.5 iterations/s idle (~74 ms each —
two ~36 ms busy-waits plus the work; simulator-measured), slower still while sound
effects play. Keep a fixed logic tick (decoupled from render) so the §15 timer
constants keep their ratios, and pace it at ~13.5 ticks/s for the authentic feel;
scale if you want a different base rate.

**Faithful vs. fixed.** Decide up front whether this is a *preservation* port (keep all
§17 bugs) or a *definitive* port (fix them). The LaunchGate and Harpoon-vs-Android bugs
materially change difficulty and should be a conscious choice.

**Data to copy verbatim** (hand-authored, not derivable): the two adjacency graphs
(`RoomAdjCorridors`, `RoomAdjDucts`), `RoomTypeTable`, the item start rooms/charges/
courage bonuses, the crew start template, `AlienInitTable`, `GrilleTimeBySlot`,
`ActionTimeBySlot`, `JonesCatchBySlot`, and the 34-message text table with its
substitution codes (254 = actor name, 253 = target name, 252 = room name).

**Open questions for the port phase:**

- The Introduction mode is a legend/how-to page — decide whether to reproduce it or
  replace with modern onboarding.
- Sound is beeper phrases + queued effects (door/grille/tracker); the port can
  re-author audio freely.
- Confirm the exact display bands for morale > 4 if a port's courage inflation can push
  morale past 4 (the original's text table has 5 entries 0–4; combat only cares about
  ≥2, so this is cosmetic).
- The intro "dinner scene" is purely narrative framing over the starting placement in
  §3.5/§4 — no special mechanics beyond the seating.

---

### Source map (for tracing any rule back to the disassembly)

| Subsystem | Key labels |
|---|---|
| Init | `LongGameInit $A524`, `ShortGameInit $AEC2`, `CommonGameInit $A58C`, templates `LongGameCrewInit $A1E4`/`ShortGameCrewInit $A224` |
| Main loop | `GameEntry $8E69`, `MainLoop $8E81`, `ResetCrewTimers $8C85`, `DispatchCrewAction $8CAE` |
| RNG | `ResetScriptPtr $8340`, `AdvanceScriptPtr $8335`, `ScriptNibbleToDirection $8F9B` |
| Movement/AI | `PickNextRoom $8F6D`, `UpdateAlienAI $909A`, `UpdateJones $8FFB` |
| Android | `TriggerAlienEvent $A130`, `UpdateAndroid $9F7A`, `CrewAction7_Handler $9F35`, `CrewHitsAndroid $9FED` |
| Combat | `CrewHitsAlien $92D0`, `AlienKillPrimitive $9365`, `AlienScareCheck $9468`, `CrewAction5_AlienAttack $9958` |
| UI | `HandleInput $877C`, `RoomDispatchTable $8402`, item handlers `SwapHeldItems $8A7B`…`GetJonesHandler $8C05` |
| Ship sim | `UpdateRoomActors $95EB`, `FixtureAction $95FE`, `AddRoomDamage $952A`, `OxygenTick $9A6B`, `BlowLock $96F5`, `LaunchGate $9D14` |
| Morale | `RecalcMorale $8D5B`, `MoraleFromCompanion $8DBB`, `DecayCrewCourage $8E4C` |
| Endgame | `EndgameScreen $AC5D`, `ComputeRating $AE6B`, `CheckCrewAlive $AD19`, `MessageTextTable $8464` |

*(Prepared from the annotated disassembly, 2026-07-08. Where the on-file block header
and the executing code disagreed — notably actor bytes +5/+6 — this document follows the
code.)*
