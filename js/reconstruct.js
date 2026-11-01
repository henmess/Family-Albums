// Rebuilds an editable design from a PDF page image that this site produced
// earlier: finds the layout + which album photos sit where, and (optionally)
// reads the titles/captions with Hebrew OCR.
import { TEMPLATES, templateById } from './layout.js?v=42';
import { THEMES } from './render.js?v=42';

const S = 16; // fingerprint grid

// ---------- small image helpers ----------
function grayOf(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return g;
}
// average a rectangle of a gray image into an S x S grid
function sampleGrid(g, w, h, x, y, rw, rh) {
  const out = new Float32Array(S * S);
  for (let gy = 0; gy < S; gy++) {
    for (let gx = 0; gx < S; gx++) {
      const x0 = x + (gx / S) * rw, y0 = y + (gy / S) * rh;
      const x1 = x0 + rw / S, y1 = y0 + rh / S;
      let sum = 0, n = 0;
      const sx = Math.max(1, Math.floor((x1 - x0) / 3)), sy = Math.max(1, Math.floor((y1 - y0) / 3));
      for (let yy = Math.max(0, Math.floor(y0)); yy < Math.min(h, Math.ceil(y1)); yy += sy) {
        for (let xx = Math.max(0, Math.floor(x0)); xx < Math.min(w, Math.ceil(x1)); xx += sx) { sum += g[yy * w + xx]; n++; }
      }
      out[gy * S + gx] = n ? sum / n : 0;
    }
  }
  return out;
}
// summed-area table: lets us average any rectangle in O(1)
function integral(g, w, h) {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) { row += g[(y - 1) * w + x - 1]; ii[y * (w + 1) + x] = ii[(y - 1) * (w + 1) + x] + row; }
  }
  return ii;
}
function gridFast(ii, w, h, x, y, rw, rh, n) {
  const out = new Float32Array(n * n), W1 = w + 1;
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const x0 = Math.max(0, Math.min(w, Math.round(x + gx * rw / n))), x1 = Math.max(x0 + 1, Math.min(w, Math.round(x + (gx + 1) * rw / n)));
    const y0 = Math.max(0, Math.min(h, Math.round(y + gy * rh / n))), y1 = Math.max(y0 + 1, Math.min(h, Math.round(y + (gy + 1) * rh / n)));
    const sum = ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0];
    out[gy * n + gx] = sum / Math.max(1, (x1 - x0) * (y1 - y0));
  }
  return out;
}
function nccN(a, b, n, shift) {
  let best = -1;
  for (let dy = -shift; dy <= shift; dy++) for (let dx = -shift; dx <= shift; dx++) {
    let ma = 0, mb = 0, cnt = 0;
    for (let y = Math.max(0, -dy); y < n - Math.max(0, dy); y++) for (let x = Math.max(0, -dx); x < n - Math.max(0, dx); x++) { ma += a[y * n + x]; mb += b[(y + dy) * n + x + dx]; cnt++; }
    ma /= cnt; mb /= cnt;
    let ab = 0, aa = 0, bb = 0;
    for (let y = Math.max(0, -dy); y < n - Math.max(0, dy); y++) for (let x = Math.max(0, -dx); x < n - Math.max(0, dx); x++) {
      const va = a[y * n + x] - ma, vb = b[(y + dy) * n + x + dx] - mb;
      ab += va * vb; aa += va * va; bb += vb * vb;
    }
    const c = ab / (Math.sqrt(aa * bb) || 1);
    if (c > best) best = c;
  }
  return best;
}
function ncc(a, b, shift = 1) {
  let best = -1;
  for (let dy = -shift; dy <= shift; dy++) for (let dx = -shift; dx <= shift; dx++) {
    let ma = 0, mb = 0, n = 0;
    for (let y = Math.max(0, -dy); y < S - Math.max(0, dy); y++) for (let x = Math.max(0, -dx); x < S - Math.max(0, dx); x++) { ma += a[y * S + x]; mb += b[(y + dy) * S + x + dx]; n++; }
    ma /= n; mb /= n;
    let ab = 0, aa = 0, bb = 0;
    for (let y = Math.max(0, -dy); y < S - Math.max(0, dy); y++) for (let x = Math.max(0, -dx); x < S - Math.max(0, dx); x++) {
      const va = a[y * S + x] - ma, vb = b[(y + dy) * S + x + dx] - mb;
      ab += va * vb; aa += va * va; bb += vb * vb;
    }
    const c = ab / (Math.sqrt(aa * bb) || 1);
    if (c > best) best = c;
  }
  return best;
}
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------- album photos: aspect-correct gray thumbnails ----------
export async function preparePhotos(photos, preferred = () => false) {
  const out = [];
  for (const p of photos) {
    try {
      const bmp = await createImageBitmap(p.thumb);
      const sc = Math.min(1, 160 / Math.max(bmp.width, bmp.height));
      const w = Math.max(8, Math.round(bmp.width * sc)), h = Math.max(8, Math.round(bmp.height * sc));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      const d = x.getImageData(0, 0, w, h).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      const gray = grayOf(d, w, h);
      out.push({ p, w, h, gray, ii: integral(gray, w, h), mean: [r / n, g / n, b / n], bonus: preferred(p) ? 0.015 : 0 });
    } catch (e) { /* skip unreadable */ }
  }
  return out;
}
// visible part of a photo in a slot, for a given focal point and zoom (renderer math)
function cropRect(ph, slotW, slotH, f, zoom, inset) {
  const { w, h } = ph;
  const s2 = Math.max(slotW / w, slotH / h) * zoom;
  const sw = slotW / s2, sh = slotH / s2;
  const sx = Math.max(0, Math.min(w - sw, f.x * w - sw / 2));
  const sy = Math.max(0, Math.min(h - sh, f.y * h - sh / 2));
  return [sx + sw * inset, sy + sh * inset, sw * (1 - 2 * inset), sh * (1 - 2 * inset)];
}
// what part of the photo is visible in a slot of this aspect (same math as the renderer)
function photoGridFor(ph, slotW, slotH, inset) {
  const { p, w, h, gray } = ph;
  const f = p.focal || { x: 0.5, y: 0.5 };
  const s = Math.max(slotW / w, slotH / h);
  const sw = slotW / s, sh = slotH / s;
  const sx = Math.max(0, Math.min(w - sw, f.x * w - sw / 2));
  const sy = Math.max(0, Math.min(h - sh, f.y * h - sh / 2));
  return sampleGrid(gray, w, h, sx + sw * inset, sy + sh * inset, sw * (1 - 2 * inset), sh * (1 - 2 * inset));
}

