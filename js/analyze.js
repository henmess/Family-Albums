// Photo analysis: quality score, perceptual hash (for duplicates),
// focal point (for smart cropping), dominant color and capture date.

const THUMB_MAX = 900;   // preview thumbnail size
const ANALYZE_MAX = 256; // analysis resolution

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

async function canvasToBlob(c, type = 'image/jpeg', q = 0.85) {
  if (c.convertToBlob) return c.convertToBlob({ type, quality: q });
  return new Promise(r => c.toBlob(r, type, q));
}

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

// ---------------- EXIF (DateTimeOriginal) ----------------
export async function readExifDate(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
        return parseTiffDate(v, off + 10);
      }
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + len;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function parseTiffDate(v, tiff) {
  const little = v.getUint16(tiff) === 0x4949;
  const u16 = o => v.getUint16(tiff + o, little);
  const u32 = o => v.getUint32(tiff + o, little);
  const readAscii = (o, n) => {
    let s = '';
    for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(tiff + o + i));
    return s;
  };
  const readIFD = (ifdOff) => {
    const entries = {};
    const n = u16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      entries[tag] = { type, count, valueOff: count > 4 || type !== 2 ? u32(e + 8) : e + 8 };
    }
    return entries;
  };
  const ifd0 = readIFD(u32(4));
  let dateStr = null;
  if (ifd0[0x8769]) {
    const exif = readIFD(ifd0[0x8769].valueOff);
    const t = exif[0x9003] || exif[0x9004];
    if (t) dateStr = readAscii(t.valueOff, t.count);
  }
  if (!dateStr && ifd0[0x0132]) dateStr = readAscii(ifd0[0x0132].valueOff, ifd0[0x0132].count);
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isNaN(d) ? null : d.getTime();
}

