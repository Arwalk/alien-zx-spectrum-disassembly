@ 16384 start
@ 16384 org
; Screen pixel data (ZX Spectrum display file, loaded at startup)
b 16384
; Screen attribute file (loaded as part of initial display)
b 23296
; BASIC loader + system variable area
b 23756
; -----------------------------------------------------------------------
; Game code block loaded at 0x6000 (24576)
; First ~7kb is sprite/tile pixel data, then crew/corridor data tables,
; then game state variables, then the Z80 machine code routines
; -----------------------------------------------------------------------
; Sprite pixel data: 8x8 pixel tiles and character bitmaps
b 24576
; Room indicator cursor, phase 0 — wide outer box with inner rectangle
@ 26637 label=RoomCursor0
b 26637
; Room indicator cursor, phase 1 — narrow border with oval interior
@ 26673 label=RoomCursor1
b 26673
; Room indicator cursor, phase 2 — centre-only bars with inner ring
@ 26709 label=RoomCursor2
b 26709
; Room indicator cursor, phase 3 — smallest oval shape
@ 26745 label=RoomCursor3
b 26745
; Crew walking sprite, phase 1 — upright pose (AnimateCrewA phases 0-1)
@ 26781 label=CrewWalkA1
b 26781
; Crew walking sprite, phase 2 — mid-stride pose (AnimateCrewA phases 2-3)
@ 26817 label=CrewWalkA2
b 26817
; Sprite sequence table: 0xFF-terminated lists of sprite indices
b 29516
; Crew data records (8 bytes each, 7 crew members max)
b 29566
; Per-corridor crew-presence lookup table (7 slots, 8 bytes each)
b 29573
; Alien sprite data embedded in tables
b 29619
; Corridor position table (19 entries, one per corridor segment)
b 29630
; Sprite address lookup and animation tables
b 30009
; Sprite position template tables
b 30197
; Alien/creature type data table
b 30492
; Direction/movement vector table (4 directions × 2 bytes)
b 30626
; Crew sprite animation frame A lookup (4 × 16-bit frame pointers)
w 26853
; Crew sprite animation frame B lookup (4 × 16-bit frame pointers)
w 26861
; Character tile bitmap array (8 bytes per 8×8 pixel tile, 169 tiles)
b 26869
; Sprite address lookup table (indexed by sprite ID)
b 26569
; Sprite pixel data at 0x6E3D (character bitmaps, 10 bytes each)
b 28221
; Game state RAM variables at 0x7A00
b 31232
; -----------------------------------------------------------------------
; Machine code routines start at 0x7A89
; -----------------------------------------------------------------------
@ 31369 label=DrawSpriteRow
c 31369
@ 31417 label=InitGameView
c 31417
@ 31577 label=FillAttributeBlock
c 31577
@ 31626 label=DrawNextCorridorTile
c 31626
@ 31634 label=DrawSprite
c 31634
@ 31562 label=DrawSpriteFromTable
c 31562
@ 31562 label=NextCorridorEntry
c 31562
@ 33589 label=AdvanceScriptPtr
c 33589
@ 33600 label=ResetScriptPtr
c 33600
@ 33610 label=DrawCrewStatusHalf
c 33610
@ 33740 label=DrawCorridorSegment
c 33740
@ 33862 label=GetCorridorTableEntry
c 33862
; Room dispatch table: 34 × 16-bit function pointers indexed by room mode
w 33794
; Data islands within code region (sprite data, lookup tables)
b 33792
; -----------------------------------------------------------------------
c 34684
c 34967
c 35016
c 35163
c 35210
c 35222
c 35290
c 35314
c 35338
c 35382
c 35448
c 35449
c 35451
c 35560
c 35578
c 35973
c 36457
c 36859
c 37018
c 37363
c 37490
c 38379
c 40319
c 40418
c 40439
c 40826
c 41264
c 42501
c 42515
c 42581
c 42821
; Game-mode selection dispatch table (3 × 16-bit pointers: Short/Long/Introduction)
@ 43135 label=GameModeDispatchTable
w 43135
; Game-mode menu text strings (0xFF-terminated: Short Game / Long Game / Introduction / Select / prompt)
@ 43141 label=GameModeText
b 43141
; XOR-toggles 15 attribute bytes to highlight the selected menu row
@ 43216 label=HighlightGameMode
c 43216
; Introduction game-mode handler (dispatched from GameModeDispatchTable)
@ 43242 label=IntroductionMode
c 43242
c 43610
c 44313
c 44561
c 44815
c 44880
c 45290
c 45401
; Extra data area loaded at 0xEA60
b 60000
; Tile bitmap data for intro screen tiles (8 bytes each)
b 61936
