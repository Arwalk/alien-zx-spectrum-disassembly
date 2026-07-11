#!/usr/bin/env python3
"""Extract the original Alien (ZX Spectrum) graphics from alien_raw.bin into a
self-contained JS asset file (web/assets/graphics.js) for the web port.

alien_raw.bin is the literal $4000-$FFFF RAM image, so file_offset = addr - 0x4000.
All game bitmaps are 1 bpp, MSB = leftmost pixel, 8 bytes = one 8x8 tile
(top->bottom). See PORT_REFERENCE Data Appendix B for the address map.

Run:  .venv/bin/python tools/extract_assets.py
Optionally dump sanity PNGs (needs Pillow):  ... --png
"""
import json
import os
import struct
import sys

BASE = 0x4000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "alien_raw.bin")
OUT = os.path.join(ROOT, "web", "assets", "graphics.js")

with open(BIN, "rb") as fh:
    MEM = fh.read()
assert len(MEM) == 49152, "alien_raw.bin must be 49152 bytes"


def at(addr):
    """file offset for a $4000-based address"""
    return addr - BASE


def rd(addr, n):
    o = at(addr)
    return list(MEM[o:o + n])


def rd_tiles(addr, count):
    """count consecutive 8-byte 1bpp tiles -> list of [8 ints]"""
    o = at(addr)
    return [list(MEM[o + i * 8: o + i * 8 + 8]) for i in range(count)]


def rle_expand(addr, cells=380):
    """Room/Narcissus RLE: <30 = that many zero cells, 30..254 = literal tile,
    255 = end. Expand to exactly `cells` bytes (zero-padded / truncated)."""
    o = at(addr)
    out = []
    i = 0
    while i < 4096:  # read the whole stream through to its 255 terminator
        b = MEM[o + i]
        i += 1
        if b == 255:
            break
        if b < 30:
            out.extend([0] * b)
        else:
            out.append(b)
    out = out[:cells]
    out.extend([0] * (cells - len(out)))
    return out, i  # i = bytes consumed, including the 255 terminator


def decode_screen_addr(addr):
    """ZX display-file address -> (char_row 0-23, col 0-31, pixel_row_in_cell)."""
    o = addr - BASE
    third = (o >> 11) & 0x03
    prow = (o >> 8) & 0x07
    row_in_third = (o >> 5) & 0x07
    col = o & 0x1F
    return third * 8 + row_in_third, col, prow


# ---- static logic bits we also want in JS for placement -------------------
ROOM_TYPE = rd(0x74D1, 35)  # 0/1/2 deck, 3 narcissus

assets = {}

# 1. Font / tile bitmaps (CharBitmaps @ 26869 = $68F5, 169 tiles).  ASCII-aligned.
assets["tiles"] = rd_tiles(26869, 169)

# 2. Crew portraits (7 x 72 bytes, 24x24 = 3x3 cells, reading order 8B/cell).
assets["portraits"] = [rd(30216 + i * 72, 72) for i in range(7)]

# 3. Three Nostromo deck maps (ShipMapData @ 24576): 20 wide x 19 tall tile ids.
assets["decks"] = [rd(24576 + d * 380, 380) for d in range(3)]

# 4. Per-deck air-duct maps (RLE) -> 19x20 grids of tile ids
#    (upper/middle/lower; exported as "roomLayouts" for web compatibility).
layouts = []
layout_consumed = []
for a in (25716, 25835, 25996):
    grid, used = rle_expand(a)
    layouts.append(grid)
    layout_consumed.append(used)
assets["roomLayouts"] = layouts

# 5. Room anchors on the duct maps (RoomOriginTable @ 26501, 34 x row,col)
origins = rd(26501, 34 * 2)
assets["roomOrigins"] = [[origins[i * 2], origins[i * 2 + 1]] for i in range(34)]

# 6. Room positions on the deck map (RoomMarkerAddrTable @ 26569, 34 words).
#    Map pane top-left tile = screen $4000 (DrawRoomBackground_0), so the decoded
#    (char_row, col) ARE grid cells.  Marker sprite is 24x12 px (3 cols x 1.5 rows).
markers = []
mo = at(26569)
for r in range(34):
    saddr = MEM[mo + r * 2] | (MEM[mo + r * 2 + 1] << 8)
    row, col, prow = decode_screen_addr(saddr)
    markers.append({"room": r, "col": col, "row": row, "prow": prow,
                    "deck": ROOM_TYPE[r] if ROOM_TYPE[r] < 3 else None})
assets["roomMarkers"] = markers

# 7. Narcissus screen: RLE layout + raw 380 attribute bytes.
narc_grid, narc_used = rle_expand(30720, 380)
assets["narcissus"] = {"layout": narc_grid, "attrs": rd(30861, 380)}

# 8. Alien encounter animation: 4 frames, 48x63 px = 6 bytes/row x 63 rows = 378 B.
assets["alienFrames"] = [rd(a, 378) for a in (60000, 60378, 60756, 61134)]

# 9. Jones run cycle: 5 frames, 24x21 px = 3 bytes/row x 21 rows = 63 B (64 stride).
assets["jonesFrames"] = [rd(a, 63) for a in (61512, 61576, 61640, 61704, 61768)]

