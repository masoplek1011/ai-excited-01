// "THE CUT THAT SPLIT THE SUN"
// A cyberpunk samurai/ninja, mid follow-through, whose single katana cut
// splits a giant synthwave sun in two. Procedural pixel art, Node 22 stdlib
// only. Deterministic: seeded PRNG, no Math.random, no Date.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;
const buf = new Uint8Array(W * H * 4);

// ---- seeded PRNG (mulberry32) ----
let _s = 1337;
function rnd() {
  _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rr(a, b) { return a + rnd() * (b - a); }
function ri(a, b) { return Math.floor(rr(a, b + 1)); }

// ---- pixel buffer ----
function px(x, y, r, g, b, a) {
  x = x | 0; y = y | 0;
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const ia = 1 - a;
  buf[i] = r * a + buf[i] * ia;
  buf[i + 1] = g * a + buf[i + 1] * ia;
  buf[i + 2] = b * a + buf[i + 2] * ia;
  buf[i + 3] = 255;
}
function fillRect(x0, y0, x1, y1, r, g, b, a) {
  for (let y = Math.max(0, y0 | 0); y <= Math.min(H - 1, y1 | 0); y++)
    for (let x = Math.max(0, x0 | 0); x <= Math.min(W - 1, x1 | 0); x++)
      px(x, y, r, g, b, a);
}

// Filled circle (scanline).
function disc(cx, cy, rad, r, g, b, a) {
  const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy, dx = Math.sqrt(Math.max(0, rad * rad - dy * dy));
    for (let x = Math.max(x0, Math.ceil(cx - dx)); x <= Math.min(x1, Math.floor(cx + dx)); x++)
      px(x, y, r, g, b, a);
  }
}

// Filled polygon (even-odd scanline over flat [x0,y0,x1,y1,...]).
function poly(pts, r, g, b, a) {
  let minY = H, maxY = 0;
  for (let i = 1; i < pts.length; i += 2) { minY = Math.min(minY, pts[i]); maxY = Math.max(maxY, pts[i]); }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(H - 1, Math.ceil(maxY));
  const n = pts.length / 2;
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const x0 = pts[i * 2], y0 = pts[i * 2 + 1];
      const x1 = pts[((i + 1) % n) * 2], y1 = pts[((i + 1) % n) * 2 + 1];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) px(x, y, r, g, b, a);
    }
  }
}

// Thick line as a quad + round caps. Width w (px).
function thickLine(x0, y0, x1, y1, w, r, g, b, a) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * w / 2, ny = dx / len * w / 2;
  poly([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny], r, g, b, a);
  disc(x0, y0, w / 2, r, g, b, a);
  disc(x1, y1, w / 2, r, g, b, a);
}

// Glowing line: soft wide passes under a bright core.
function glowLine(x0, y0, x1, y1, w, r, g, b, coreA) {
  thickLine(x0, y0, x1, y1, w * 5, r, g, b, 0.05 * coreA);
  thickLine(x0, y0, x1, y1, w * 3, r, g, b, 0.10 * coreA);
  thickLine(x0, y0, x1, y1, w * 1.8, r, g, b, 0.25 * coreA);
  thickLine(x0, y0, x1, y1, w, r, g, b, coreA);
}

// Quadratic bezier point.
function qbez(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
          u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}
// Glowing bezier stroke (polyline sampling).
function glowCurve(p0, p1, p2, w, r, g, b, a, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(qbez(p0, p1, p2, i / steps));
  for (let pass = 0; pass < 4; pass++) {
    const pw = [w * 5, w * 3, w * 1.8, w][pass];
    const pa = [0.05, 0.10, 0.25, 1][pass] * a;
    for (let i = 0; i < pts.length - 1; i++)
      thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pw, r, g, b, pa);
  }
}

