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

  // dHash 8x8 (64 bit) as two 32-bit ints
  const hash = dHash(tc);

  const sharp = clamp((Math.log10(lapVar + 1) - 1.3) / 1.4);
  const exposure = clamp(1 - Math.abs(mean - 0.5) * 2.2) * clamp(1 - (clipLo + clipHi) / N * 3);
  const contrast = clamp(std / 0.22);
  const colorful = clamp(saturation / 0.35);
  const resolution = clamp((width * height) / 6e6);
  const score = 0.45 * sharp + 0.2 * exposure + 0.15 * contrast + 0.1 * colorful + 0.1 * resolution;

  const exifDate = await readExifDate(file);
  bmp.close && bmp.close();

  return {
    width, height, thumb, hash, focal, color,
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

// ---------------- curation ----------------
// Groups near-identical photos and marks which one to keep, plus flags weak shots.
export function curate(photos) {
  const n = photos.length;
  const parent = photos.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = photos[i], b = photos[j];
      const d = hamming(a.hash, b.hash);
      const dt = Math.abs(a.date - b.date);
      const sameAspect = Math.abs(a.width / a.height - b.width / b.height) < 0.05;
      // identical-looking, or a burst (similar & taken within 90 seconds)
      if ((d <= 6 && sameAspect) || (d <= 14 && dt < 90 * 1000 && sameAspect)) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map();
  photos.forEach((p, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p);
  });

  for (const g of groups.values()) {
    g.sort((a, b) => b.quality.score - a.quality.score);
    const gid = g.length > 1 ? g[0].id : null;
    g.forEach((p, k) => {
      p.dupGroup = gid;
      p.duplicate = k > 0;
    });
  }
  for (const p of photos) {
    p.weak = p.quality.sharp < 0.12 || p.quality.score < 0.22;
  }
  return photos;
}

export function isIncluded(p) {
  if (p.manual === 'in') return true;
  if (p.manual === 'out') return false;
  return !p.duplicate && !p.weak;
}
