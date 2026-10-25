"""Renders the Inkleaf mark — two sheets of faded-blue paper, one on the other, with a glossy ink-blue feather and a
drop of ink lying across them — and the app icons.

Everything is computed, no image assets: signed-distance fields give the sheets, the feather and the drop; height
fields with rounded bevels give them volume; a small Blinn-Phong shader (key light top-left, fill light, rim light,
highlights) lights them over a light paper-like background, with soft shadows cast from each layer onto the ones below.

  python3 tools/icons.py            writes icons/*.png (app icons, maskable, apple touch, in-app marks)
"""
import os, math
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
os.makedirs(OUT, exist_ok=True)

def hex_rgb(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
def unit(a): a = np.array(a, np.float32); return a / np.linalg.norm(a)
L1 = unit([-0.55, -0.70, 0.55]); L2 = unit([0.65, 0.25, 0.45]); V = unit([0, 0, 1]); HV = unit(L1 + V)

def rot(x, y, cx, cy, ang):
    """coordinates relative to (cx, cy), rotated by -ang (so a shape drawn axis-aligned appears rotated by ang)"""
    dx, dy = x - cx, y - cy
    return dx * math.cos(ang) + dy * math.sin(ang), -dx * math.sin(ang) + dy * math.cos(ang)

def sdf_rbox(u, v, hw, hh, r):
    qx = np.abs(u) - hw + r; qy = np.abs(v) - hh + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r

def normals(h, px):
    gy, gx = np.gradient(h, px)
    n = np.stack([-gx, -gy, np.ones_like(h)], -1); return n / np.linalg.norm(n, axis=-1, keepdims=True)

def shade(n, albedo, spec_pow, spec_k, rim_k, ambient=0.36):
    dif = np.clip((n * L1).sum(-1), 0, 1); fill = np.clip((n * L2).sum(-1), 0, 1)
    spec = np.clip((n * HV).sum(-1), 0, 1) ** spec_pow
    rim = (1 - np.clip((n * V).sum(-1), 0, 1)) ** 3
    col = albedo * (ambient + 0.72 * dif + 0.22 * fill)[..., None]
    col = col + spec[..., None] * spec_k + rim[..., None] * rim_k * np.array([0.62, 0.74, 1.0], np.float32)
    return np.clip(col, 0, 1)

def render(size, bg='paper', scale=1.0, ss=2):
    """RGBA image. bg: 'paper' (light gradient, full bleed), 'rounded' (light rounded square, transparent corners)
    or 'none' (the mark and its shadows only). scale: size of the mark relative to the canvas."""
    S = size * ss; px = 2.0 / S
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    x = (xs + 0.5) * px - 1.0; y = (ys + 0.5) * px - 1.0
    k = scale
    shadow_rgb = hex_rgb('#182452')
    def blur_shift(alpha, dx, dy, sigma):
        im = Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8)); canvas = Image.new('L', (S, S), 0)
        canvas.paste(im, (int(dx * S), int(dy * S))); return np.asarray(canvas.filter(ImageFilter.GaussianBlur(sigma * S)), np.float32) / 255
    def cast(rgb, alpha, dx, dy, sigma, strength, onto_mask=None):
        """darkens rgb with the soft shadow of a layer (alpha) shifted by dx, dy"""
        sh = blur_shift(alpha, dx, dy, sigma) * strength
        if onto_mask is not None: sh = sh * onto_mask
        return rgb * (1 - sh[..., None]) + shadow_rgb * sh[..., None]
    def over(dst_rgb, dst_a, src_rgb, src_a):
        a = src_a[..., None]; return src_rgb * a + dst_rgb * (1 - a), np.clip(src_a + dst_a * (1 - src_a), 0, 1)

    # ---------------- background
    if bg == 'none':
        rgb = np.zeros((S, S, 3), np.float32); alpha = np.zeros((S, S), np.float32)
    else:
        g = (ys / S)[..., None]
        rgb = hex_rgb('#FBFCFF')[None, None] * (1 - g) + hex_rgb('#E4E9F4')[None, None] * g
        glow = np.exp(-(((x + 0.55) ** 2 + (y + 0.6) ** 2) / 0.9))[..., None] * 0.35
        rgb = np.clip(rgb + glow * (1 - rgb), 0, 1); alpha = np.ones((S, S), np.float32)

    # ---------------- two sheets of paper (back one peeks out top-left, front one slightly turned the other way)
    T = 0.028 * k                                        # paper thickness (height)
    def sheet(cx, cy, ang, hw, hh, tint_top, tint_bottom, lines):
        u, v = rot(x, y, cx, cy, ang)
        d = sdf_rbox(u, v, hw, hh, 0.045 * k)
        a = np.clip(0.5 - d / px, 0, 1)
        bevel = 0.012 * k; t = np.clip(-d / bevel, 0, 1); h = (t * t * (3 - 2 * t)) * T
        n = normals(h, px)
        tt = np.clip((v / hh + 1) / 2, 0, 1)[..., None]
        alb = hex_rgb(tint_top)[None, None] * (1 - tt) + hex_rgb(tint_bottom)[None, None] * tt
        col = shade(n, alb, 24, 0.10, 0.08, ambient=0.46)
        if lines:   # faint ruled lines, parallel to the sheet's edges
            for i in range(lines):
                vy = -hh * 0.55 + i * (hh * 1.1 / (lines - 1))
                line = np.exp(-((v - vy) / (0.006 * k)) ** 2 / 2) * (np.abs(u) < hw * 0.72) * (d < -0.02 * k)
                col = col * (1 - 0.16 * line)[..., None]
        return col, a
    back_col, back_a = sheet(-0.06 * k, -0.05 * k, math.radians(-10), 0.40 * k, 0.52 * k, '#C9D6F4', '#B7C7EE', 0)
    front_col, front_a = sheet(0.04 * k, 0.07 * k, math.radians(5), 0.40 * k, 0.52 * k, '#F1F5FE', '#DCE5F9', 4)
    rgb = cast(rgb, back_a, 0.025, 0.045, 0.04, 0.22); rgb = cast(rgb, back_a, 0.006, 0.012, 0.01, 0.16)
    rgb, alpha = over(rgb, alpha, back_col, back_a)
    rgb = cast(rgb, front_a, 0.022, 0.040, 0.035, 0.26); rgb = cast(rgb, front_a, 0.005, 0.010, 0.008, 0.18)
    rgb, alpha = over(rgb, alpha, front_col, front_a)

    # ---------------- the feather (a lens rotated 45°, tip up-right) and the drop of ink at its quill end
    fk = 0.58 * k; ang = -math.pi / 4; cx, cy = 0.06 * k, 0.03 * k
    u, v = rot(x, y, cx, cy, ang)
    R = fk / 0.733; c = 0.68 * R
    d_leaf = np.maximum(np.hypot(u, v - c) - R, np.hypot(u, v + c) - R)
    half_w = R - c
    bevel = 0.10 * k; t = np.clip(-d_leaf / bevel, 0, 1); h_leaf = t * t * (3 - 2 * t)
    across = np.clip(np.abs(v) / max(half_w, 1e-6), 0, 1); along = np.clip(np.abs(u) / fk, 0, 1)
    h_leaf = h_leaf * (0.78 + 0.22 * (1 - across ** 2) * (1 - along ** 4))
    vein = np.exp(-(v / (0.026 * k)) ** 2 / 2) * (1 - along ** 2) * (d_leaf < -0.03 * k)
    barbs = 0.5 + 0.5 * np.cos((u * 1.0 + np.abs(v) * 1.5) / (0.066 * k) * math.pi)   # faint feather barbs, angled toward the tip
    h_leaf = h_leaf - 0.16 * vein - 0.011 * barbs * (d_leaf < -0.035 * k) * (np.abs(v) > 0.035 * k) * (1 - along ** 3)
    hl = h_leaf * 0.24 * k
    n_leaf = normals(hl, px)
    tt = np.clip((u / fk + 1) / 2, 0, 1)[..., None]
    alb = hex_rgb('#2140B4')[None, None] * (1 - tt) + hex_rgb('#5B7CF0')[None, None] * tt
    alb = alb * (1 + 0.10 * np.exp(-(v / (0.12 * k)) ** 2 / 2))[..., None]
    col_leaf = shade(n_leaf, alb, 48, 0.42, 0.30) * (1 - 0.18 * vein - 0.10 * (1 - t) * (d_leaf < 0))[..., None]
    a_leaf = np.clip(0.5 - d_leaf / px, 0, 1)
    dcx = cx - fk * math.cos(ang) * 1.03; dcy = cy - fk * math.sin(ang) * 1.03; dr = 0.15 * k
    d_drop = np.hypot(x - dcx, y - dcy) - dr
    hd = np.where(d_drop < 0, np.sqrt(np.clip(dr ** 2 - (d_drop + dr) ** 2, 0, None)), 0)
    col_drop = shade(normals(hd, px), hex_rgb('#17307F')[None, None] * np.ones_like(alb), 90, 0.75, 0.22)
    a_drop = np.clip(0.5 - d_drop / px, 0, 1)
    ink_rgb, ink_a = over(col_leaf * a_leaf[..., None], a_leaf, col_drop, a_drop)
    ink_rgb = np.where(ink_a[..., None] > 0, ink_rgb / np.maximum(ink_a[..., None], 1e-6), 0)
    rgb = cast(rgb, ink_a, 0.030, 0.055, 0.04, 0.28); rgb = cast(rgb, ink_a, 0.008, 0.015, 0.011, 0.24)
    rgb, alpha = over(rgb, alpha, ink_rgb, ink_a)

    # ---------------- framing
    if bg == 'rounded':
        r = 0.44; qx = np.abs(x) - (1 - r); qy = np.abs(y) - (1 - r)
        d_box = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
        alpha = np.clip(0.5 - d_box / px, 0, 1)
    img = np.concatenate([np.clip(rgb, 0, 1), alpha[..., None]], -1)
    im = Image.fromarray((img * 255 + 0.5).astype(np.uint8), 'RGBA')
    return im.resize((size, size), Image.LANCZOS)

if __name__ == '__main__':
    render(512, 'rounded', 1.10).save(os.path.join(OUT, 'icon-512.png'))
    render(192, 'rounded', 1.10).save(os.path.join(OUT, 'icon-192.png'))
    render(512, 'paper', 0.90).save(os.path.join(OUT, 'maskable-512.png'))      # safe zone: the mark stays in the centre 80%
    render(180, 'paper', 1.10).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
    render(128, 'none', 1.36).save(os.path.join(OUT, 'mark-128.png'))              # in-app brand mark
    render(320, 'none', 1.36).save(os.path.join(OUT, 'mark-320.png'))              # lock screen hero
    print('icons written')