// ---------- page geometry (mirrors render.js) ----------
function geometry(theme, format, bleed, k) {
  const B = bleed * k, PW = format.w * k, PH = format.h * k, M = theme.margin * k, gap = theme.gap * k;
  return { B, PW, PH, M, gap, W: PW + 2 * B, H: PH + 2 * B, k };
}
function templateBoxes(tpl, G) {
  if (tpl.full) return [{ x: 0, y: 0, w: G.W, h: G.H }];
  const cx = G.B + G.M - G.gap / 2, cy = G.B + G.M - G.gap / 2;
  const cw = G.PW - 2 * G.M + G.gap, ch = G.PH - 2 * G.M + G.gap;
  return tpl.slots.map(s => ({ x: cx + (1 - s.x - s.w) * cw + G.gap / 2, y: cy + s.y * ch + G.gap / 2, w: s.w * cw - G.gap, h: s.h * ch - G.gap }));
}
function heroBox(theme, G) {
  const shape = theme.shapeSolo || 'rect';
  let bw, bh;
  if (theme.frame === 'polaroid') { bw = G.PW * 0.66; bh = Math.min(bw * 1.12, G.PH * 0.66); }
  else if (shape === 'arch' || shape === 'circle') { bw = Math.min(G.PW * 0.62, G.PH * 0.5); bh = shape === 'circle' ? bw : bw * 1.18; }
  else { bw = G.PW - 2 * G.M * 1.4; bh = G.PH * 0.6; }
  return { x: G.B + (G.PW - bw) / 2, y: G.B + G.M * 1.4, w: bw, h: bh, shape };
}
// the picture area inside a slot (frames, borders, tilt, round shapes)
function innerBox(box, theme, k, full) {
  let { x, y, w, h } = box;
  if (!full) {
    const m = Math.min(w, h);
    if (theme.frame === 'polaroid') { const b = m * 0.05, bottom = m * 0.16; x += b; y += b; w -= 2 * b; h -= b + bottom; }
    else if (theme.frame === 'film') { const sp = m * 0.1; x += sp * 0.25; y += sp; w -= sp * 0.5; h -= 2 * sp; }
    else if (theme.frame === 'white') { const b = Math.max(1.4 * k, m * 0.035); x += b; y += b; w -= 2 * b; h -= 2 * b; }
    if (box.shape === 'circle') { const d = Math.min(w, h); x += (w - d) / 2; y += (h - d) / 2; w = h = d; }
  }
  return { x, y, w, h };
}