// ---------------- main analysis ----------------
export async function analyzeFile(file) {
  const bmp = await createImageBitmap(file); // EXIF orientation applied by the browser
  const width = bmp.width, height = bmp.height;

  // thumbnail
  const ts = Math.min(1, THUMB_MAX / Math.max(width, height));
  const tc = makeCanvas(Math.round(width * ts), Math.round(height * ts));
  const tctx = tc.getContext('2d');
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(bmp, 0, 0, tc.width, tc.height);
  const thumb = await canvasToBlob(tc, 'image/jpeg', 0.85);

  // analysis image
  const as = Math.min(1, ANALYZE_MAX / Math.max(width, height));
  const aw = Math.max(9, Math.round(width * as)), ah = Math.max(9, Math.round(height * as));
  const ac = makeCanvas(aw, ah);
  const actx = ac.getContext('2d', { willReadFrequently: true });
  actx.drawImage(tc, 0, 0, aw, ah);
  const px = actx.getImageData(0, 0, aw, ah).data;

  const gray = new Float32Array(aw * ah);
  let sum = 0, sumSq = 0, satSum = 0, clipLo = 0, clipHi = 0;
  let cr = 0, cg = 0, cb = 0, cw = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    gray[j] = l;
    sum += l; sumSq += l * l;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    satSum += sat;
    if (l < 0.03) clipLo++;
    if (l > 0.97) clipHi++;
    // weighted towards saturated, mid-tone pixels for the dominant color
    const w = sat * sat * (1 - Math.abs(l - 0.5) * 1.6);
    if (w > 0) { cr += r * w; cg += g * w; cb += b * w; cw += w; }
  }
  const N = aw * ah;
  const mean = sum / N;
  const std = Math.sqrt(Math.max(0, sumSq / N - mean * mean));
  const saturation = satSum / N;

  // sharpness: variance of Laplacian + edge-energy focal point
  let lapSum = 0, lapSq = 0, fx = 0, fy = 0, fw = 0;
  for (let y = 1; y < ah - 1; y++) {
    for (let x = 1; x < aw - 1; x++) {
      const i = y * aw + x;
      const lap = (gray[i - 1] + gray[i + 1] + gray[i - aw] + gray[i + aw] - 4 * gray[i]) * 255;
      lapSum += lap; lapSq += lap * lap;
      const gx = gray[i + 1] - gray[i - 1], gy = gray[i + aw] - gray[i - aw];
      const e = gx * gx + gy * gy;
      // skin-ish tones get extra weight (people are usually the subject)
      const p = i * 4, r = px[p], g = px[p + 1], b = px[p + 2];
      const skin = r > 95 && g > 40 && b > 20 && r > g && r > b && (r - Math.min(g, b)) > 15 && Math.abs(r - g) > 15;
      const w = e * (skin ? 3 : 1);
      fx += x * w; fy += y * w; fw += w;
    }
  }
  const M = (aw - 2) * (ah - 2);
  const lapMean = lapSum / M;
  const lapVar = lapSq / M - lapMean * lapMean;

  // blend focal point with center (avoid extreme crops)
  let focal = { x: 0.5, y: 0.45 };
  if (fw > 0) {
    focal = {
      x: clamp(0.5 * 0.4 + (fx / fw / aw) * 0.6, 0.15, 0.85),
      y: clamp(0.45 * 0.4 + (fy / fw / ah) * 0.6, 0.15, 0.85),
    };
  }

  const color = cw > 0
    ? [Math.round(cr / cw), Math.round(cg / cw), Math.round(cb / cw)]
    : [Math.round(mean * 255), Math.round(mean * 255), Math.round(mean * 255)];

  // dHash 8x8 (64 bit) as two 32-bit ints + richer similarity features
  const hash = dHash(tc);
  const feat = computeFeatures(tc, tc.width, tc.height);

  const sharp = clamp((Math.log10(lapVar + 1) - 1.3) / 1.4);
  const exposure = clamp(1 - Math.abs(mean - 0.5) * 2.2) * clamp(1 - (clipLo + clipHi) / N * 3);
  const contrast = clamp(std / 0.22);
  const colorful = clamp(saturation / 0.35);
  const resolution = clamp((width * height) / 6e6);
  const score = 0.45 * sharp + 0.2 * exposure + 0.15 * contrast + 0.1 * colorful + 0.1 * resolution;

  const exifDate = await readExifDate(file);
  bmp.close && bmp.close();

  return {
    width, height, thumb, hash, feat, focal, color,
    date: exifDate || file.lastModified || Date.now(),
    hasExifDate: !!exifDate,
    quality: { sharp, exposure, contrast, colorful, resolution, score },
  };
}

function dHash(src) {
  const c = makeCanvas(9, 8);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data;
  const g = [];
  for (let i = 0; i < d.length; i += 4) g.push(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
  let hi = 0, lo = 0, bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = g[y * 9 + x] > g[y * 9 + x + 1] ? 1 : 0;
      if (bit < 32) hi = (hi << 1) | v; else lo = (lo << 1) | v;
      bit++;
    }
  }
  return [hi >>> 0, lo >>> 0];
}

function popcount(n) {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
export function hamming(a, b) {
  return popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0);
}

// ---------------- similarity features ----------------
// v2: a 16x16 normalized gray "fingerprint" of the full frame and of the
// center square (handles different crops/aspect ratios), plus a color histogram.
export const FEAT_VERSION = 3;
const G = 16;
const D = 32;

// fine "detail" fingerprint: 32x32 gray minus its local blur (edges/texture),
// which ignores the overall light layout (sky on top, ground below...)
function detailGrid(src, sx, sy, sw, sh) {
  const c = makeCanvas(D, D);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, D, D);
  const d = ctx.getImageData(0, 0, D, D).data;
  const g = new Float32Array(D * D);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  const v = new Float32Array(D * D);
  let n = 0;
  for (let y = 0; y < D; y++) {
    for (let x = 0; x < D; x++) {
      let s = 0, c2 = 0;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(D - 1, y + 2); yy++)
        for (let xx = Math.max(0, x - 2); xx <= Math.min(D - 1, x + 2); xx++) { s += g[yy * D + xx]; c2++; }
      const val = g[y * D + x] - s / c2;
      v[y * D + x] = val; n += val * val;
    }
  }
  n = Math.sqrt(n) || 1;
  const out = new Int8Array(D * D);
  for (let j = 0; j < v.length; j++) out[j] = Math.max(-127, Math.min(127, Math.round((v[j] / n) * 127 * 6)));
  return out;
}