# 10. Animated map-marker sprites (24x12 XOR = 3 B/row x 12 rows = 36 B).
assets["cursorSprites"] = [rd(a, 36) for a in (26637, 26673, 26709, 26745)]
assets["walkSprites"] = [rd(a, 36) for a in (26781, 26817)]

# 11. Loading screen SCREEN$ (raw 6912 bytes: 6144 pixel + 768 attr) for a splash.
assets["loadingScreen"] = list(MEM[0:6912])

# 12. Intro title (optional): tile map 15x11 + its own tileset + attrs.
intro_map = rd(40504, 15 * 11)
intro_max = max(intro_map)
assets["introTileMap"] = intro_map
assets["introTiles"] = rd_tiles(62000, intro_max + 1)
assets["introAttrs"] = rd(40669, 8 * 11)

# 13. ZX palette (normal, bright) as [r,g,b]; attribute byte = F B PPP III.
BASE_COLS = [(0, 0, 0), (0, 0, 205), (205, 0, 0), (205, 0, 205),
             (0, 205, 0), (0, 205, 205), (205, 205, 0), (205, 205, 205)]
BRIGHT_COLS = [(0, 0, 0), (0, 0, 255), (255, 0, 0), (255, 0, 255),
               (0, 255, 0), (0, 255, 255), (255, 255, 0), (255, 255, 255)]
assets["palette"] = {"normal": [list(c) for c in BASE_COLS],
                     "bright": [list(c) for c in BRIGHT_COLS]}

# ---- self-checks ----------------------------------------------------------
errors = []
if len(assets["tiles"]) != 169:
    errors.append("tile count")
# 169 tiles must land exactly on the string table start (28221)
if 26869 + 169 * 8 != 28221:
    errors.append("tile table does not abut string table")
for i, used in enumerate(layout_consumed):
    if MEM[at((25716, 25835, 25996)[i]) + used - 1] != 255:
        errors.append("roomLayout %d not 255-terminated" % i)
if MEM[at(30720) + narc_used - 1] != 255:
    errors.append("narcissus layout not 255-terminated")
if errors:
    print("SELF-CHECK FAILED:", "; ".join(errors), file=sys.stderr)
    sys.exit(1)

# ---- emit graphics.js -----------------------------------------------------
os.makedirs(os.path.dirname(OUT), exist_ok=True)
payload = json.dumps(assets, separators=(",", ":"))
with open(OUT, "w") as fh:
    fh.write("// GENERATED by tools/extract_assets.py from alien_raw.bin - do not edit.\n")
    fh.write("(function(g){var A=" + payload + ";\n")
    fh.write("if(typeof module!=='undefined'&&module.exports){module.exports=A;}"
             "g.ALIEN_ASSETS=A;})(typeof window!=='undefined'?window:this);\n")

print("wrote", OUT, "(%d bytes)" % os.path.getsize(OUT))
print("tiles=%d portraits=%d decks=%d layouts=%d markers=%d alien=%d jones=%d intro=%d" % (
    len(assets["tiles"]), len(assets["portraits"]), len(assets["decks"]),
    len(assets["roomLayouts"]), len(assets["roomMarkers"]),
    len(assets["alienFrames"]), len(assets["jonesFrames"]), len(assets["introTiles"])))

# ---- optional PNG sanity dumps -------------------------------------------
if "--png" in sys.argv:
    from PIL import Image
    dbg = os.path.join(ROOT, "web", "assets", "_debug")
    os.makedirs(dbg, exist_ok=True)

    def render_tilegrid(grid, cols, rows, tiles, fname, ink=(0, 255, 0)):
        img = Image.new("RGB", (cols * 8, rows * 8), (0, 0, 0))
        px = img.load()
        for cy in range(rows):
            for cx in range(cols):
                t = grid[cy * cols + cx]
                if t >= len(tiles):
                    continue
                bm = tiles[t]
                for py in range(8):
                    row = bm[py]
                    for pxx in range(8):
                        if row & (0x80 >> pxx):
                            px[cx * 8 + pxx, cy * 8 + py] = ink
        img.save(os.path.join(dbg, fname))

    for d in range(3):
        render_tilegrid(assets["decks"][d], 20, 19, assets["tiles"], "deck%d.png" % d)
    for i in range(7):
        render_tilegrid(
            [b for c in range(9) for b in [0]],  # placeholder unused
            3, 3, [], "portrait_stub.png") if False else None
    # portraits: 3x3 cells reading order
    for i, p in enumerate(assets["portraits"]):
        img = Image.new("RGB", (24, 24), (255, 255, 255))
        px = img.load()
        for cell in range(9):
            cx, cy = cell % 3, cell // 3
            for py in range(8):
                row = p[cell * 8 + py]
                for pxx in range(8):
                    if row & (0x80 >> pxx):
                        px[cx * 8 + pxx, cy * 8 + py] = (0, 0, 205)
        img.save(os.path.join(dbg, "portrait%d.png" % i))
    for i, f in enumerate(assets["alienFrames"]):
        img = Image.new("RGB", (48, 63), (0, 0, 0))
        px = img.load()
        for y in range(63):
            for bx in range(6):
                b = f[y * 6 + bx]
                for k in range(8):
                    if b & (0x80 >> k):
                        px[bx * 8 + k, y] = (0, 255, 0)
        img.save(os.path.join(dbg, "alien%d.png" % i))
    print("wrote debug PNGs to", dbg)