// ---- PNG encoder (filter 0, zlib deflate) ----
const CRC_T = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_T[n] = c;
}
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG() {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    raw.set(buf.subarray(y * W * 4, (y + 1) * W * 4), y * (1 + W * 4) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---- 5x7 bitmap font (hand-written) ----
const FONT = {
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "J": ["00111","00010","00010","00010","00010","01010","01100"],
  "U": ["10001","10001","10001","10001","10001","10001","01110"],
  "D": ["11110","10001","10001","10001","10001","10001","11110"],
  "G": ["01110","10001","10000","10111","10001","10001","01110"],
  "E": ["11111","10000","10000","11110","10000","10000","11111"],
  ":": ["00000","00100","00000","00000","00000","00100","00000"],
  "O": ["01110","10001","10001","10001","10001","10001","01110"],
  "N": ["10001","11001","10101","10011","10001","10001","10001"],
  "C": ["01110","10001","10000","10000","10000","10001","01110"],
  "T": ["11111","00100","00100","00100","00100","00100","00100"],
  "I": ["01110","00100","00100","00100","00100","00100","01110"],
  "S": ["01111","10000","10000","01110","00001","00001","11110"],
  "H": ["10001","10001","10001","11111","10001","10001","10001"],
  ".": ["00000","00000","00000","00000","00000","00000","01100"],
};
function drawText(str, cx, y, scale, r, g, b, a) {
  const unitW = str.length * 6 - 1;
  let x = Math.round(cx - (unitW * scale) / 2);
  for (const ch of str) {
    const gl = FONT[ch] || FONT[" "];
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++)
        if (gl[row][col] === "1")
          fillRect(x + col * scale, y + row * scale, x + col * scale + scale - 1, y + row * scale + scale - 1, r, g, b, a);
    x += 6 * scale;
  }
}

// ---- palette ----
const INK = [11, 11, 22];        // silhouette black-indigo
const CYAN = [64, 224, 255];
const MAGENTA = [255, 42, 140];
const SUN_YELLOW = [255, 214, 106];
const SUN_RED = [255, 42, 60];
const SUN_DEEP = [196, 14, 74];

// ---- sky: near-black indigo gradient + stars ----
function drawSky() {
  for (let y = 0; y < H; y++) {
    const t = y / H;
    // top #05050f -> horizon #1a1440
    const r = 5 + 21 * t * t, g = 5 + 15 * t * t, b = 15 + 49 * t * t;
    for (let x = 0; x < W; x++) px(x, y, r, g, b, 1);
  }
  // stars, sparse, only upper 2/3
  for (let i = 0; i < 150; i++) {
    const x = rr(0, W), y = rr(0, 640), s = rr(0.35, 1);
    const tw = rr(0.4, 1);
    if (rnd() < 0.12) { // a few cross sparkles
      px(x, y, 220, 235, 255, tw);
      px(x - 1, y, 220, 235, 255, tw * 0.5); px(x + 1, y, 220, 235, 255, tw * 0.5);
      px(x, y - 1, 220, 235, 255, tw * 0.5); px(x, y + 1, 220, 235, 255, tw * 0.5);
    } else {
      disc(x, y, s, 200, 215, 255, tw * 0.85);
    }
  }
}

// ---- the split sun ----
// Sun centre, radius, cut direction (upper-left -> lower-right) and normal.
const SUN = { cx: 700, cy: 330, r: 225 };
const CUT_D = [0.77, 0.64];                 // cut direction
const CUT_N = [0.64, -0.77];                // cut normal
const CUT_OFF = 22;                         // half-gap between the halves

function sunColor(dx, dy, r) {
  // vertical gradient: yellow-white top -> red -> deep magenta bottom
  const t = Math.max(0, Math.min(1, (dy / r + 1) / 2));
  let cr, cg, cb;
  if (t < 0.45) {
    const u = t / 0.45;
    cr = 255; cg = 214 - 172 * u; cb = 106 - 46 * u;
  } else {
    const u = (t - 0.45) / 0.55;
    cr = 255 - 59 * u; cg = 42 - 28 * u; cb = 60 + 14 * u;
  }
  return [cr, cg, cb];
}

function drawSunHalf(ox, oy, keepSign) {
  const { cx, cy, r } = SUN;
  const ccx = cx + ox, ccy = cy + oy;
  const x0 = Math.max(0, Math.floor(ccx - r - 2)), x1 = Math.min(W - 1, Math.ceil(ccx + r + 2));
  const y0 = Math.max(0, Math.floor(ccy - r - 2)), y1 = Math.min(H - 1, Math.ceil(ccy + r + 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - ccx, dy = y - ccy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      // clip to one side of the cut line (measured from the true centre),
      // with a real gap so the sky shows through the split
      const s = (x - cx) * CUT_N[0] + (y - cy) * CUT_N[1];
      if (s * keepSign < 12) continue;
      // synthwave slats: horizontal gaps, widening toward the bottom
      if (dy > r * 0.02) {
        const t = dy / r;
        const period = 9 + t * 42;
        if ((dy % period) < period * 0.38) continue;
      }
      const [cr, cg, cb] = sunColor(dx, dy, r);
      // soften the very rim
      const edge = Math.sqrt(d2) / r;
      const a = edge > 0.985 ? 0.55 : 1;
      px(x, y, cr, cg, cb, a);
    }
  }
}

function drawSun() {
  const { cx, cy, r } = SUN;
  // halo behind the sun
  disc(cx, cy, r + 90, 255, 60, 80, 0.05);
  disc(cx, cy, r + 55, 255, 70, 90, 0.07);
  disc(cx, cy, r + 28, 255, 90, 100, 0.10);
  // the two halves, shifted apart along the cut normal
  const ox = CUT_N[0] * CUT_OFF, oy = CUT_N[1] * CUT_OFF;
  drawSunHalf(-ox, -oy, +1);
  drawSunHalf(ox, oy, -1);
  // light leaking from the split: hot core line + glow along the cut
  const lx0 = cx - CUT_D[0] * (r + 30), ly0 = cy - CUT_D[1] * (r + 30);
  const lx1 = cx + CUT_D[0] * (r + 30), ly1 = cy + CUT_D[1] * (r + 30);
  glowLine(lx0, ly0, lx1, ly1, 7, 255, 240, 200, 0.95);
  thickLine(lx0, ly0, lx1, ly1, 3, 255, 255, 255, 1);
  // a few bright shards flying off the cut
  for (let i = 0; i < 7; i++) {
    const t = rr(-0.8, 0.8);
    const sx = cx + CUT_D[0] * t * r + CUT_N[0] * rr(6, 26) * (rnd() < 0.5 ? 1 : -1);
    const sy = cy + CUT_D[1] * t * r + CUT_N[1] * rr(6, 26) * (rnd() < 0.5 ? 1 : -1);
    const a = Math.atan2(CUT_D[1], CUT_D[0]) + rr(-0.5, 0.5);
    const len = rr(8, 26);
    thickLine(sx, sy, sx + Math.cos(a) * len, sy + Math.sin(a) * len, 2.5, 255, 220, 160, 0.9);
  }
  // shockwave arcs radiating from the cut (lower-left side)
  for (const [rad, al] of [[r + 42, 0.5], [r + 72, 0.32], [r + 105, 0.18]]) {
    for (let k = 0; k < 26; k++) {
      const a0 = Math.PI * (0.62 + (k / 26) * 0.62);
      const a1 = Math.PI * (0.62 + ((k + 1) / 26) * 0.62);
      thickLine(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad,
               cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad,
               3, 255, 120, 110, al);
    }
  }
}

// ---- distant city bokeh, bottom edges only ----
function drawCity() {
  const yBase = 745;
  for (let i = 0; i < 24; i++) {
    const left = rnd() < 0.55;
    const x = left ? rr(0, 200) : rr(835, W);
    const y = rr(yBase - 38, yBase + 8);
    const rad = rr(2, 5.5);
    const c = rnd();
    const col = c < 0.4 ? CYAN : c < 0.7 ? MAGENTA : [255, 190, 90];
    disc(x, y, rad * 2.2, col[0], col[1], col[2], 0.10);
    disc(x, y, rad, col[0], col[1], col[2], rr(0.45, 0.85));
    disc(x, y, rad * 0.45, 255, 255, 255, 0.8);
  }
}

// ---- wet ground + reflections ----
function drawGround() {
  // ground slab
  for (let y = 790; y < H; y++) {
    const t = (y - 790) / (H - 790);
    const r = 8 + 10 * t, g = 8 + 10 * t, b = 18 + 22 * t;
    for (let x = 0; x < W; x++) px(x, y, r, g, b, 1);
  }
  // horizon glow line
  thickLine(0, 790, W, 790, 2, 255, 90, 110, 0.35);
  // sun reflection: shimmering red column under the sun
  for (let i = 0; i < 90; i++) {
    const y = rr(800, 1010);
    const spread = 30 + (y - 800) * 0.55;
    const x = SUN.cx + rr(-spread, spread);
    const len = rr(14, 70);
    const a = rr(0.10, 0.5) * (1 - (y - 800) / 260);
    const c = rnd() < 0.6 ? SUN_RED : SUN_YELLOW;
    thickLine(x, y, x + len, y, rr(2, 5), c[0], c[1], c[2], a);
  }
  // neon streak reflections (cyan left, magenta right)
  for (let i = 0; i < 40; i++) {
    const y = rr(800, 1000);
    const x = rr(0, W);
    const len = rr(10, 46);
    const c = rnd() < 0.5 ? CYAN : MAGENTA;
    thickLine(x, y, x + len, y, rr(1.5, 3), c[0], c[1], c[2], rr(0.08, 0.3));
  }
  // rain ripples on the wet ground
  for (let i = 0; i < 30; i++) {
    const x = rr(20, W - 20), y = rr(810, 1010);
    const rx = rr(4, 12);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      px(Math.round(x + Math.cos(a) * rx), Math.round(y + Math.sin(a) * rx * 0.35), 160, 220, 255, 0.25);
    }
  }
}

