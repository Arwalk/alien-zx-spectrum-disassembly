#!/usr/bin/env python3
"""Composite the deck map + live overlays (mirrors render.drawMap) to a PNG,
so the assembled game view can be eyeballed without a browser."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
gj = open(os.path.join(WEB, "assets", "graphics.js")).read()
G = json.loads(gj.split("var A=", 1)[1].split(";\nif(typeof", 1)[0])
S = json.load(open(sys.argv[1]))

SCALE = 3
W, H = 20 * 8 * SCALE, 19 * 8 * SCALE
tiles = G["tiles"]
markers = {m["room"]: m for m in G["roomMarkers"]}
deck = S["deck"]

img = Image.new("RGB", (W, H), (5, 8, 10))
draw = ImageDraw.Draw(img)

# deck tiles, green on black
grid = G["decks"][deck]
for cy in range(19):
    for cx in range(20):
        t = grid[cy * 20 + cx]
        if not t or t >= len(tiles):
            continue
        bm = tiles[t]
        for py in range(8):
            row = bm[py]
            for px in range(8):
                if row & (0x80 >> px):
                    X = (cx * 8 + px) * SCALE
                    Y = (cy * 8 + py) * SCALE
                    draw.rectangle([X, Y, X + SCALE - 1, Y + SCALE - 1], fill=(0, 255, 0))

def cellbox(room):
    m = markers[room]
    x = m["col"] * 8 * SCALE
    y = m["row"] * 8 * SCALE
    return x, y, 3 * 8 * SCALE, 2 * 8 * SCALE, (m["col"] + 1.5) * 8 * SCALE, (m["row"] + 1) * 8 * SCALE

# reachable + selection + damage/fire
for room, val in S["dmg"].items():
    room = int(room)
    if S["roomTypes"][room] != deck:
        continue
    x, y, bw, bh, cx, cy = cellbox(room)
    color = (255, 128, 48) if val >= 30 else (255, 190, 60)
    draw.ellipse([x + bw - 14, y + 4, x + bw - 6, y + 12], fill=color)
for room in S["fire"]:
    if S["roomTypes"][room] != deck:
        continue
    x, y, bw, bh, cx, cy = cellbox(room)
    draw.polygon([(x + bw - 10, y + 3), (x + bw - 14, y + 12), (x + bw - 6, y + 12)], fill=(255, 80, 48))
for room in S["reach"]:
    if S["roomTypes"][room] != deck:
        continue
    x, y, bw, bh, cx, cy = cellbox(room)
    draw.rounded_rectangle([x, y, x + bw, y + bh], radius=4, outline=(0, 220, 220), width=2)

try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 13)
except Exception:
    font = ImageFont.load_default()

for c in S["crew"]:
    if S["roomTypes"][c["room"]] != deck:
        continue
    _, _, _, _, cx, cy = cellbox(c["room"])
    r = 11 if c["sel"] else 9
    fill = (255, 207, 74) if c["sel"] else (60, 200, 90)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=(255, 255, 255) if c["sel"] else (0, 0, 0), width=2)
    if c["duct"]:
        draw.ellipse([cx - 13, cy - 13, cx + 13, cy + 13], outline=(0, 204, 204), width=1)
    draw.text((cx, cy), c["initial"], fill=(4, 18, 10), font=font, anchor="mm")
    # selection ring
    if c["sel"]:
        x, y, bw, bh, _, _ = cellbox(c["room"])
        draw.rounded_rectangle([x, y, x + bw, y + bh], radius=4, outline=(255, 176, 32), width=2)

# Jones
jr = S["jones"]
if 0 <= jr < 34 and S["roomTypes"][jr] == deck:
    _, _, _, _, cx, cy = cellbox(jr)
    draw.ellipse([cx + 6, cy - 6, cx + 18, cy + 6], fill=(136, 200, 221))
    draw.text((cx + 12, cy), "J", fill=(4, 18, 10), font=font, anchor="mm")

out = os.path.join(WEB, "assets", "_debug", "assembled_map.png")
img.save(out)
print("wrote", out, "deck", deck, "sel", S["selName"])