// ---------- page analysis ----------
function bgColor(data, W, H, G) {
  // median color of thin strips inside the page edges (the margins)
  const pts = [];
  const d = Math.max(2, Math.round(G.B + G.M * 0.3));
  for (let t = 0.1; t <= 0.9; t += 0.05) {
    for (const [x, y] of [[t * W, d], [t * W, H - d], [d, t * H], [W - d, t * H]]) {
      const i = (Math.round(y) * W + Math.round(x)) * 4;
      pts.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  const med = c => pts.map(p => p[c]).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
  return [med(0), med(1), med(2)];
}
function themeBgs(t) {
  if (t.bg === 'cycle') return t.bgCycle;
  if (t.bg === 'auto') return [];
  return [t.bg];
}
export function guessTheme(bg, preferred) {
  let best = null;
  for (const [id, t] of Object.entries(THEMES)) {
    for (const hex of themeBgs(t)) {
      const d = cdist(bg, hex2rgb(hex)) - (id === preferred ? 6 : 0);
      if (!best || d < best.d) best = { id, d };
    }
  }
  return best;
}

/**
 * Analyse one page image. Returns { kind, template, photos[], theme, score }.
 * kind: 'photos' | 'hero' | 'full' | 'empty' | 'unknown'
 */
export async function analyzePage(bitmap, ctx) {
  const { format, bleed, prepared, preferredTheme } = ctx;
  const W = 420, H = Math.round(W * bitmap.height / bitmap.width);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bitmap, 0, 0, W, H);
  const data = x.getImageData(0, 0, W, H).data;
  const gray = grayOf(data, W, H);
  const pageII = integral(gray, W, H);
  const k = W / (format.w + 2 * bleed);

  const bg0 = bgColor(data, W, H, geometry(THEMES[preferredTheme] || THEMES.classic, format, bleed, k));
  const tg = guessTheme(bg0, preferredTheme);
  const themeIds = [...new Set([preferredTheme, tg && tg.d < 40 ? tg.id : null].filter(Boolean))];

  const cache = new Map();
  const slotScore = (box, theme, G, full, used, all = false) => {
    const ib = innerBox(box, theme, G.k, full);
    const tilt = theme.tilt ? 0.16 : 0;
    const inset = 0.1 + tilt;
    const key = [ib.x, ib.y, ib.w, ib.h].map(v => Math.round(v)).join(',') + '|' + inset;
    let cand = cache.get(key);
    if (!cand) {
      const pg = gridFast(pageII, W, H, ib.x + ib.w * inset, ib.y + ib.h * inset, ib.w * (1 - 2 * inset), ib.h * (1 - 2 * inset), S);
      // region mean color to pre-filter candidates
      let r = 0, gg = 0, b = 0, n = 0;
      for (let yy = Math.round(ib.y + ib.h * 0.2); yy < ib.y + ib.h * 0.8; yy += 3) for (let xx = Math.round(ib.x + ib.w * 0.2); xx < ib.x + ib.w * 0.8; xx += 3) {
        const i = (yy * W + xx) * 4; r += data[i]; gg += data[i + 1]; b += data[i + 2]; n++;
      }
      const mean = n ? [r / n, gg / n, b / n] : [0, 0, 0];
      // a flat area (plain background, a text page) is not a photo
      let bgPix = 0, tot = 0;
      for (let yy = Math.round(ib.y + ib.h * 0.1); yy < ib.y + ib.h * 0.9; yy += 3) for (let xx = Math.round(ib.x + ib.w * 0.1); xx < ib.x + ib.w * 0.9; xx += 3) {
        const i = (yy * W + xx) * 4; tot++;
        if (cdist([data[i], data[i + 1], data[i + 2]], bg0) < 30) bgPix++;
      }
      // only plain page background is "no photo" (a dark night photo is still a photo)
      const flat = tot && bgPix / tot > 0.55;
      if (flat) cand = [];
      else {
        const rx = ib.x + ib.w * inset, ry = ib.y + ib.h * inset, rw = ib.w * (1 - 2 * inset), rh = ib.h * (1 - 2 * inset);
        const pg8 = gridFast(pageII, W, H, rx, ry, rw, rh, 8);
        // 1) quick look at every photo in the album
        const coarse = prepared.map(ph => {
          const f = ph.p.focal || { x: 0.5, y: 0.5 };
          let c = -1;
          for (const [ff, z] of [[f, 1], [{ x: 0.5, y: 0.5 }, 1.25], [{ x: 0.5, y: 0.5 }, 1.6], [{ x: 0.38, y: 0.45 }, 1.4], [{ x: 0.62, y: 0.45 }, 1.4], [{ x: 0.5, y: 0.35 }, 1.4], [{ x: 0.5, y: 0.62 }, 1.4]]) {
            const [x0, y0, w0, h0] = cropRect(ph, ib.w, ib.h, ff, z, inset);
            c = Math.max(c, nccN(pg8, gridFast(ph.ii, ph.w, ph.h, x0, y0, w0, h0, 8), 8, 1));
          }
          return { ph, c: c - cdist(mean, ph.mean) / 1200 };
        }).sort((a, b2) => b2.c - a.c).slice(0, 30);
        // 2) careful check of the best ones, allowing for zoom / re-framing done in the editor
        const fineGrid = (ph, f, z) => {
          const [x0, y0, w0, h0] = cropRect(ph, ib.w, ib.h, f, z, inset);
          return nccN(pg, gridFast(ph.ii, ph.w, ph.h, x0, y0, w0, h0, S), S, 2);
        };
        // zoom / re-framing a photo may have got in the editor
        const ZOOMS = [1.2, 1.45, 1.75, 2.1], FX = [0.3, 0.4, 0.5, 0.6, 0.7], FY = [0.35, 0.5, 0.65];
        // default framing first; the slow zoom/framing search only for the few best candidates
        const first = coarse.map(({ ph }) => {
          const f0 = ph.p.focal || { x: 0.5, y: 0.5 };
          return { ph, s0: Math.max(fineGrid(ph, f0, 1), fineGrid(ph, { x: 0.5, y: 0.5 }, 1)) };
        }).sort((a, b2) => b2.s0 - a.s0);
        // (a whole page is never searched with zoom: some zoomed crop always fits a busy page 'well enough')
        // big slots are not zoom-searched: a zoomed crop can mimic several smaller photos side by side
        const bigSlot = ib.w * ib.h > 0.45 * W * H;
        const needSearch = !full && !bigSlot && first[0] && first[0].s0 < 0.9;
        // search the best of both rankings (the quick pass also tried a zoomed-in view)
        const searchIds = new Set([...coarse.slice(0, 12), ...first.slice(0, 6)].map(c => c.ph.p.id));
        cand = first.map(({ ph, s0 }) => {
          let bestS = s0;
          if (needSearch && searchIds.has(ph.p.id)) {
            for (const z of ZOOMS) for (const fx of FX) for (const fy of FY) {
              const sc = fineGrid(ph, { x: fx, y: fy }, z) - 0.02 - (z - 1) * 0.03;
              if (sc > bestS) bestS = sc;
            }
          }
          return { ph, s: bestS - cdist(mean, ph.mean) / 1500 + (ph.bonus || 0) };
        }).sort((a, b2) => b2.s - a.s);
      }
      cache.set(key, cand);
    }
    if (all) return cand;
    const hit = cand.find(cnd => !used.has(cnd.ph.p.id));
    return hit || { ph: null, s: -1 };
  };

  // how much of the area outside the photos looks like plain page background
  const bgFit = (boxes, G, bgc) => {
    let ok = 0, n = 0;
    for (let yy = Math.round(G.B + G.M); yy < G.B + G.PH - G.M; yy += 6) {
      for (let xx = Math.round(G.B + G.M); xx < G.B + G.PW - G.M; xx += 6) {
        if (boxes.some(b => xx >= b.x - 2 && xx <= b.x + b.w + 2 && yy >= b.y - 2 && yy <= b.y + b.h + 2)) continue;
        const i = (yy * W + xx) * 4; n++;
        if (cdist([data[i], data[i + 1], data[i + 2]], bgc) < 45) ok++;
      }
    }
    return n < 8 ? 1 : ok / n;
  };

  let best = { kind: 'unknown', score: -1 };
  for (const tid of themeIds) {
    const theme = THEMES[tid];
    const G = geometry(theme, format, bleed, k);
    const candidates = [
      // only layouts this style can produce (no full-page photos in framed styles, overlaps only where allowed)
      ...TEMPLATES.filter(t => (!t.full || theme.fullBleedSolo || theme.cover !== 'framed') && (!t.overlap || theme.allowOverlap)).map(t => ({ kind: t.full ? 'full' : 'photos', template: t.id, boxes: templateBoxes(t, G), full: !!t.full })),
      { kind: 'hero', template: null, boxes: [heroBox(theme, G)], full: false },
    ];
    for (const cnd of candidates) {
      // best overall photo-to-slot assignment (strongest matches first)
      const lists = cnd.boxes.map(box => slotScore(box, theme, G, cnd.full, new Set(), true));
      const pairs = [];
      lists.forEach((l, si) => l.slice(0, 10).forEach(c => pairs.push({ si, id: c.ph.p.id, s: c.s })));
      pairs.sort((x2, y2) => y2.s - x2.s);
      const picks = new Array(cnd.boxes.length).fill(null), scores = new Array(cnd.boxes.length).fill(-1), used = new Set();
      for (const pr of pairs) {
        if (picks[pr.si] || used.has(pr.id)) continue;
        picks[pr.si] = pr.id; scores[pr.si] = pr.s; used.add(pr.id);
      }
      const sum = picks.includes(null) ? -99 * cnd.boxes.length : scores.reduce((x2, y2) => x2 + y2, 0);
      // a wrong layout always leaves at least one slot that matches badly, so weigh the worst slot too
      const mean = picks.includes(null) ? -99 : 0.6 * (sum / cnd.boxes.length) + 0.4 * Math.min(...scores);
      const fit = cnd.full ? 1 : bgFit(cnd.boxes, G, bg0);
      // more slots that all match well is stronger evidence than one lucky slot
      const score = mean * (0.7 + 0.3 * fit) + Math.min(cnd.boxes.length, 4) * 0.01;
      // a full-page photo must match really well (it has no background to confirm the layout)
      if (cnd.full && mean < 0.78) continue;
      if (score > best.score && !picks.includes(null)) best = { kind: cnd.kind, template: cnd.template, photos: picks, theme: tid, score, mean, fit };
    }
  }
  // a page that is mostly plain background is a text page (closing page etc.)
  {
    const G = geometry(THEMES[themeIds[0]], format, bleed, k);
    let bgp = 0, tot = 0;
    for (let yy = Math.round(G.B + G.M); yy < G.B + G.PH - G.M; yy += 5) for (let xx = Math.round(G.B + G.M); xx < G.B + G.PW - G.M; xx += 5) {
      const i = (yy * W + xx) * 4; tot++;
      if (cdist([data[i], data[i + 1], data[i + 2]], bg0) < 35) bgp++;
    }
    if (tot && bgp / tot > 0.8 && !(best.mean > 0.65)) return { kind: 'empty', score: 1, mean: 1, theme: tg && tg.d < 40 ? tg.id : preferredTheme, bg: bg0 };
  }
  // a page with almost no picture content is a text page (closing page etc.)
  let edge = 0;
  for (let i = W + 1; i < gray.length - W - 1; i += 7) edge += Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - W]);
  const busy = edge / (gray.length / 7);
  if (busy < 6 && best.mean < 0.6) best = { kind: 'empty', score: 1, theme: tg && tg.d < 40 ? tg.id : preferredTheme, busy };
  best.bg = bg0;
  return best;
}