function grayGrid(src, sx, sy, sw, sh) {
  const c = makeCanvas(G, G);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, G, G);
  const d = ctx.getImageData(0, 0, G, G).data;
  const v = new Float32Array(G * G);
  let m = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { v[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; m += v[j]; }
  m /= v.length;
  let n = 0;
  for (let j = 0; j < v.length; j++) { v[j] -= m; n += v[j] * v[j]; }
  n = Math.sqrt(n) || 1;
  const out = new Int8Array(v.length);
  // scale so that a unit vector uses most of the int8 range
  for (let j = 0; j < v.length; j++) out[j] = Math.max(-127, Math.min(127, Math.round((v[j] / n) * 127 * 4)));
  return out;
}

export function computeFeatures(src, w, h) {
  const full = grayGrid(src, 0, 0, w, h);
  const s = Math.min(w, h);
  const center = grayGrid(src, (w - s) / 2, (h - s) / 2, s, s);
  const dFull = detailGrid(src, 0, 0, w, h);
  const dCenter = detailGrid(src, (w - s) / 2, (h - s) / 2, s, s);
  const z = s * 0.86; // zoomed-in center, to match photos shot a bit closer
  const dZoom = detailGrid(src, (w - z) / 2, (h - z) / 2, z, z);
  // color histogram 4x4x4 over a 48x48 sample, as fractions * 255
  const c = makeCanvas(48, 48);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h, 0, 0, 48, 48);
  const d = ctx.getImageData(0, 0, 48, 48).data;
  const hist = new Float32Array(64);
  for (let i = 0; i < d.length; i += 4) hist[(d[i] >> 6) * 16 + (d[i + 1] >> 6) * 4 + (d[i + 2] >> 6)]++;
  const total = 48 * 48;
  const hq = new Uint8Array(64);
  for (let i = 0; i < 64; i++) hq[i] = Math.round((hist[i] / total) * 255);
  return { v: FEAT_VERSION, full, center, dFull, dCenter, dZoom, hist: hq };
}

export async function featuresFromBlob(blob) {
  const bmp = await createImageBitmap(blob);
  const f = computeFeatures(bmp, bmp.width, bmp.height);
  bmp.close && bmp.close();
  return f;
}

// normalized correlation of two square grids, allowing a small shift
function ncc(a, b, size = G, maxShift = 1) {
  const G = size;
  let best = -1;
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let ab = 0, aa = 0, bb = 0;
      for (let y = Math.max(0, -dy); y < G - Math.max(0, dy); y++) {
        const ra = y * G, rb = (y + dy) * G;
        for (let x = Math.max(0, -dx); x < G - Math.max(0, dx); x++) {
          const va = a[ra + x], vb = b[rb + x + dx];
          ab += va * vb; aa += va * va; bb += vb * vb;
        }
      }
      const c = ab / (Math.sqrt(aa * bb) || 1);
      if (c > best) best = c;
    }
  }
  return best;
}

function histSim(a, b) {
  let s = 0, ta = 0, tb = 0;
  for (let i = 0; i < 64; i++) { s += Math.min(a[i], b[i]); ta += a[i]; tb += b[i]; }
  return s / (Math.max(ta, tb) || 1);
}

