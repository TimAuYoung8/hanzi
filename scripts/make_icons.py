# -*- coding: utf-8 -*-
"""Draws the app icon. Run: py scripts/make_icons.py"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLYPH = "\u6c49"          # the character for "Han" (Chinese)
BG, FG = (15, 17, 21), (78, 161, 255)

# Windows ships several CJK-capable fonts; take whichever exists.
CANDIDATES = ["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/msyh.ttc",
              "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simsun.ttc"]
font_path = next((p for p in CANDIDATES if os.path.exists(p)), None)
if not font_path:
    raise SystemExit("No CJK font found on this machine.")

for size in (192, 512, 180):              # 180 is the size iOS asks for
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(font_path, int(size * 0.62))

    # Measure the glyph, then centre it on its actual ink, not its line box.
    l, t, r, b = d.textbbox((0, 0), GLYPH, font=f)
    d.text(((size - (r - l)) / 2 - l, (size - (b - t)) / 2 - t), GLYPH, font=f, fill=FG)

    name = "apple-touch-icon.png" if size == 180 else f"icon-{size}.png"
    img.save(os.path.join(HERE, "icons", name))
    print("icons/" + name)