// ---------- OCR ----------
let ocrWorker = null;
async function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
export async function getOcr() {
  if (ocrWorker) return ocrWorker;
  await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  ocrWorker = await window.Tesseract.createWorker('heb');
  return ocrWorker;
}
export async function closeOcr() { if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; } }

export const MONTHS = /(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/;
function cleanLine(t) {
  return t.replace(/[|_~^`]/g, '').replace(/\s+/g, ' ').replace(/^[\s\-–—.,:;]+|[\s\-–—.,:;]+$/g, '').trim();
}
// bullets come back as stray dots/letters between items
function asBullets(t) {
  const parts = t.split(/\s*[•·°●+*]\s*|\s+[.oe]\s+|^[.oe]\s+|\s+[.oe]$/).map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

/** read the page's text lines: [{text, y (0..1 center), h (0..1 height), x0, x1}] */
export async function readText(bitmap, { photoBg = false, bottomBand = null, topBand = null } = {}) {
  const worker = await getOcr();
  // crop: read only a horizontal strip of the page (y0..y1 as page fractions)
  const pass = async (W0, keep, invert = false, crop = null, raw = false, psm = null) => {
    const W = Math.min(W0, bitmap.width);
    const FH = Math.round(W * bitmap.height / bitmap.width);
    const cy0 = crop ? Math.round(FH * crop[0]) : 0;
    const H = crop ? Math.round(FH * (crop[1] - crop[0])) : FH;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bitmap, 0, -cy0, W, FH);
    if (!raw) {
    // light pages: darken colored/soft lettering (gold, grey) so OCR sees it
    const img = cx.getImageData(0, 0, W, H), d = img.data;
    let lum = 0;
    for (let i = 0; i < d.length; i += 4 * 97) lum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const avgLum = lum / (d.length / (4 * 97));
    if (!invert && avgLum < 110) {
      // dark pages: light lettering becomes dark ink on white
      for (let i = 0; i < d.length; i += 4) {
        const v = 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        const o = v > 215 ? 255 : Math.max(0, v * 0.55 - 20);
        d[i] = d[i + 1] = d[i + 2] = o;
      }
      cx.putImageData(img, 0, 0);
    } else if (invert) {
      // white titles over photos: keep only very bright pixels as dark ink
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.min(d[i], d[i + 1], d[i + 2]);
        const o = v > 225 ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = o;
      }
      cx.putImageData(img, 0, 0);
    } else if (lum / (d.length / (4 * 97)) > 150) {
      for (let i = 0; i < d.length; i += 4) {
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const o = v > 215 ? 255 : Math.max(0, v * 0.55 - 20);
        d[i] = d[i + 1] = d[i + 2] = o;
      }
      cx.putImageData(img, 0, 0);
    }
    // erase long straight lines (decorative frames) that run through text
    {
      const im2 = cx.getImageData(0, 0, W, H), d2 = im2.data;
      // a frame line is one long unbroken run; letters always have gaps.
      // erase only those runs themselves – never whole rows/columns (that would wipe text too)
      const eraseRuns = (n, count, at, minLen) => {
        for (let a = 0; a < count; a++) {
          let start = -1;
          for (let t = 0; t <= n; t++) {
            const dark = t < n && d2[at(a, t)] < 200;
            if (dark && start < 0) start = t;
            if (!dark && start >= 0) {
              if (t - start > minLen) for (let u = start; u < t; u++) { const i = at(a, u); d2[i] = d2[i + 1] = d2[i + 2] = 255; }
              start = -1;
            }
          }
        }
      };
      // horizontal frame lines are thin: only erase rows whose long run is a thin stroke
      eraseRuns(W, H, (y, x) => (y * W + x) * 4, W * 0.4);
      cx.putImageData(im2, 0, 0);
    }
    }
    if (psm) await worker.setParameters({ tessedit_pageseg_mode: psm });
    let data;
    try { ({ data } = await worker.recognize(c, {}, { blocks: true })); }
    finally { if (psm) await worker.setParameters({ tessedit_pageseg_mode: '3' }); }
    const out = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      const text = cleanLine(l.text || '');
      if (!text) continue;
      const yc = (cy0 + (l.bbox.y0 + l.bbox.y1) / 2) / FH;
      // captions/labels sit in the margins and are read with less confidence (bullet dots confuse OCR)
      const margin = yc > 0.85 || yc < 0.12;
      if (l.confidence < (margin ? 25 : 72)) continue; // margin lines get a second check below
      const chars = text.replace(/\s/g, '');
      const good = (chars.match(/[\u05D0-\u05EA0-9]/g) || []).length;
      const okPunct = (chars.match(margin ? /[,.'"״׳\-–—:•·+*=]/g : /[,.'"״׳\-–—:!?()•·+*°]/g) || []).length;
      if (good < 2 || (good + okPunct) / chars.length < (margin ? 0.88 : 0.85)) continue; // noise read from inside photos
      const toks = text.split(/\s+/).filter(t => /[\u05D0-\u05EA0-9]/.test(t)); // bullet marks like '+' or '=' are not words
      const longToks = toks.filter(t => t.replace(/[^\u05D0-\u05EA0-9]/g, '').length >= 2).length;
      if (toks.length >= 3 && longToks / toks.length < 0.6) continue; // scattered letters = misread decoration/handwriting
      const hebLetters = (text.match(/[\u05D0-\u05EA]/g) || []).length;
      // misreads of photo texture look like "היהי הלה הייה" / "ממממ": lots of ה/ו/י and repeated letters
      const hvy = (text.match(/[הוי]/g) || []).length;
      if (hebLetters >= 6 && hvy / hebLetters > 0.42) continue;
      if (/([\u05D0-\u05EA])\1\1/.test(text)) continue;
      if (margin && (hebLetters < 4 || !toks.some(t => t.replace(/[^\u05D0-\u05EA]/g, '').length >= 3)) && !/\d{4}/.test(text)) continue;
      // big gaps between words = separate bullet items
      let items = null;
      const words = (l.words || []).filter(w => w.text && /[\u05D0-\u05EA0-9]/.test(w.text)).sort((a, b) => b.bbox.x1 - a.bbox.x1);
      if (words.length >= 2) {
        const lh = l.bbox.y1 - l.bbox.y0;
        const groups = [[words[0]]];
        for (let i = 1; i < words.length; i++) {
          const gapPx = words[i - 1].bbox.x0 - words[i].bbox.x1;
          if (gapPx > lh * 0.8) groups.push([]);
          groups[groups.length - 1].push(words[i]);
        }
        if (groups.length >= 2) items = groups.map(g => g.map(w => cleanLine(w.text)).join(' ').replace(/^[•·°●+*.oe]\s*/, '').trim()).filter(Boolean);
      }
      // a shaky margin reading is kept only if it looks like a real bullet list
      if (margin && l.confidence < 50 && !(items && items.length >= 2 && items.every(it => (it.match(/[\u05D0-\u05EA]/g) || []).length >= 3))) continue;
      const line = { text, items, y: yc, h: (l.bbox.y1 - l.bbox.y0) / FH, x0: l.bbox.x0 / W, x1: l.bbox.x1 / W, conf: l.confidence };
      if (keep(line)) out.push(line);
    }
    return out;
  };
  // tesseract reads best when letters are ~30-60 px tall
  const small = await pass(1600, l => l.h < 0.05);
  const big = await pass(640, l => l.h >= 0.025);
  if (photoBg) {
    big.push(...await pass(640, l => l.h >= 0.025, true));
    small.push(...await pass(1200, l => l.h < 0.05, true));
  }
  // captions and labels live in the page margins: read those strips on their own (much more reliable)
  const strips = [];
  // the exact empty margin band under the photos (known from the style) reads best as one text block
  const bb = bottomBand || [0.86, 1], tb = topBand || [0, 0.13];
  for (const W0 of [1600, 2000]) {
    strips.push(...await pass(W0, () => true, false, bb, true, '6'));
    strips.push(...await pass(W0, () => true, false, bb, false, '6'));
    if (photoBg) strips.push(...await pass(W0, () => true, true, bb, false, '6'));
  }
  strips.push(...await pass(1600, () => true, false, tb, true, '6'));
  small.push(...strips);
  // prefer the big-pass reading where both passes saw the same line
  // where both passes saw the same line, keep the more confident reading
  // the fuller reading wins (letters x confidence), not just the most confident fragment
  const weight = l => (l.text.match(/[\u05D0-\u05EA]/g) || []).length * l.conf;
  const all = [...big, ...small].sort((a, b) => weight(b) - weight(a));
  const out = [];
  // same line = same height on the page AND overlapping sideways (a page number beside a caption is not a duplicate)
  for (const l of all) if (!out.some(o => Math.abs(o.y - l.y) < Math.max(o.h, l.h) * 0.6 && Math.min(o.x1, l.x1) - Math.max(o.x0, l.x0) > 0.3 * Math.min(o.x1 - o.x0, l.x1 - l.x0))) out.push(l);
  return out;
}

/** assign OCR lines to a page's text fields */
export function assignText(page, lines, { theme, format, bleed, boxes = [], isCover }) {
  const t = THEMES[theme] || THEMES.classic;
  const H = format.h + 2 * bleed, Mfrac = t.margin / H, Bfrac = bleed / H;
  const inBox = l => boxes.some(b => l.y >= b.y && l.y <= b.y + b.h && ((l.x0 + l.x1) / 2) >= b.x && ((l.x0 + l.x1) / 2) <= b.x + b.w);
  const handwriting = ['Amatic SC'].includes(t.font);
  const rest = lines.filter(l => !/^\d{1,3}$/.test(l.text) && (!handwriting || l.conf >= 88)); // drop page numbers / unsure handwriting
  const fullPage = boxes.length === 1 && boxes[0].w > 0.95 && boxes[0].h > 0.95;
  const bottom = rest.filter(l => l.y > 1 - Bfrac - Mfrac * 1.4 && (fullPage || !inBox(l)));
  const top = rest.filter(l => l.y < Bfrac + Mfrac * 0.95 && (fullPage || !inBox(l)));
  const out = {};
  const setCaption = ls => {
    if (!ls.length) return;
    ls.sort((a, b) => a.y - b.y);
    const txt = ls.map(l => l.text).join(' ');
    if (page.type === 'photos' && MONTHS.test(txt) && /\d{4}/.test(txt) && txt.length < 30) { out.showDate = true; return; }
    const heb = t2 => (t2.match(/[\u05D0-\u05EA]/g) || []).length;
    if (heb(txt) < 2) return; // numbers / dots only: page number or noise
    const fromGaps = ls.flatMap(l => l.items || []).filter(it => heb(it) >= 3); // drop page numbers / fragments
    // bullet dots often come back as a lone digit or symbol between the items ("3 מפלי טראון 5 פלאכאו")
    const tokSplit = t2 => {
      const toks = t2.split(/\s+/).filter(Boolean);
      const isSep = x => (x.length === 1 && !/[\u05D0-\u05EA]/.test(x)) || /^[•·°●+*=.oe]+$/.test(x);
      const seps = toks.filter(isSep).length;
      if (seps < 2 && !(seps === 1 && isSep(toks[0]))) return null;
      const groups = [[]];
      for (const x of toks) { if (isSep(x)) { if (groups[groups.length - 1].length) groups.push([]); } else groups[groups.length - 1].push(x); }
      const items3 = groups.map(g2 => g2.join(' ')).filter(it => heb(it) >= 3);
      return items3.length >= 2 ? items3 : null;
    };
    const b = tokSplit(txt) || (fromGaps.length >= 2 && ls.every(l => l.items) ? fromGaps : asBullets(txt));
    const items2 = b ? b.filter(it => heb(it) >= 3) : null;
    if (items2 && items2.length >= 2) { out.caption = items2.join(', '); out.captionBullets = true; return; }
    // a plain caption needs real words (or a very confident reading)
    const plain = txt.replace(/^\d{1,3}\s+|\s+\d{1,3}$/g, '');
    const realWords = plain.split(/\s+/).filter(w => heb(w) >= 3).length;
    if (realWords >= 2 || Math.max(...ls.map(l => l.conf)) >= 85) out.caption = plain;
  };
  if (page.type === 'photos') {
    setCaption(bottom);
    if (top.length && t.labels) out.label = top.map(l => l.text).join(' ');
    const big = rest.filter(l => !bottom.includes(l) && !top.includes(l) && l.h > 0.035 && (page.template === 'solo-full' || !inBox(l)));
    if (big.length) {
      big.sort((a, b) => a.y - b.y);
      out.title = big[0].text;
      if (big[1]) out.subtitle = big[1].text;
    }
    return out;
  }
  // cover / chapter / closing page: biggest line is the title, the next ones follow
  setCaption(bottom);
  const fullPhoto = boxes.length === 1 && boxes[0].w > 0.95 && boxes[0].h > 0.95;
  const body = rest.filter(l => !bottom.includes(l) && (fullPhoto || !inBox(l))).sort((a, b) => b.h - a.h);
  if (!body.length) return out;
  const title = body[0];
  out.title = title.text;
  const below = body.slice(1).filter(l => l.y > title.y).sort((a, b) => a.y - b.y);
  if (below[0]) out.subtitle = below[0].text;
  if (below[1] && isCover) out.subtitle2 = below[1].text;
  return out;
}

export function boxesFor(templateId, theme, format, bleed) {
  const tpl = templateById(templateId);
  const G = geometry(THEMES[theme] || THEMES.classic, format, bleed, 1);
  const bs = tpl ? templateBoxes(tpl, G) : [heroBox(THEMES[theme] || THEMES.classic, G)];
  return bs.map(b => ({ x: b.x / G.W, y: b.y / G.H, w: b.w / G.W, h: b.h / G.H }));
}