// 0..1 – how much two photos look like the same shot
export function similarityParts(p, q) {
  const a = p.feat, b = q.feat;
  const h = histSim(a.hist, b.hist);
  const sameAR = Math.abs(Math.log((p.width / p.height) / (q.width / q.height))) < 0.08;
  let low = ncc(a.center, b.center);
  let det = 0;
  if (low > 0.4) {
    det = Math.max(ncc(a.dCenter, b.dCenter, D, 2), ncc(a.dZoom, b.dCenter, D, 2), ncc(a.dCenter, b.dZoom, D, 2));
  }
  if (sameAR) {
    const lf = ncc(a.full, b.full);
    if (lf > low) low = lf;
    if (lf > 0.4) det = Math.max(det, ncc(a.dFull, b.dFull, D, 2));
  }
  return { low, det, h };
}

export function similarity(p, q) {
  if (!p.feat || !q.feat || p.feat.v !== FEAT_VERSION || q.feat.v !== FEAT_VERSION) {
    return 1 - hamming(p.hash, q.hash) / 32;
  }
  const { low, det, h } = similarityParts(p, q);
  if (low < 0.4) return low * 0.5;
  return Math.max(0, Math.min(1, W_LOW * low + W_DET * det + W_HIST * h));
}
export const W_LOW = 0.35, W_DET = 0.5, W_HIST = 0.15;

// thresholds per filter strength; lowered when photos were taken seconds apart
export const DEDUP_LEVELS = {
  light:  { base: 0.85, name: 'עדין' },
  normal: { base: 0.71, name: 'רגיל' },
  strong: { base: 0.64, name: 'חזק' },
};

function threshold(p, q, level) {
  let t = (DEDUP_LEVELS[level] || DEDUP_LEVELS.normal).base;
  if (p.hasExifDate && q.hasExifDate) {
    const dt = Math.abs(p.date - q.date) / 1000;
    if (dt < 20) t -= 0.1;         // burst
    else if (dt < 180) t -= 0.06;  // same moment
    else if (dt < 1800) t -= 0.02; // same scene
    else t += 0.03;                // different time – be careful
  }
  return Math.max(0.58, t);
}

// ---------------- curation ----------------
// Groups near-identical photos and marks which one to keep, plus flags weak shots.
export function curate(photos, level = 'normal') {
  const n = photos.length;
  const cache = new Map();
  const sim = (i, j) => {
    const k = i < j ? i * n + j : j * n + i;
    if (!cache.has(k)) cache.set(k, similarity(photos[i], photos[j]));
    return cache.get(k);
  };
  // candidate pairs above threshold, strongest first
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = sim(i, j);
      const t = threshold(photos[i], photos[j], level);
      if (s >= t) pairs.push([s - t, i, j]);
    }
  }
  pairs.sort((a, b) => b[0] - a[0]);
  // merge groups only if every member stays reasonably similar (avoids chaining
  // a whole event into one big "duplicate" group)
  const groupOf = photos.map((_, i) => i);
  const members = new Map(photos.map((_, i) => [i, [i]]));
  for (const [, i, j] of pairs) {
    const gi = groupOf[i], gj = groupOf[j];
    if (gi === gj) continue;
    const A = members.get(gi), B = members.get(gj);
    let ok = true;
    for (const x of A) {
      for (const y of B) {
        if (sim(x, y) < threshold(photos[x], photos[y], level) - 0.06) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    for (const y of B) { groupOf[y] = gi; A.push(y); }
    members.delete(gj);
  }

  for (const g of members.values()) {
    const ps = g.map(i => photos[i]).sort((a, b) => b.quality.score - a.quality.score);
    const gid = ps.length > 1 ? ps[0].id : null;
    ps.forEach((p, k) => { p.dupGroup = gid; p.duplicate = k > 0; });
  }
  for (const p of photos) {
    p.weak = p.quality.sharp < 0.12 || p.quality.score < 0.22;
  }
  return photos;
}

export function isIncluded(p) {
  if (p.raster) return false; // a whole page restored from a PDF, not a photo
  if (p.manual === 'in') return true;
  if (p.manual === 'out') return false;
  return !p.duplicate && !p.weak;
}