// ---- rain streaks ----
function drawRain() {
  for (let i = 0; i < 210; i++) {
    const x = rr(-20, W), y = rr(0, H);
    const len = rr(12, 30);
    const a = rr(0.08, 0.22);
    const dx = len * 0.22, dy = len;
    thickLine(x, y, x + dx, y + dy, 1.4, 170, 220, 255, a);
  }
}

// ---- hero: the samurai, mid follow-through ----
// Big foreground figure (head ~y375 to feet ~y986 = 60% of frame).
// Every limb is a filled, THICK polygon — never a thin stick.
// Tapered limb: a quad from width w0 at (x0,y0) to width w1 at (x1,y1),
// with round caps — a limb with real volume, never a stick.
function limb(x0, y0, w0, x1, y1, w1, r, g, b, a) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  poly([x0 + nx * w0 / 2, y0 + ny * w0 / 2, x1 + nx * w1 / 2, y1 + ny * w1 / 2,
        x1 - nx * w1 / 2, y1 - ny * w1 / 2, x0 - nx * w0 / 2, y0 - ny * w0 / 2], r, g, b, a);
  disc(x0, y0, w0 / 2, r, g, b, a);
  disc(x1, y1, w1 / 2, r, g, b, a);
}
function ellipse(cx, cy, rx, ry, r, g, b, a) {
  const pts = [];
  for (let k = 0; k < 28; k++) {
    const t = (k / 28) * Math.PI * 2;
    pts.push(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry);
  }
  poly(pts, r, g, b, a);
}

