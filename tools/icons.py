"""Generates the app icons: a rounded ink-blue square with three paper lines (the brand mark)."""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
os.makedirs(OUT, exist_ok=True)


def gradient(size, c1, c2):
    img = Image.new('RGB', (size, size), c1)
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return img


def mark(size, pad_ratio, bg_full=False):
    S = size * 4  # supersample
    pad = int(S * pad_ratio)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    grad = gradient(S, (45, 79, 201), (106, 134, 232)).convert('RGBA')
    mask = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(mask)
    if bg_full:
        d.rectangle([0, 0, S, S], fill=255)
    else:
        r = int((S - 2 * pad) * 0.24)
        d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=r, fill=255)
        # small notebook corner: flatten bottom-left corner a bit like the CSS mark
        d.rectangle([pad, S - pad - r, pad + r, S - pad], fill=255)
    img.paste(grad, (0, 0), mask)
    # lines
    inner = S - 2 * pad
    lx0 = pad + int(inner * 0.24)
    lx1 = S - pad - int(inner * 0.24)
    lw = max(4, int(inner * 0.075))
    ys = [0.34, 0.52, 0.70]
    alphas = [235, 190, 140]
    ld = ImageDraw.Draw(img)
    for y, a in zip(ys, alphas):
        yy = pad + int(inner * y)
        ld.rounded_rectangle([lx0, yy - lw // 2, lx1, yy + lw // 2], radius=lw // 2, fill=(255, 255, 255, a))
    return img.resize((size, size), Image.LANCZOS)


mark(192, 0.06).save(os.path.join(OUT, 'icon-192.png'))
mark(512, 0.06).save(os.path.join(OUT, 'icon-512.png'))
mark(512, 0.0, bg_full=True).save(os.path.join(OUT, 'maskable-512.png'))
# apple touch icon: no transparency, full bleed with the gradient background
apple = mark(180, 0.0, bg_full=True).convert('RGB')
apple.save(os.path.join(OUT, 'apple-touch-icon.png'))
print('icons written')