function drawHero() {
  // aura behind the figure
  disc(470, 640, 250, 255, 42, 140, 0.05);
  disc(540, 600, 200, 64, 224, 255, 0.05);
  // ground shadow
  ellipse(500, 972, 250, 16, 0, 0, 0, 0.5);

  // -- back leg (left, planted): thigh + shin + foot --
  limb(400, 780, 88, 352, 868, 72, INK[0], INK[1], INK[2], 1);
  limb(352, 868, 72, 322, 952, 58, INK[0], INK[1], INK[2], 1);
  poly([326, 946, 292, 966, 292, 986, 378, 986, 374, 950], INK[0], INK[1], INK[2], 1);
  // -- front leg (right, lunging): thigh + shin + foot --
  limb(490, 782, 92, 596, 856, 74, INK[0], INK[1], INK[2], 1);
  limb(596, 856, 74, 662, 938, 58, INK[0], INK[1], INK[2], 1);
  poly([662, 930, 742, 956, 748, 986, 688, 986, 656, 950], INK[0], INK[1], INK[2], 1);
  // hakama fold lines (subtle indigo)
  thickLine(378, 800, 352, 940, 3, 34, 34, 66, 0.8);
  thickLine(560, 830, 636, 930, 3, 34, 34, 66, 0.8);

  // -- torso: broad kimono, tapered waist --
  poly([366, 546, 516, 532, 540, 606, 528, 706, 398, 712, 352, 624],
    INK[0], INK[1], INK[2], 1);
  // flaring kimono skirt
  poly([398, 706, 528, 702, 540, 782, 386, 786],
    INK[0], INK[1], INK[2], 1);
  // gi crossover (V-neck) + fold lines
  thickLine(396, 546, 452, 632, 4, 34, 34, 66, 0.9);
  thickLine(508, 538, 452, 632, 4, 34, 34, 66, 0.9);
  thickLine(490, 556, 482, 690, 3, 34, 34, 66, 0.8);
  // -- sash (obi), magenta --
  poly([384, 694, 532, 688, 536, 722, 380, 726], 120, 10, 60, 1);
  thickLine(386, 696, 530, 690, 3, 255, 42, 140, 0.9);
  // sash knot
  poly([448, 696, 482, 694, 488, 722, 454, 724], 160, 12, 78, 1);

  // -- neck --
  poly([414, 478, 452, 478, 458, 548, 410, 548], INK[0], INK[1], INK[2], 1);

  // -- head + hair --
  disc(430, 445, 46, INK[0], INK[1], INK[2], 1);
  // topknot
  poly([420, 404, 432, 376, 448, 400, 440, 412, 424, 412], INK[0], INK[1], INK[2], 1);
  // hair swept back, flowing left in the wind
  poly([400, 418, 328, 448, 296, 502, 330, 516, 386, 478, 408, 450],
    INK[0], INK[1], INK[2], 1);
  // headband (hachimaki) + one short flowing tail
  thickLine(400, 436, 466, 428, 8, 255, 42, 140, 1);
  thickLine(400, 442, 332, 496, 5, 255, 42, 140, 0.9);
  // eye slit, cyan glint
  thickLine(444, 442, 468, 436, 4, 64, 224, 255, 1);

  // -- left arm: across the body, hand on the scabbard --
  limb(362, 556, 48, 306, 632, 42, INK[0], INK[1], INK[2], 1);
  limb(306, 632, 42, 330, 700, 36, INK[0], INK[1], INK[2], 1);
  disc(330, 700, 18, INK[0], INK[1], INK[2], 1);
  // -- right arm: extended up-right, driving the katana --
  limb(512, 542, 54, 592, 478, 46, INK[0], INK[1], INK[2], 1);
  limb(592, 478, 46, 688, 408, 38, INK[0], INK[1], INK[2], 1);
  // fist around the grip
  disc(692, 404, 24, INK[0], INK[1], INK[2], 1);

  // -- scabbard (saya), angled down-left from the hip --
  thickLine(368, 698, 240, 806, 18, 22, 18, 44, 1);
  thickLine(368, 698, 240, 806, 5, 255, 42, 140, 0.55);

  // -- katana: grip + long bright blade to the sun --
  thickLine(676, 424, 700, 402, 12, 30, 20, 20, 1);
  poly([690, 414, 706, 400, 878, 238, 884, 246], 235, 250, 255, 1);
  glowLine(700, 402, 880, 242, 5, 180, 240, 255, 0.9);
  thickLine(700, 402, 880, 242, 2, 255, 255, 255, 1);

  // -- rim light: cyan on the sun-facing (right) edges --
  thickLine(516, 532, 540, 606, 4, CYAN[0], CYAN[1], CYAN[2], 0.95);
  thickLine(540, 606, 528, 706, 4, CYAN[0], CYAN[1], CYAN[2], 0.95);
  thickLine(619, 837, 685, 919, 4, CYAN[0], CYAN[1], CYAN[2], 0.9);
  thickLine(668, 934, 738, 954, 4, CYAN[0], CYAN[1], CYAN[2], 0.9);
  thickLine(497, 523, 577, 459, 4, CYAN[0], CYAN[1], CYAN[2], 0.95);
  thickLine(580, 462, 676, 392, 4, CYAN[0], CYAN[1], CYAN[2], 0.95);
  // head rim (right arc)
  for (let k = 0; k < 8; k++) {
    const a0 = -1.1 + (k / 8) * 1.6, a1 = -1.1 + ((k + 1) / 8) * 1.6;
    thickLine(430 + Math.cos(a0) * 45, 445 + Math.sin(a0) * 45,
             430 + Math.cos(a1) * 45, 445 + Math.sin(a1) * 45,
             3.5, CYAN[0], CYAN[1], CYAN[2], 0.95);
  }
  // -- rim light: magenta on the shadow (left) edges --
  thickLine(366, 546, 352, 624, 4, MAGENTA[0], MAGENTA[1], MAGENTA[2], 0.9);
  thickLine(352, 624, 398, 712, 4, MAGENTA[0], MAGENTA[1], MAGENTA[2], 0.9);
  thickLine(322, 857, 292, 941, 4, MAGENTA[0], MAGENTA[1], MAGENTA[2], 0.85);
  thickLine(292, 941, 294, 970, 4, MAGENTA[0], MAGENTA[1], MAGENTA[2], 0.85);
  thickLine(344, 543, 288, 619, 4, MAGENTA[0], MAGENTA[1], MAGENTA[2], 0.85);
  thickLine(289, 638, 313, 706, 4, MAGENTA[0], MAGENTA[1], MAGENTA[2], 0.85);
  thickLine(400, 418, 328, 448, 4, MAGENTA[0], MAGENTA[1], MAGENTA[2], 0.8);
}

// ---- slash trail: the swing's energy arc through the sky ----
function drawSlashTrail() {
  glowCurve([880, 242], [660, 138], [468, 252], 5, 200, 245, 255, 0.9, 24);
  glowCurve([880, 242], [700, 180], [540, 300], 2.5, 255, 120, 180, 0.5, 18);
}

// ---- judge text, bottom band ----
function drawTextLine() {
  fillRect(0, 986, W, H, 4, 4, 10, 0.55);
  thickLine(0, 986, W, 986, 2, 64, 224, 255, 0.35);
  drawText("JUDGE: ONE CUT IS ENOUGH.", 512, 992, 4, 64, 224, 255, 0.85);
  drawText("JUDGE: ONE CUT IS ENOUGH.", 512, 990, 4, 255, 255, 255, 1);
}

// ---- main ----
function main() {
  drawSky();
  drawSun();
  drawCity();
  drawGround();
  drawHero();
  drawSlashTrail();
  drawRain();
  drawTextLine();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.png"), encodePNG());
}
main();
