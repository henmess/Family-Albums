// Draws album pages onto a canvas. The same code is used for the on-screen
// preview (small thumbnails), the page editor and the print PDF.
import { templateById, rng } from './layout.js?v=23';

/*
 Theme fields
  frame:      none | line | white | polaroid | gold | film
  bgStyle:    plain | paper | kraft | watercolor | navygold | film | linen
  deco:       tape | washi | doodles | leaves | goldCorners | blobs | bars
  shapeSolo:  shape used for single photos / chapter pages (arch | circle | round)
  cover:      framed | full | magazine
*/
export const THEMES = {
  classic: {
    name: 'קלאסי', desc: 'לבן נקי, מסגרות דקות, אלגנטי',
    bg: '#fbf9f4', text: '#2c2a26', accent: '#b08d57',
    font: 'Frank Ruhl Libre', titleWeight: 700, bodyWeight: 400,
    margin: 14, gap: 4, frame: 'line', radius: 0, shadow: false, tilt: 0,
    bgStyle: 'plain', deco: [], cover: 'framed', pageNumbers: true, pageDeco: ['frameLines', 'dateLine'],
  },
  gallery: {
    name: 'גלריה', desc: 'הרבה אוויר, תמונות כמו בתערוכה',
    bg: '#ffffff', text: '#1d1d1b', accent: '#9a8f80',
    font: 'Bellefair', titleWeight: 400, bodyWeight: 400,
    margin: 22, gap: 7, frame: 'none', radius: 0, shadow: true, tilt: 0,
    bgStyle: 'plain', deco: [], cover: 'framed', pageNumbers: true, labels: true, pageDeco: ['dateLine', 'block:soft'],
  },
  gold: {
    name: 'זהב חגיגי', desc: 'כחול לילה, מסגרות זהב ועיטורים',
    bg: '#13233f', text: '#f3e7c4', accent: '#d8b866',
    font: 'Frank Ruhl Libre', titleWeight: 700, bodyWeight: 400,
    margin: 17, gap: 6, frame: 'gold', radius: 0, shadow: true, tilt: 0,
    bgStyle: 'navygold', deco: ['goldCorners'], shapeSolo: 'arch', cover: 'framed', goldText: true, pageDeco: ['dateLine'],
  },
  boho: {
    name: 'בוהו טבעי', desc: 'גווני אדמה, קשתות ועלים',
    bg: '#f4ece1', text: '#5b4636', accent: '#c0714f', accent2: '#8a9a7b',
    font: 'Suez One', titleWeight: 400, bodyWeight: 400,
    margin: 15, gap: 5, frame: 'none', radius: 3, shadow: false, tilt: 0,
    bgStyle: 'linen', deco: ['leaves'], shapeSolo: 'arch', archChance: 0.45, cover: 'framed', labels: true, pageDeco: ['block:arch', 'dateLine'],
  },
  watercolor: {
    name: 'צבעי מים', desc: 'כתמי צבע עדינים בצבעי התמונות',
    bg: '#fdfbf7', text: '#3b3a4a', accent: 'auto',
    font: 'Bellefair', titleWeight: 400, bodyWeight: 400,
    margin: 15, gap: 6, frame: 'white', radius: 0, shadow: true, tilt: 1.2,
    bgStyle: 'watercolor', deco: [], cover: 'framed', labels: true, pageDeco: ['dateLine'],
  },
  scrapbook: {
    name: 'סקרפבוק', desc: 'נייר קראפט, וואשי טייפ וקשקושים',
    bg: '#d8c3a0', text: '#3e2f22', accent: '#d2553f', accent2: '#3f7f8c',
    font: 'Amatic SC', titleWeight: 700, bodyWeight: 700,
    margin: 14, gap: 9, frame: 'white', radius: 0, shadow: true, tilt: 5,
    bgStyle: 'kraft', deco: ['washi', 'doodles'], cover: 'framed', allowOverlap: true, labels: true, pageDeco: ['dateLine'],
  },
  vintage: {
    name: 'וינטג׳ פולארויד', desc: 'נייר ישן, פולארואידים וסלוטייפ',
    bg: '#eee3cc', text: '#4a3b2a', accent: '#a0522d',
    font: 'Amatic SC', titleWeight: 700, bodyWeight: 700,
    margin: 16, gap: 9, frame: 'polaroid', radius: 0, shadow: true, tilt: 4,
    bgStyle: 'paper', deco: ['tape'], cover: 'framed', allowOverlap: true, pageDeco: ['dateLine'],
  },
  film: {
    name: 'סרט קולנוע', desc: 'רקע כהה ופריימים של פילם',
    bg: '#101010', text: '#f2efe8', accent: '#e8a33d',
    font: 'Karantina', titleWeight: 700, bodyWeight: 400,
    margin: 12, gap: 4, frame: 'film', radius: 0, shadow: false, tilt: 0,
    bgStyle: 'film', deco: [], cover: 'full', fullBleedSolo: true, labels: true, pageDeco: ['dateLine', 'filmEdge'],
  },
  modern: {
    name: 'מודרני כהה', desc: 'רקע שחור, תמונות מלאות, דרמטי',
    bg: '#141414', text: '#f4f1ea', accent: '#e9b44c',
    font: 'Rubik', titleWeight: 700, bodyWeight: 300,
    margin: 9, gap: 2.5, frame: 'none', radius: 0, shadow: false, tilt: 0,
    bgStyle: 'plain', deco: [], cover: 'full', fullBleedSolo: true, pageDeco: ['block:rect', 'bigNumber', 'dateLine'],
  },
  colorful: {
    name: 'צבעוני', desc: 'צבעי רקע מהתמונות, פינות מעוגלות',
    bg: 'auto', text: '#2a2a2a', accent: 'auto',
    font: 'Secular One', titleWeight: 400, bodyWeight: 400,
    margin: 13, gap: 5, frame: 'none', radius: 5, shadow: true, tilt: 0,
    bgStyle: 'plain', deco: ['blobs'], shapeSolo: 'round', cover: 'framed', pageDeco: ['block:circle', 'dateLine'],
  },
  magazine: {
    name: 'מגזין', desc: 'מודרני וצבעוני: בלוקים של צבע ומספרים ענקיים',
    bg: '#ffffff', text: '#141414', accent: 'cycle', accentCycle: ['#ff4d6d', '#3a86ff', '#ffbe0b', '#06d6a0', '#8338ec', '#fb5607'],
    font: 'Heebo', titleWeight: 900, bodyWeight: 400,
    margin: 11, gap: 3.5, frame: 'offset', radius: 0, shadow: false, tilt: 0,
    bgStyle: 'plain', deco: [], cover: 'magazine', fullBleedSolo: true, labels: true, titlePanel: false,
    pageDeco: ['block:diag', 'bigNumber', 'sideLabel'],
  },
  pastel: {
    name: 'פסטל', desc: 'רקעים פסטליים מתחלפים ומסגרות לבנות עגולות',
    bg: 'cycle', bgCycle: ['#fde2e4', '#dff0ea', '#dfe7fd', '#fff1d6', '#ece4f7'], text: '#4a4453', accent: '#e07a9b', accent2: '#7aa6c2',
    font: 'Varela Round', titleWeight: 400, bodyWeight: 400,
    margin: 14, gap: 6, frame: 'white', radius: 6, shadow: true, tilt: 0,
    bgStyle: 'plain', deco: ['confetti'], shapeSolo: 'round', cover: 'framed', labels: true, pageDeco: ['dateLine'],
  },
  mono: {
    name: 'שחור-לבן אלגנטי', desc: 'כל התמונות בשחור-לבן, טיפוגרפיה עדינה',
    bg: '#f6f5f2', text: '#1a1a1a', accent: '#1a1a1a',
    font: 'Bellefair', titleWeight: 400, bodyWeight: 400,
    margin: 17, gap: 5, frame: 'none', radius: 0, shadow: false, tilt: 0, grayscale: true,
    bgStyle: 'plain', deco: [], cover: 'framed', pageNumbers: true, labels: true, pageDeco: ['frameLines', 'dateLine'],
  },
  pop: {
    name: 'פופ צבעוני', desc: 'צבעים עזים, נקודות קומיקס ומסגרות שחורות',
    bg: 'cycle', bgCycle: ['#ffd23f', '#3bceac', '#ff7eb6', '#64b5ff', '#ff9f43'], text: '#111111', accent: '#111111', accent2: '#ffffff',
    font: 'Secular One', titleWeight: 400, bodyWeight: 400,
    margin: 13, gap: 7, frame: 'comic', radius: 0, shadow: false, tilt: 2.5,
    bgStyle: 'halftone', deco: [], cover: 'framed', labels: true, pageDeco: ['dateLine'],
  },
  romantic: {
    name: 'רומנטי', desc: 'ורוד עדין, אליפסות ונגיעות זהב',
    bg: '#f9ece8', text: '#6b4a4a', accent: '#c29a5b', accent2: '#e3aaa2',
    font: 'Frank Ruhl Libre', titleWeight: 400, bodyWeight: 400,
    margin: 16, gap: 6, frame: 'white', radius: 0, shadow: true, tilt: 0,
    bgStyle: 'paper', deco: ['hearts'], shapeSolo: 'oval', ovalChance: 0.3, cover: 'framed', labels: true, pageDeco: ['frameLines', 'dateLine'],
  },
};
for (const [id, t] of Object.entries(THEMES)) t.id = id;

export const FONTS = ['Frank Ruhl Libre', 'Rubik', 'Amatic SC', 'Secular One', 'Heebo', 'Bellefair', 'Suez One', 'Karantina', 'Varela Round'];

export async function ensureFonts() {
  if (!document.fonts) return;
  await Promise.all(FONTS.flatMap(f => [400, 700, 900].map(w =>
    document.fonts.load(`${w} 40px "${f}"`, 'אבגabc').catch(() => {}))));
}

export const BG_SWATCHES = ['#ffffff', '#fbf9f4', '#f4ece1', '#eee3cc', '#e8eef0', '#f6e1e1', '#e3ecdf', '#13233f', '#2b2b2b', '#101010'];

// ---------- color helpers ----------
const mix = (c, d, t) => c.map((v, i) => Math.round(v * (1 - t) + d[i] * t));
const css = (c, a = 1) => a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

export function effectiveTheme(page, albumTheme) {
  return (page.style && THEMES[page.style]) || albumTheme;
}

function pageColors(theme, page, photosById) {
  const first = photosById.get(page.photos?.[0]);
  const base = first ? first.color : [200, 170, 140];
  let c;
  if (theme.bg === 'auto') {
    const deep = mix(base, [20, 20, 30], 0.45);
    c = { bg: css(mix(base, [255, 255, 255], 0.66)), text: css(mix(base, [15, 15, 20], 0.75)), accent: css(deep) };
  } else {
    const pick = arr => arr[Math.floor((page.variant ?? 0.5) * 997) % arr.length];
    c = {
      bg: theme.bg === 'cycle' ? pick(theme.bgCycle) : theme.bg,
      text: theme.text,
      accent: theme.accent === 'auto' ? css(mix(base, [40, 40, 60], 0.35)) : theme.accent === 'cycle' ? pick(theme.accentCycle) : theme.accent,
    };
  }
  c.accent2 = theme.accent2 || c.accent;
  if (page.bg) {
    c.bg = page.bg;
    const dark = lum(hex2rgb(page.bg)) < 0.45;
    if (dark !== (lum(hex2rgb(toHex(theme.bg === 'auto' || theme.bg === 'cycle' ? '#ffffff' : theme.bg))) < 0.45)) {
      c.text = dark ? '#f4f1ea' : '#2a2622';
    }
  }
  c.dark = lum(hex2rgb(toHex(c.bg))) < 0.45;
  return c;
}
function toHex(c) {
  if (c.startsWith('#')) return c;
  const m = c.match(/\d+/g) || [255, 255, 255];
  return '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('');
}

function goldGradient(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#8a6a2f'); g.addColorStop(0.25, '#e9d08c'); g.addColorStop(0.5, '#b38d3e');
  g.addColorStop(0.75, '#f5e4a9'); g.addColorStop(1, '#9a7833');
  return g;
}

// ---------- drawing primitives ----------
function shapePath(ctx, shape, x, y, w, h, r = 0) {
  ctx.beginPath();
  if (shape === 'circle') {
    const d = Math.min(w, h);
    ctx.ellipse(x + w / 2, y + h / 2, d / 2, d / 2, 0, 0, Math.PI * 2);
  } else if (shape === 'oval') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape === 'arch') {
    const rr = Math.min(w / 2, h * 0.6);
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + rr);
    ctx.arc(x + w / 2, y + rr, w / 2, Math.PI, 0);
    if (rr < w / 2) { /* wide arch fallback */ }
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  } else {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
// circles are drawn as a centered square
function shapeBox(shape, x, y, w, h) {
  if (shape !== 'circle') return { x, y, w, h };
  const d = Math.min(w, h);
  return { x: x + (w - d) / 2, y: y + (h - d) / 2, w: d, h: d };
}

function drawCover(ctx, img, photo, x, y, w, h, crop) {
  const iw = img.width, ih = img.height;
  const zoom = Math.max(1, crop?.zoom || 1);
  const s = Math.max(w / iw, h / ih) * zoom;
  const sw = w / s, sh = h / s;
  const f = crop && crop.x != null ? crop : (photo?.focal || { x: 0.5, y: 0.5 });
  const sx = Math.max(0, Math.min(iw - sw, f.x * iw - sw / 2));
  const sy = Math.max(0, Math.min(ih - sh, f.y * ih - sh / 2));
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// draws the photo, in black & white for themes that ask for it
function paint(ctx, img, photo, x, y, w, h, crop, theme) {
  if (!theme?.grayscale) { drawCover(ctx, img, photo, x, y, w, h, crop); return; }
  const cw = Math.max(1, Math.round(w)), ch = Math.max(1, Math.round(h));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const t = c.getContext('2d', { willReadFrequently: true });
  t.imageSmoothingQuality = 'high';
  drawCover(t, img, photo, 0, 0, cw, ch, crop);
  const d = t.getImageData(0, 0, cw, ch);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    let v = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    v = Math.max(0, Math.min(255, (v - 128) * 1.08 + 128)); // a touch more contrast
    a[i] = a[i + 1] = a[i + 2] = v;
  }
  t.putImageData(d, 0, 0);
  ctx.drawImage(c, x, y, w, h);
}

const noiseCache = new Map();
function noisePattern(ctx, scale, tint = [1, 0.92, 0.8], alpha = 26, seed = 7) {
  const key = `${Math.round(scale * 10)}|${tint}|${alpha}|${seed}`;
  if (!noiseCache.has(key)) {
    const size = Math.round(160 * Math.max(1, scale / 4));
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const d = x.createImageData(size, size);
    const r = rng(seed);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 120 + r() * 100;
      d.data[i] = v * tint[0]; d.data[i + 1] = v * tint[1]; d.data[i + 2] = v * tint[2];
      d.data[i + 3] = r() * alpha;
    }
    x.putImageData(d, 0, 0);
    noiseCache.set(key, c);
  }
  return ctx.createPattern(noiseCache.get(key), 'repeat');
}

function fitFont(ctx, text, weight, family, size, maxW) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px "${family}"`;
    if (ctx.measureText(text).width <= maxW) break;
    s *= 0.92;
  } while (s > 6);
  return s;
}

// ---------- movable / resizable text groups ----------
// page.text[id] = { dx, dy (fractions of the page), scale, top (frozen auto placement) }
let textCollector = null;

function textGroup(ctx, g, id, ax, ay, draw) {
  const t = g.page.text?.[id] || {};
  const dx = (t.dx || 0) * g.PW, dy = (t.dy || 0) * g.PH, s = t.scale || 1;
  const boxes = [];
  const prev = textCollector;
  textCollector = boxes;
  ctx.save();
  ctx.translate(ax + dx, ay + dy); ctx.scale(s, s); ctx.translate(-ax, -ay);
  try { draw(); } finally { ctx.restore(); textCollector = prev; }
  if (!boxes.length) return;
  const x1 = Math.min(...boxes.map(b => b.x)), y1 = Math.min(...boxes.map(b => b.y));
  const x2 = Math.max(...boxes.map(b => b.x + b.w)), y2 = Math.max(...boxes.map(b => b.y + b.h));
  const tx = v => ax + dx + (v - ax) * s, ty = v => ay + dy + (v - ay) * s;
  const pad = 1.2 * g.k;
  g.texts.push({ id, x: tx(x1) - pad, y: ty(y1) - pad, w: (x2 - x1) * s + 2 * pad, h: (y2 - y1) * s + 2 * pad, top: g.autoTop?.[id] });
}

// where is the subject of a full-page photo (0 = top, 1 = bottom)?
function subjectY(page, g) {
  const crop = g.cropOf(0);
  if (crop && crop.y != null) return crop.y;
  return g.photoOf(page.photos[0])?.focal?.y ?? 0.45;
}
// decide (once) whether a text sits at the top; respects a placement frozen by the user
function placeTop(page, g, id, autoTop) {
  const t = page.text?.[id];
  const top = t && t.top != null ? t.top : autoTop;
  (g.autoTop ||= {})[id] = top;
  return top;
}

function drawText(ctx, text, x, y, { size, weight, family, color, maxW, align = 'center', shadow = false, baseline = 'middle', gold = false, outline = null }) {
  if (!text) return 0;
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  const s = fitFont(ctx, text, weight, family, size, maxW);
  const tw = ctx.measureText(text).width;
  const x0 = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
  if (textCollector) textCollector.push({ x: x0, y: y - s * 0.62, w: tw, h: s * 1.24 });
  if (gold) {
    ctx.fillStyle = goldGradient(ctx, x0, y - s / 2, tw, s);
  } else ctx.fillStyle = color;
  if (shadow) {
    // readable over any photo without darkening it: a soft halo + a tight shadow
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = s * 0.45; ctx.shadowOffsetY = s * 0.04;
    ctx.fillText(text, x, y);
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = s * 0.1; ctx.shadowOffsetY = s * 0.03;
  }
  if (outline) {
    // a thin line around the letters so small text stays visible on busy photos
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = outline; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, s * 0.16);
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
  ctx.fillText(text, x, y);
  ctx.restore();
  return s;
}

// ---------- decorations ----------
function drawTape(ctx, x, y, w, h, k, r, washi, colors) {
  const tw = Math.min(w, h) * (washi ? 0.36 : 0.32), th = tw * 0.27;
  const corner = washi && r() < 0.5;
  ctx.save();
  if (corner) {
    ctx.translate(x + (r() < 0.5 ? 0 : w), y);
    ctx.rotate((r() < 0.5 ? -1 : 1) * Math.PI / 4);
  } else {
    ctx.translate(x + w / 2 + (r() - 0.5) * w * 0.2, y + th * 0.1);
    ctx.rotate((r() - 0.5) * 0.3);
  }
  ctx.shadowColor = 'rgba(0,0,0,0.15)'; ctx.shadowBlur = 0.6 * k;
  if (washi) {
    const palette = [colors.accent, colors.accent2, '#e9c46a', '#f4a6a6', '#9cc5a1'];
    const base = palette[Math.floor(r() * palette.length)];
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = base;
    ctx.fillRect(-tw / 2, -th / 2, tw, th);
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffffff';
    const pattern = Math.floor(r() * 3);
    ctx.save();
    ctx.beginPath(); ctx.rect(-tw / 2, -th / 2, tw, th); ctx.clip();
    if (pattern === 0) for (let i = -tw; i < tw; i += th * 0.6) { ctx.beginPath(); ctx.moveTo(i, -th); ctx.lineTo(i + th, th); ctx.lineTo(i + th * 1.25, th); ctx.lineTo(i + th * 0.25, -th); ctx.fill(); }
    else if (pattern === 1) for (let i = -tw / 2 + th * 0.3; i < tw / 2; i += th * 0.55) for (let j = -th / 4; j <= th / 4; j += th / 2) { ctx.beginPath(); ctx.arc(i + (j > 0 ? th * 0.27 : 0), j, th * 0.09, 0, 7); ctx.fill(); }
    else ctx.fillRect(-tw / 2, -th * 0.1, tw, th * 0.2);
    ctx.restore();
    // torn ends
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = 'rgba(245, 235, 200, 0.72)';
    ctx.fillRect(-tw / 2, -th / 2, tw, th);
  }
  ctx.restore();
}

function drawLeafBranch(ctx, x, y, len, angle, k, colors, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = colors.accent2;
  ctx.lineWidth = 0.45 * k;
  ctx.lineCap = 'round';
  const bend = len * 0.18;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -bend, len, 0); ctx.stroke();
  const n = 7;
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const px = len * t, py = -bend * 4 * t * (1 - t) * 0.5;
    const size = len * (0.13 - t * 0.05);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(side * (0.75 + r() * 0.2) - 0.15);
      ctx.fillStyle = (i + (side > 0 ? 1 : 0)) % 4 === 0 ? colors.accent : colors.accent2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(size * 0.9, 0, size, size * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = colors.accent2;
  ctx.beginPath(); ctx.ellipse(len + len * 0.07, 0, len * 0.09, len * 0.035, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawDoodle(ctx, kind, x, y, s, color, k) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 0.45 * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'heart') {
    ctx.moveTo(0, s * 0.35);
    ctx.bezierCurveTo(-s * 0.9, -s * 0.2, -s * 0.35, -s * 0.85, 0, -s * 0.3);
    ctx.bezierCurveTo(s * 0.35, -s * 0.85, s * 0.9, -s * 0.2, 0, s * 0.35);
    ctx.stroke();
  } else if (kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? s * 0.22 : s * 0.55;
      i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.stroke();
  } else if (kind === 'swirl') {
    for (let a = 0; a < Math.PI * 5; a += 0.2) {
      const rr = s * 0.05 * a;
      a ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(0, 0);
    }
    ctx.stroke();
  } else if (kind === 'dots') {
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(i * s * 0.4 - s * 0.4, 0, s * 0.07, 0, 7); ctx.fill(); }
  } else if (kind === 'arrow') {
    ctx.moveTo(-s * 0.6, s * 0.2); ctx.quadraticCurveTo(0, -s * 0.5, s * 0.6, 0);
    ctx.moveTo(s * 0.6, 0); ctx.lineTo(s * 0.3, -s * 0.12); ctx.moveTo(s * 0.6, 0); ctx.lineTo(s * 0.38, s * 0.2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGoldCorners(ctx, x, y, w, h, k) {
  ctx.save();
  ctx.strokeStyle = goldGradient(ctx, x, y, w, h);
  ctx.fillStyle = goldGradient(ctx, x, y, w, h);
  ctx.lineWidth = 0.35 * k;
  const L = 12 * k;
  const corners = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * L);
    ctx.moveTo(cx + sx * 2.2 * k, cy + sy * 2.2 * k);
    ctx.quadraticCurveTo(cx + sx * 7 * k, cy + sy * 1 * k, cx + sx * 9 * k, cy + sy * 4 * k);
    ctx.moveTo(cx + sx * 2.2 * k, cy + sy * 2.2 * k);
    ctx.quadraticCurveTo(cx + sx * 1 * k, cy + sy * 7 * k, cx + sx * 4 * k, cy + sy * 9 * k);
    ctx.stroke();
    ctx.save();
    ctx.translate(cx + sx * 2.2 * k, cy + sy * 2.2 * k); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-0.9 * k, -0.9 * k, 1.8 * k, 1.8 * k);
    ctx.restore();
  }
  ctx.restore();
}

function drawBackground(ctx, W, H, colors, theme, k, r, env, page) {
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);
  const style = theme.bgStyle;
  if (style === 'paper' || style === 'kraft') {
    ctx.fillStyle = noisePattern(ctx, k, style === 'kraft' ? [0.95, 0.8, 0.6] : [1, 0.92, 0.8], style === 'kraft' ? 40 : 26);
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, style === 'kraft' ? 'rgba(80,50,20,0.25)' : 'rgba(90,60,20,0.22)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (style === 'kraft') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      const step = 6 * k;
      for (let yy = step / 2; yy < H; yy += step) for (let xx = step / 2; xx < W; xx += step) { ctx.beginPath(); ctx.arc(xx, yy, 0.22 * k, 0, 7); ctx.fill(); }
    }
  } else if (style === 'linen') {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = colors.dark ? '#fff' : '#6b5440';
    ctx.lineWidth = 0.15 * k;
    for (let i = 0; i < W + H; i += 0.9 * k) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - H, H); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = noisePattern(ctx, k, [1, 0.95, 0.88], 14, 3);
    ctx.fillRect(0, 0, W, H);
  } else if (style === 'watercolor') {
    const cols = (page.photos || []).map(id => env.photosById.get(id)?.color).filter(Boolean);
    if (!cols.length) cols.push([170, 190, 210], [220, 180, 170]);
    const blobs = 3 + Math.floor(r() * 2);
    for (let b = 0; b < blobs; b++) {
      const c = mix(cols[b % cols.length], [255, 255, 255], 0.35);
      const cx = (r() < 0.5 ? 0.12 + r() * 0.3 : 0.58 + r() * 0.3) * W;
      const cy = (b / blobs + r() * 0.25) * H;
      const R = (0.22 + r() * 0.18) * Math.min(W, H);
      for (let i = 0; i < 9; i++) {
        const ox = (r() - 0.5) * R * 0.7, oy = (r() - 0.5) * R * 0.7, rr = R * (0.45 + r() * 0.5);
        const g = ctx.createRadialGradient(cx + ox, cy + oy, rr * 0.1, cx + ox, cy + oy, rr);
        g.addColorStop(0, css(c, 0.16)); g.addColorStop(0.75, css(c, 0.1)); g.addColorStop(0.95, css(mix(c, [0, 0, 0], 0.15), 0.12)); g.addColorStop(1, css(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx + ox, cy + oy, rr, 0, 7); ctx.fill();
      }
    }
    ctx.fillStyle = noisePattern(ctx, k, [1, 0.97, 0.92], 16, 11);
    ctx.fillRect(0, 0, W, H);
  } else if (style === 'navygold') {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.1, W / 2, H / 2, Math.max(W, H) * 0.8);
    g.addColorStop(0, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = noisePattern(ctx, k, [0.8, 0.85, 1], 12, 5);
    ctx.fillRect(0, 0, W, H);
    const B = (env.bleed || 0) * k;
    const PW = env.format.w * k, PH = env.format.h * k;
    const i1 = 6 * k, i2 = 7.6 * k;
    ctx.strokeStyle = goldGradient(ctx, 0, 0, W, H);
    ctx.lineWidth = 0.55 * k; ctx.strokeRect(B + i1, B + i1, PW - 2 * i1, PH - 2 * i1);
    ctx.lineWidth = 0.2 * k; ctx.strokeRect(B + i2, B + i2, PW - 2 * i2, PH - 2 * i2);
  } else if (style === 'film') {
    ctx.fillStyle = noisePattern(ctx, k, [1, 1, 1], 18, 9);
    ctx.fillRect(0, 0, W, H);
  }
  if (style === 'halftone') {
    // comic-book dots fading out from two corners
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    const step = 3.2 * k;
    const corners = r() < 0.5 ? [[0, 0], [W, H]] : [[W, 0], [0, H]];
    for (const [cx0, cy0] of corners) {
      const R = Math.min(W, H) * 0.55;
      for (let yy = step / 2; yy < H; yy += step) for (let xx = step / 2; xx < W; xx += step) {
        const d = Math.hypot(xx - cx0, yy - cy0);
        if (d > R) continue;
        const rad = (1 - d / R) * step * 0.42;
        if (rad < 0.15 * k) continue;
        ctx.beginPath(); ctx.arc(xx, yy, rad, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  }
  if (theme.deco.includes('blobs')) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = colors.accent;
    for (let i = 0; i < 2; i++) {
      const cx = (r() < 0.5 ? 0.05 : 0.95) * W, cy = (i === 0 ? 0.08 : 0.92) * H;
      ctx.beginPath(); ctx.arc(cx, cy, (0.18 + r() * 0.14) * Math.min(W, H), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(r() * W, (r() < 0.5 ? r() * 0.12 : 0.88 + r() * 0.12) * H, (0.4 + r()) * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// decorations drawn on top of the photos, kept to the page margins
function drawOverlayDeco(ctx, theme, colors, g, r, page) {
  const { B, PW, PH, M, k } = g;
  if (theme.deco.includes('leaves')) {
    const L = Math.min(PW, PH) * 0.2;
    const inset = Math.min(M * 0.3, 4 * k);
    // branches run along the page edges, inside the margin
    const corners = [
      [B + PW - inset, B + inset, Math.PI - 0.15],
      [B + inset, B + PH - inset, -0.15],
      [B + inset, B + inset, 0.15],
      [B + PW - inset, B + PH - inset, Math.PI + 0.15],
    ];
    const pick = Math.floor(r() * 2);
    for (const idx of [pick, pick + 2]) {
      const [x, y, a] = corners[idx];
      drawLeafBranch(ctx, x, y, L, a + (r() - 0.5) * 0.06, k, colors, r);
    }
  }
  if (theme.deco.includes('goldCorners')) {
    const i3 = 9.5 * k;
    drawGoldCorners(ctx, B + i3, B + i3, PW - 2 * i3, PH - 2 * i3, k);
  }
  if ((theme.deco.includes('confetti') || theme.deco.includes('hearts')) && page.type !== 'cover') {
    const hearts = theme.deco.includes('hearts');
    const n = hearts ? 3 + Math.floor(r() * 3) : 10 + Math.floor(r() * 8);
    const palette = hearts ? [colors.accent2, colors.accent] : ['#f4a3b5', '#9fd3c7', '#a7bff2', '#ffd59e', '#c7b4ea', colors.accent];
    for (let i = 0; i < n; i++) {
      const edge = Math.floor(r() * 4), along = 0.04 + r() * 0.92;
      const pos = [[B + along * PW, B + M * (0.2 + r() * 0.5)], [B + along * PW, B + PH - M * (0.2 + r() * 0.5)],
        [B + M * (0.2 + r() * 0.5), B + along * PH], [B + PW - M * (0.2 + r() * 0.5), B + along * PH]][edge];
      const col = palette[Math.floor(r() * palette.length)];
      if (hearts) { drawDoodle(ctx, 'heart', pos[0], pos[1], (3 + r() * 2.5) * k, col, k); continue; }
      ctx.save();
      ctx.translate(pos[0], pos[1]); ctx.rotate(r() * Math.PI);
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 0.5 * k; ctx.lineCap = 'round';
      const sz = (0.8 + r() * 1.2) * k, kind = Math.floor(r() * 3);
      ctx.beginPath();
      if (kind === 0) { ctx.arc(0, 0, sz, 0, 7); ctx.fill(); }
      else if (kind === 1) { ctx.moveTo(0, -sz * 1.2); ctx.lineTo(sz * 1.1, sz); ctx.lineTo(-sz * 1.1, sz); ctx.closePath(); ctx.fill(); }
      else { ctx.moveTo(-sz * 2, 0); ctx.quadraticCurveTo(-sz, -sz * 1.5, 0, 0); ctx.quadraticCurveTo(sz, sz * 1.5, sz * 2, 0); ctx.stroke(); }
      ctx.restore();
    }
  }
  if (theme.deco.includes('doodles') && page.type !== 'cover') {
    const kinds = ['heart', 'star', 'swirl', 'dots', 'arrow'];
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const edge = Math.floor(r() * 4);
      const along = 0.1 + r() * 0.8;
      const s = (4 + r() * 3) * k;
      const pos = [
        [B + along * PW, B + M * 0.5], [B + along * PW, B + PH - M * 0.5],
        [B + M * 0.5, B + along * PH], [B + PW - M * 0.5, B + along * PH],
      ][edge];
      drawDoodle(ctx, kinds[Math.floor(r() * kinds.length)], pos[0], pos[1], s, i % 2 ? colors.accent : colors.accent2, k);
    }
  }
}

// Draws one photo inside a slot, with the theme's frame/tilt/shadow/tape.
function drawPhoto(ctx, img, photo, box, theme, k, r, opts = {}) {
  let { x, y, w, h } = box;
  const tiltDeg = opts.noTilt ? 0 : (opts.tilt != null ? opts.tilt : (r() * 2 - 1) * (theme.tilt || 0));
  const tilt = tiltDeg * Math.PI / 180;
  const shape = opts.full ? 'rect' : (opts.shape || 'rect');
  const colors = opts.colors || {};
  ctx.save();
  if (tilt) {
    const shrink = 1 - Math.min(0.12, Math.abs(tiltDeg) * 0.02);
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(tilt);
    w *= shrink; h *= shrink;
    x = -w / 2; y = -h / 2;
  }
  ({ x, y, w, h } = shapeBox(shape, x, y, w, h));
  const frame = opts.full ? 'none' : theme.frame;
  const rad = (theme.radius || 0) * k;
  const placeholder = () => { ctx.fillStyle = colors.dark ? '#333' : '#d9d4cc'; ctx.fill(); };

  if (frame === 'polaroid') {
    const b = Math.min(w, h) * 0.05, bottom = Math.min(w, h) * 0.16;
    ctx.save();
    ctx.shadowColor = 'rgba(40,25,10,0.35)'; ctx.shadowBlur = 3 * k; ctx.shadowOffsetY = 1.2 * k; ctx.shadowOffsetX = 0.6 * k;
    ctx.fillStyle = '#fdfcf8'; ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(x + b, y + b, w - 2 * b, h - b - bottom); ctx.clip();
    if (img) paint(ctx, img, photo, x + b, y + b, w - 2 * b, h - b - bottom, opts.crop, theme); else placeholder();
    ctx.restore();
    if (opts.caption) drawText(ctx, opts.caption, x + w / 2, y + h - bottom / 2, { size: bottom * 0.5, weight: 700, family: 'Amatic SC', color: '#3a3a3a', maxW: w * 0.9 });
  } else if (frame === 'film') {
    const sp = Math.min(w, h) * 0.1;
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#e9e4da';
    const holeW = sp * 0.42, holeH = sp * 0.5;
    const n = Math.max(3, Math.round(w / (holeW * 2.2)));
    for (let i = 0; i < n; i++) {
      const hx = x + (i + 0.5) * (w / n) - holeW / 2;
      for (const hy of [y + sp * 0.25, y + h - sp * 0.75]) { shapePath(ctx, 'round', hx, hy, holeW, holeH, holeW * 0.25); ctx.fill(); }
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(x + sp * 0.25, y + sp, w - sp * 0.5, h - 2 * sp); ctx.clip();
    if (img) paint(ctx, img, photo, x + sp * 0.25, y + sp, w - sp * 0.5, h - 2 * sp, opts.crop, theme); else placeholder();
    ctx.restore();
  } else {
    const border = frame === 'white' ? Math.max(1.4 * k, Math.min(w, h) * 0.035) : 0;
    if ((frame === 'offset' || frame === 'comic') && !opts.full) {
      // a solid block peeking out behind the photo
      const off = Math.max(1.4 * k, Math.min(w, h) * (frame === 'comic' ? 0.035 : 0.05));
      ctx.fillStyle = frame === 'comic' ? '#111' : colors.accent;
      shapePath(ctx, shape, x - off, y + off, w, h, rad); ctx.fill();
    }
    if ((theme.shadow || frame === 'white' || frame === 'gold') && !opts.full) {
      ctx.save();
      ctx.shadowColor = colors.dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 3.5 * k; ctx.shadowOffsetY = 1.2 * k;
      ctx.fillStyle = frame === 'white' ? '#fffefb' : '#000';
      shapePath(ctx, shape, x, y, w, h, rad); ctx.fill();
      ctx.restore();
    }
    ctx.save();
    if (border) {
      ctx.fillStyle = '#fffefb';
      shapePath(ctx, shape, x, y, w, h, rad); ctx.fill();
    }
    const ix = x + border, iy = y + border, iw = w - 2 * border, ih = h - 2 * border;
    shapePath(ctx, shape, ix, iy, iw, ih, opts.full ? 0 : Math.max(0, rad - border));
    ctx.clip();
    if (img) paint(ctx, img, photo, ix, iy, iw, ih, opts.crop, theme); else placeholder();
    ctx.restore();
    if (frame === 'comic' && !opts.full) {
      ctx.strokeStyle = '#111'; ctx.lineWidth = 0.9 * k;
      shapePath(ctx, shape, x, y, w, h, rad); ctx.stroke();
    }
    if (frame === 'line' && !opts.full) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.25 * k;
      shapePath(ctx, shape, x + 0.1 * k, y + 0.1 * k, w - 0.2 * k, h - 0.2 * k, rad); ctx.stroke();
    }
    if (frame === 'gold' && !opts.full) {
      ctx.strokeStyle = goldGradient(ctx, x, y, w, h);
      ctx.lineWidth = 0.9 * k;
      shapePath(ctx, shape, x, y, w, h, rad); ctx.stroke();
      ctx.lineWidth = 0.25 * k;
      const o = 1.8 * k;
      shapePath(ctx, shape, x - o, y - o, w + 2 * o, h + 2 * o, rad ? rad + o : 0); ctx.stroke();
    }
  }
  if (opts.caption && frame !== 'polaroid') {
    const inset = opts.captionInset || 0;
    const fs = Math.max(2.6 * k, Math.min(w, h) * 0.055);
    drawText(ctx, opts.caption, x + w / 2, y + h - inset - fs * 0.95, { size: fs, weight: theme.bodyWeight, family: theme.font, color: '#fff', maxW: w * 0.9, shadow: true });
  }
  if (!opts.full && theme.deco.includes('tape') && r() < 0.75) drawTape(ctx, x, y, w, h, k, r, false, colors);
  if (!opts.full && theme.deco.includes('washi') && r() < 0.8) drawTape(ctx, x, y, w, h, k, r, true, colors);
  ctx.restore();
}

function label(ctx, text, theme, colors, g, opts = {}) {
  if (!text) return;
  const { B, PW, M, k } = g;
  const fam = theme.font;
  const y = B + Math.max(M * 0.5, 4 * k);
  const size = Math.max(3.8 * k, Math.min(M * 0.45, 5.5 * k));
  if (theme.id === 'scrapbook') {
    ctx.save();
    ctx.font = `700 ${size * 1.2}px "${fam}"`;
    const w = ctx.measureText(text).width + size * 1.6;
    const x = B + PW - M - w;
    ctx.translate(x + w / 2, y); ctx.rotate(-0.03);
    ctx.fillStyle = '#fbf6ea'; ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 1.5 * k;
    ctx.fillRect(-w / 2, -size * 0.8, w, size * 1.6);
    ctx.restore();
    drawText(ctx, text, x + w / 2, y, { size: size * 1.2, weight: 700, family: fam, color: colors.text, maxW: PW * 0.6 });
    return;
  }
  const opt = { size, weight: theme.bodyWeight, family: fam, color: theme.id === 'magazine' ? colors.accent : colors.text, maxW: PW - 2 * M, align: 'right', gold: theme.goldText };
  drawText(ctx, theme.id === 'magazine' ? text.toUpperCase() : text, B + PW - M, y, opt);
}

/**
 * Render a page. Returns { slots: [{x,y,w,h,index}] } in canvas pixels.
 * env: { format:{w,h} (mm), bleed (mm), pxPerMm, theme, album, photosById,
 *        getImage(photo, wPx, hPx) -> Promise<ImageBitmap>, pageNumber }
 */
export async function renderPage(canvas, page, env) {
  const { format, photosById, pxPerMm: k } = env;
  let theme = effectiveTheme(page, env.theme);
  // gold lettering is unreadable on a light background the user picked
  if (theme.goldText && page.bg && lum(hex2rgb(toHex(page.bg))) > 0.6) theme = { ...theme, goldText: false, text: '#2c2a26', accent: '#9a7833' };
  const bleed = env.bleed || 0;
  const W = Math.round((format.w + 2 * bleed) * k);
  const H = Math.round((format.h + 2 * bleed) * k);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const r = rng(Math.floor((page.variant || 0.5) * 1e9));
  const colors = pageColors(theme, page, photosById);
  const B = bleed * k;
  const PW = format.w * k, PH = format.h * k;
  const M = theme.margin * k;
  const fam = theme.font;
  const texts = [];
  const g = { W, H, B, PW, PH, M, k, r, colors, page, texts, pageNumber: env.pageNumber };
  const slots = [];

  drawBackground(ctx, W, H, colors, theme, k, r, env, page);

  const photoOf = id => photosById.get(id);
  const load = async (p, w, h) => {
    if (!p) return null;
    try { return await env.getImage(p, w, h); } catch (e) { console.warn('image failed', e); return null; }
  };
  const cropOf = i => page.crops?.[page.photos?.[i]]; // crop/zoom is stored per photo
  g.load = load; g.photoOf = photoOf; g.slots = slots; g.cropOf = cropOf;

  if (page.type === 'photos') {
    const tpl = templateById(page.template);
    if (!tpl) return { slots, texts };
    const gap = theme.gap * k;
    if (tpl.full) {
      const p = photoOf(page.photos[0]);
      const img = await load(p, W, H);
      drawPhoto(ctx, img, p, { x: 0, y: 0, w: W, h: H }, theme, k, r, { full: true, noTilt: true, crop: cropOf(0), colors, caption: page.captions?.[page.photos[0]] || null, captionInset: M + B });
      slots.push({ x: 0, y: 0, w: W, h: H, index: 0 });
    } else {
      drawPageDecoUnder(ctx, theme, colors, g, r, page, tpl);
      const cx = B + M - gap / 2, cy = B + M - gap / 2;
      const cw = PW - 2 * M + gap, ch = PH - 2 * M + gap;
      const imgs = await Promise.all(tpl.slots.map((s, i) => load(photoOf(page.photos[i]), s.w * cw, s.h * ch)));
      tpl.slots.forEach((s, i) => {
        const p = photoOf(page.photos[i]);
        const sx = 1 - s.x - s.w; // mirror: Hebrew albums read right-to-left
        const box = { x: cx + sx * cw + gap / 2, y: cy + s.y * ch + gap / 2, w: s.w * cw - gap, h: s.h * ch - gap };
        let shape = page.shapes?.[i];
        if (!shape) {
          const portraitish = box.w / box.h < 0.95;
          if (theme.shapeSolo && tpl.slots.length === 1) shape = theme.shapeSolo;
          else if (theme.archChance && portraitish && r() < theme.archChance) shape = 'arch';
          else if (theme.ovalChance && r() < theme.ovalChance) shape = 'oval';
          else if (theme.shapeSolo === 'round') shape = 'round';
        }
        drawPhoto(ctx, imgs[i], p, box, theme, k, r, { shape, crop: cropOf(i), colors, caption: page.captions?.[page.photos[i]] || null });
        slots.push({ ...box, index: i });
      });
    }
    drawOverlayDeco(ctx, theme, colors, g, r, page);
    drawPageDecoOver(ctx, theme, colors, g, r, page, tpl);
    if (page.label && (theme.labels || page.text?.label) && !tpl.full) {
      textGroup(ctx, g, 'label', B + PW - M, B + M * 0.5, () => label(ctx, page.label, theme, colors, g));
    }
    if (page.title || page.subtitle) {
      const top = placeTop(page, g, 'title', tpl.full ? subjectY(page, g) > 0.55 : true);
      const cy = B + PH * (top ? 0.11 : 0.86);
      textGroup(ctx, g, 'title', B + PW / 2, cy, () => pageTitle(ctx, page, theme, colors, g, cy));
    }
    if (page.caption) {
      // on a full-page photo keep the caption away from the subject
      const top = tpl.full ? placeTop(page, g, 'caption', subjectY(page, g) > 0.62) : false;
      const cy = top ? B + Math.max(M * 0.9, 9 * k) : B + PH - Math.max(M * (theme.bgStyle === 'navygold' ? 0.68 : 0.45), tpl.full ? 9 * k : 0);
      textGroup(ctx, g, 'caption', B + PW / 2, cy, () => drawCaption(ctx, page, theme, colors, g, cy, {
        size: Math.max(tpl.full ? 6 * k : 0, Math.min(5.5 * k, M * 0.42)), weight: theme.bodyWeight, family: fam, maxW: PW - 2 * M,
        color: tpl.full ? '#fff' : colors.text, shadow: tpl.full, gold: theme.goldText && !tpl.full,
      }, top));
    }
    if (theme.deco.includes('bars') && !tpl.full && !page.label) { // the label takes this spot when present
      ctx.fillStyle = colors.accent;
      ctx.fillRect(B + PW - M - 14 * k, B + M * 0.4, 14 * k, 1.2 * k);
    }
    if (theme.pageNumbers && env.pageNumber && !tpl.full && !(theme.pageDeco || []).includes('bigNumber')) {
      const left = env.pageNumber % 2 === 0;
      drawText(ctx, String(env.pageNumber), left ? B + M * 0.5 : B + PW - M * 0.5, B + PH - M * 0.45, {
        size: 3.2 * k, weight: 400, family: fam, color: colors.text, maxW: 20 * k,
      });
    }
  } else if (page.type === 'cover') {
    await renderCover(ctx, page, env, theme, g);
  } else if (page.type === 'chapter') {
    await renderChapter(ctx, page, env, theme, g);
  } else if (page.type === 'end') {
    renderEnd(ctx, page, env, theme, g);
  }
  // a bottom caption on cover / chapter / end pages (photo pages draw their own)
  if (page.type !== 'photos' && page.caption) {
    const overPhoto = (page.type === 'cover' && theme.cover !== 'framed') || (page.type === 'chapter' && theme.fullBleedSolo);
    const cy = B + PH - Math.max(M * (theme.bgStyle === 'navygold' ? 0.68 : 0.45), overPhoto ? 9 * k : 4 * k);
    textGroup(ctx, g, 'caption', B + PW / 2, cy, () => drawCaption(ctx, page, theme, colors, g, cy, {
      size: page.type === 'end' ? Math.min(11 * k, M * 0.72) : Math.max(overPhoto ? 6 * k : 0, Math.min(5.5 * k, M * 0.42)), weight: theme.bodyWeight, family: theme.font, maxW: PW - 2 * M,
      color: overPhoto ? '#fff' : colors.text, shadow: overPhoto, outline: overPhoto ? 'rgba(0,0,0,0.5)' : null, gold: theme.goldText && !overPhoto,
    }));
  }
  return { slots, texts };
}

// bottom caption: plain text, or a row of bullet points ("a, b, c" -> • a  • b  • c)
function drawCaption(ctx, page, theme, colors, g, cy, opt, growDown = false) {
  if (!page.captionBullets) { drawText(ctx, page.caption, g.B + g.PW / 2, cy, opt); return; }
  const items = page.caption.split(/[,،\n•·|]+/).map(t => t.trim()).filter(Boolean);
  if (!items.length) return;
  const { k } = g;
  const overPhoto = !!opt.shadow;
  // keep a multi-line list inside the bottom margin by shrinking it if needed
  const avail = g.M * 0.85;
  let size = opt.size, widths, rows, dot, dotGap, itemGap;
  for (let tries = 0; tries < 8; tries++) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.font = `${opt.weight} ${size}px "${opt.family}"`;
    dot = size * 0.17; dotGap = size * 0.45; itemGap = size * 1.3;
    widths = items.map(t => Math.min(ctx.measureText(t).width, opt.maxW * 0.9) + dot * 2 + dotGap);
    ctx.restore();
    rows = [];
    let row = [], rw = 0;
    items.forEach((t, i) => {
      const w = widths[i];
      if (row.length && rw + itemGap + w > opt.maxW) { rows.push({ row, rw }); row = []; rw = 0; }
      rw += (row.length ? itemGap : 0) + w;
      row.push(i);
    });
    if (row.length) rows.push({ row, rw });
    if (overPhoto || rows.length === 1 || rows.length * size * 1.45 <= avail || size < 2.4 * k) break;
    size *= 0.88;
  }
  opt = { ...opt, size };
  const lineH = size * 1.45;
  // the last row sits on cy (rows grow upward), or the first row when the caption is at the top
  const y0 = growDown ? cy : overPhoto ? cy - (rows.length - 1) * lineH : cy - (rows.length - 1) * lineH / 2;
  rows.forEach(({ row, rw }, ri) => {
    const y = y0 + ri * lineH;
    let x = g.B + g.PW / 2 + rw / 2; // right edge of the row (RTL)
    for (const i of row) {
      const w = widths[i];
      // the bullet, right of the text
      ctx.save();
      ctx.fillStyle = opt.color === '#fff' ? '#fff' : (theme.goldText ? goldGradient(ctx, x - dot * 2, y - dot, dot * 2, dot * 2) : colors.accent);
      if (opt.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = size * 0.3; }
      ctx.beginPath(); ctx.arc(x - dot, y + size * 0.02, dot, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawText(ctx, items[i], x - dot * 2 - dotGap, y, { ...opt, align: 'right', maxW: opt.maxW * 0.9 });
      x -= w + itemGap;
    }
  });
}

// a title on a regular photo page, on a soft panel so it reads over photos too
function pageTitle(ctx, page, theme, colors, g, cy) {
  const { B, PW, PH, k } = g;
  const fam = theme.font;
  const big = theme.font === 'Amatic SC' || theme.font === 'Karantina';
  const ts = PH * (big ? 0.085 : 0.06), ss = PH * (big ? 0.042 : 0.03);
  const hasSub = !!page.subtitle;
  const boxed = page.titleBox ?? theme.titlePanel !== false;
  ctx.save();
  ctx.direction = 'rtl';
  const tw = page.title ? (ctx.font = `${theme.titleWeight} ${fitFont(ctx, page.title, theme.titleWeight, fam, ts, PW * 0.8)}px "${fam}"`, ctx.measureText(page.title).width) : 0;
  const sw = hasSub ? (ctx.font = `${theme.bodyWeight} ${fitFont(ctx, page.subtitle, theme.bodyWeight, fam, ss, PW * 0.8)}px "${fam}"`, ctx.measureText(page.subtitle).width) : 0;
  ctx.restore();
  const titleY = hasSub && page.title ? cy - ss * 0.85 : cy;
  const subY = page.title ? titleY + ts * 0.62 + ss * 0.75 : cy;
  const dark = colors.dark;
  if (boxed) {
    const w = Math.max(tw, sw) + ts * 1.2;
    const top = (page.title ? titleY - ts * 0.75 : subY - ss * 0.9);
    const bottom = hasSub ? subY + ss * 0.95 : titleY + ts * 0.7;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 2 * k; ctx.shadowOffsetY = 0.5 * k;
    ctx.fillStyle = dark ? 'rgba(15,15,20,0.72)' : toRGBA(colors.bg, 0.9);
    shapePath(ctx, 'round', B + PW / 2 - w / 2, top, w, bottom - top, Math.min(3 * k, (bottom - top) / 2));
    ctx.fill();
    ctx.restore();
  }
  const color = boxed ? (dark ? '#fff' : colors.text) : '#fff';
  if (page.title) drawText(ctx, page.title, B + PW / 2, titleY, { size: ts, weight: theme.titleWeight, family: fam, color, maxW: PW * 0.8, gold: theme.goldText && boxed, shadow: !boxed });
  if (hasSub) drawText(ctx, page.subtitle, B + PW / 2, subY, { size: ss, weight: theme.bodyWeight, family: fam, color: boxed ? colors.accent : '#fff', maxW: PW * 0.8, gold: theme.goldText && boxed, shadow: !boxed });
}
function toRGBA(c, a) {
  const [r, g2, b] = hex2rgb(toHex(c));
  return `rgba(${r},${g2},${b},${a})`;
}

// ---------- interior page decoration ----------
const dateFmtDay = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
const dateFmtMonth = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
function pageDateText(page, photoOf) {
  const ds = page.photos.map(id => photoOf(id)?.date).filter(Boolean).sort((a, b) => a - b);
  if (!ds.length) return '';
  const a = new Date(ds[0]), b = new Date(ds[ds.length - 1]);
  return a.toDateString() === b.toDateString() ? dateFmtDay.format(a) : dateFmtMonth.format(a);
}

// shapes drawn behind the photos (tinted with the accent color)
function drawPageBlock(ctx, kind, theme, colors, g, r) {
  const { B, PW, PH, M, k } = g;
  const bg = hex2rgb(toHex(colors.bg)), ac = hex2rgb(toHex(colors.accent2 || colors.accent));
  const tint = colors.dark ? css(mix(bg, [255, 255, 255], 0.13)) : css(mix(ac, bg, kind === 'soft' ? 0.88 : 0.8));
  ctx.save();
  ctx.fillStyle = tint;
  const side = r() < 0.5;
  if (kind === 'rect' || kind === 'soft') {
    const w = PW * (0.42 + r() * 0.16);
    ctx.fillRect(side ? B : B + PW - w, B, w, PH);
    if (kind === 'rect') {
      ctx.fillStyle = colors.accent;
      ctx.fillRect(side ? B + w - 0.6 * k : B + PW - w, B + PH * 0.1, 0.6 * k, PH * 0.8);
    }
  } else if (kind === 'diag') {
    // a bold slanted slab of color
    ctx.fillStyle = colors.accent;
    const a1 = PW * (0.42 + r() * 0.15), a2 = PW * (0.18 + r() * 0.15);
    ctx.beginPath();
    if (side) { ctx.moveTo(B - 1, B - 1); ctx.lineTo(B + a1, B - 1); ctx.lineTo(B + a2, B + PH + 1); ctx.lineTo(B - 1, B + PH + 1); }
    else { ctx.moveTo(B + PW + 1, B - 1); ctx.lineTo(B + PW - a1, B - 1); ctx.lineTo(B + PW - a2, B + PH + 1); ctx.lineTo(B + PW + 1, B + PH + 1); }
    ctx.closePath(); ctx.fill();
  } else if (kind === 'band') {
    const h = PH * (0.32 + r() * 0.12), y = B + PH * (0.25 + r() * 0.3);
    ctx.fillRect(B, y, PW + 2 * B, h);
  } else if (kind === 'circle') {
    const R = Math.min(PW, PH) * (0.36 + r() * 0.1);
    ctx.beginPath();
    ctx.arc(B + PW * (side ? 0.28 : 0.72), B + PH * (0.35 + r() * 0.3), R, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'arch') {
    const w = PW * 0.62, h = PH * 0.84;
    shapePath(ctx, 'arch', B + (PW - w) / 2 + (side ? -1 : 1) * PW * 0.08, B + PH - h, w, h);
    ctx.fill();
  }
  ctx.restore();
}

function drawPageDecoUnder(ctx, theme, colors, g, r, page, tpl) {
  const deco = theme.pageDeco || [];
  if (tpl.full) return;
  const block = deco.find(d => d.startsWith('block:'));
  if (block && page.decoBlock !== false && (page.decoBlock || r() < (block === 'block:diag' ? 0.8 : 0.65))) drawPageBlock(ctx, block.slice(6), theme, colors, g, r);
}

function drawPageDecoOver(ctx, theme, colors, g, r, page, tpl) {
  const deco = theme.pageDeco || [];
  const { B, PW, PH, M, k } = g;
  if (tpl.full) return;
  if (deco.includes('frameLines')) {
    const i = M * 0.42;
    ctx.save();
    ctx.strokeStyle = colors.accent; ctx.globalAlpha = 0.7;
    ctx.lineWidth = 0.3 * k;
    ctx.strokeRect(B + i, B + i, PW - 2 * i, PH - 2 * i);
    ctx.lineWidth = 0.12 * k;
    const j = i + 1.1 * k;
    ctx.strokeRect(B + j, B + j, PW - 2 * j, PH - 2 * j);
    ctx.restore();
  }
  if (deco.includes('filmEdge')) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const hw = 1.8 * k, hh = 1.2 * k, step = 4.2 * k;
    for (let x = B + step / 2; x < B + PW; x += step) {
      for (const y of [B + M * 0.25, B + PH - M * 0.25 - hh]) { shapePath(ctx, 'round', x, y, hw, hh, 0.3 * k); ctx.fill(); }
    }
    ctx.restore();
  }
  if (deco.includes('sideLabel')) {
    const text = page.label || pageDateText(page, g.photoOf);
    if (text) {
      const left = (g.pageNumber || 1) % 2 === 0;
      ctx.save();
      ctx.translate(left ? B + M * 0.5 : B + PW - M * 0.5, B + PH / 2);
      ctx.rotate(left ? -Math.PI / 2 : Math.PI / 2);
      drawText(ctx, text, 0, 0, { size: Math.min(M * 0.32, 3.6 * k), weight: 700, family: theme.font, color: colors.accent, maxW: PH * 0.6 });
      ctx.restore();
    }
  }
  if (deco.includes('bigNumber') && g.pageNumber) {
    const left = g.pageNumber % 2 === 0;
    ctx.save();
    ctx.globalAlpha = 0.9;
    drawText(ctx, String(g.pageNumber).padStart(2, '0'), left ? B + M * 0.5 : B + PW - M * 0.5, B + PH - M * 0.5, {
      size: Math.min(M * (theme.id === 'magazine' ? 0.95 : 0.6), (theme.id === 'magazine' ? 11 : 7) * k), weight: theme.id === 'magazine' ? 900 : 700, family: theme.font, color: colors.accent, maxW: M * 3, align: left ? 'left' : 'right',
    });
    ctx.restore();
  }
  // a small date line in the bottom margin (unless the page already has a caption)
  if (deco.includes('dateLine') && !page.caption && page.showDate === true && M >= 8 * k) {
    const text = pageDateText(page, g.photoOf);
    if (text) {
      const y = B + PH - M * 0.48;
      textGroup(ctx, g, 'date', B + PW / 2, y, () => {
        const s = drawText(ctx, text, B + PW / 2, y, { size: Math.min(M * 0.32, 4.2 * k), weight: theme.bodyWeight, family: theme.font, color: colors.accent, maxW: PW * 0.5, gold: theme.goldText });
        ctx.save();
        ctx.font = `${theme.bodyWeight} ${s}px "${theme.font}"`;
        const w = ctx.measureText(text).width;
        ctx.strokeStyle = theme.goldText ? goldGradient(ctx, B, y, PW, 1) : colors.accent;
        ctx.globalAlpha = 0.6; ctx.lineWidth = 0.2 * k;
        const gap = 3 * k, len = 9 * k;
        ctx.beginPath();
        ctx.moveTo(B + PW / 2 - w / 2 - gap, y); ctx.lineTo(B + PW / 2 - w / 2 - gap - len, y);
        ctx.moveTo(B + PW / 2 + w / 2 + gap, y); ctx.lineTo(B + PW / 2 + w / 2 + gap + len, y);
        ctx.stroke();
        ctx.restore();
      });
    }
  }
}

// a framed hero photo with title underneath (used by most covers/chapters)
async function framedHero(ctx, page, theme, g, { title, sub, sub2 = '', titleScale = 1, top = 1.4 }) {
  const { B, PW, PH, M, k, r, colors, load, photoOf, slots, cropOf } = g;
  const p = photoOf(page.photos[0]);
  const fam = theme.font;
  let shape = page.shapes?.[0] || theme.shapeSolo || 'rect';
  const polaroid = theme.frame === 'polaroid';
  let bw, bh;
  if (polaroid) { bw = PW * 0.66; bh = Math.min(bw * 1.12, PH * 0.66); }
  else if (shape === 'arch' || shape === 'circle') { bw = Math.min(PW * 0.62, PH * 0.5); bh = shape === 'circle' ? bw : bw * 1.18; }
  else { bw = PW - 2 * M * top; bh = PH * 0.6; }
  const bx = B + (PW - bw) / 2, by = B + M * top;
  const img = await load(p, bw, bh);
  drawPhoto(ctx, img, p, { x: bx, y: by, w: bw, h: bh }, theme, k, r, { shape, noTilt: !polaroid && theme.id !== 'scrapbook', crop: cropOf(0), colors });
  slots.push({ x: bx, y: by, w: bw, h: bh, index: 0 });
  drawOverlayDeco(ctx, theme, colors, g, r, page);
  const rest = PH - (by - B) - bh;
  // leave room at the bottom when the page also has a caption
  const ty = by + bh + rest * ((sub2 ? 0.3 : 0.4) - (page.caption ? (sub2 ? 0.1 : 0.07) : 0));
  const big = polaroid || theme.font === 'Amatic SC' || theme.font === 'Karantina';
  textGroup(ctx, g, 'title', B + PW / 2, ty, () => {
    const ts = drawText(ctx, title, B + PW / 2, ty, { size: PH * (big ? 0.11 : 0.075) * titleScale, weight: theme.titleWeight, family: fam, color: colors.text, maxW: PW * 0.85, gold: theme.goldText });
    let ly = ty + ts * 0.62 + PH * 0.035;
    if (sub) {
      const ss = drawText(ctx, sub, B + PW / 2, ly, { size: PH * (big ? 0.05 : 0.038), weight: theme.bodyWeight, family: fam, color: colors.accent, maxW: PW * 0.8, gold: theme.goldText });
      ly += ss * 1.25;
    }
    if (sub2) drawText(ctx, sub2, B + PW / 2, ly, { size: PH * (big ? 0.04 : 0.03), weight: theme.bodyWeight, family: fam, color: colors.text, maxW: PW * 0.8, gold: theme.goldText });
    if (!sub && !sub2 && title) {
      const oy = ty + ts * 0.62 + PH * 0.02;
      ctx.fillStyle = theme.goldText ? goldGradient(ctx, B + PW / 2 - 10 * k, oy, 20 * k, 1) : colors.accent;
      ctx.fillRect(B + PW / 2 - 10 * k, oy, 20 * k, 0.4 * k);
      ctx.beginPath(); ctx.arc(B + PW / 2, oy + 0.2 * k, 1.1 * k, 0, Math.PI * 2); ctx.fill();
    }
  });
}

async function fullBleedHero(ctx, page, theme, g) {
  const { W, H, k, r, colors, load, photoOf, slots, cropOf } = g;
  const p = photoOf(page.photos[0]);
  const img = await load(p, W, H);
  drawPhoto(ctx, img, p, { x: 0, y: 0, w: W, h: H }, theme, k, r, { full: true, noTilt: true, crop: cropOf(0), colors });
  slots.push({ x: 0, y: 0, w: W, h: H, index: 0 });
}

async function renderCover(ctx, page, env, theme, g) {
  const { album } = env;
  const { W, H, B, PW, PH, M, k, colors } = g;
  const title = album.title || album.name || 'האלבום שלנו';
  const sub = album.subtitle || '';
  const sub2 = album.subtitle2 || '';
  const fam = theme.font;
  if (theme.cover === 'framed') {
    await framedHero(ctx, page, theme, g, { title, sub, sub2, titleScale: 1.15 });
    return;
  }
  await fullBleedHero(ctx, page, theme, g);
  const sy = subjectY(page, g);
  if (theme.cover === 'magazine') {
    // magazine title lives at the top unless the subject is there
    const top = placeTop(page, g, 'title', sy >= 0.4);
    const y0 = top ? B + M + PH * 0.08 : B + PH - M - PH * (sub2 ? 0.27 : 0.2);
    textGroup(ctx, g, 'title', B + PW - M, y0, () => {
      drawText(ctx, title, B + PW - M, y0, { size: PH * 0.16, weight: 900, family: fam, color: '#fff', maxW: PW - 2 * M, align: 'right', shadow: true });
      // subtitle on a bold colored tag
      if (sub) {
        const fs = PH * 0.042;
        ctx.save();
        ctx.font = `700 ${fitFont(ctx, sub, 700, fam, fs, PW - 2 * M)}px "${fam}"`;
        const w = ctx.measureText(sub).width;
        ctx.fillStyle = colors.accent;
        ctx.fillRect(B + PW - M - w - fs * 0.8, y0 + PH * 0.1, w + fs * 0.8, fs * 1.5);
        ctx.restore();
        drawText(ctx, sub, B + PW - M - fs * 0.4, y0 + PH * 0.1 + fs * 0.78, { size: fs, weight: 700, family: fam, color: '#fff', maxW: PW - 2 * M, align: 'right' });
      } else {
        ctx.fillStyle = colors.accent;
        ctx.fillRect(B + PW - M - 30 * k, y0 + PH * 0.08, 30 * k, 2.2 * k);
      }
      if (sub2) {
        const fs2 = PH * 0.034, ty2 = y0 + PH * (sub ? 0.19 : 0.12);
        ctx.save();
        ctx.font = `700 ${fitFont(ctx, sub2, 700, fam, fs2, PW - 2 * M)}px "${fam}"`;
        const w2 = ctx.measureText(sub2).width;
        const bx = B + PW - M - w2 - fs2 * 0.9, bw = w2 + fs2 * 0.9, bh = fs2 * 1.6;
        ctx.fillStyle = '#fff';
        ctx.fillRect(bx, ty2, bw, bh);
        ctx.strokeStyle = colors.accent; ctx.lineWidth = Math.max(1, 0.5 * k);
        ctx.strokeRect(bx, ty2, bw, bh);
        ctx.restore();
        drawText(ctx, sub2, B + PW - M - fs2 * 0.45, ty2 + bh / 2, { size: fs2, weight: 700, family: fam, color: '#141414', maxW: PW - 2 * M, align: 'right' });
      }
    });
    return;
  }
  // bottom title, moved to the top when the subject is low in the photo
  const top = placeTop(page, g, 'title', sy > 0.58);
  const big = theme.font === 'Karantina';
  const y0 = top ? B + M * 1.5 + PH * 0.08 : B + PH - M * 1.5 - PH * (sub2 ? 0.15 : 0.09);
  textGroup(ctx, g, 'title', B + PW - M * 1.5, y0, () => {
    drawText(ctx, title, B + PW - M * 1.5, y0, { size: PH * (big ? 0.16 : 0.1), weight: 700, family: fam, color: '#fff', maxW: PW - 3 * M, align: 'right', shadow: true });
    ctx.fillStyle = colors.accent;
    ctx.fillRect(B + PW - M * 1.5 - 18 * k, y0 + PH * 0.065, 18 * k, 0.9 * k);
    drawText(ctx, sub, B + PW - M * 1.5, y0 + PH * 0.095, { size: PH * (big ? 0.06 : 0.04), weight: big ? 400 : 300, family: fam, color: '#fff', maxW: PW - 3 * M, align: 'right', shadow: true, outline: 'rgba(0,0,0,0.55)' });
    if (sub2) drawText(ctx, sub2, B + PW - M * 1.5, y0 + PH * (sub ? 0.15 : 0.095), { size: PH * (big ? 0.045 : 0.034), weight: 400, family: fam, color: '#fff', maxW: PW - 3 * M, align: 'right', shadow: true, outline: 'rgba(0,0,0,0.6)' });
  });
}

async function renderChapter(ctx, page, env, theme, g) {
  const { W, H, B, PW, PH, k, colors } = g;
  const fam = theme.font;
  if (theme.fullBleedSolo) {
    await fullBleedHero(ctx, page, theme, g);
    // centered title, unless the subject is in the middle – then above/below it
    const sy = subjectY(page, g);
    const centerBusy = Math.abs(sy - 0.5) < 0.22;
    const autoPos = centerBusy ? (sy < 0.5 ? 'bottom' : 'top') : 'center';
    const t = page.text?.title;
    const pos = t && t.top != null ? (t.top === true ? 'top' : t.top === false ? 'bottom' : t.top) : autoPos;
    (g.autoTop ||= {}).title = pos;
    const cy = B + PH * (pos === 'top' ? 0.24 : pos === 'bottom' ? 0.76 : 0.5);
    const big = theme.font === 'Karantina';
    textGroup(ctx, g, 'title', B + PW / 2, cy, () => {
      if (theme.deco.includes('bars')) {
        ctx.fillStyle = colors.accent;
        ctx.fillRect(B + PW / 2 - 15 * k, cy - PH * 0.13, 30 * k, 2 * k);
      }
      drawText(ctx, page.title || '', B + PW / 2, cy, { size: PH * (big ? 0.17 : 0.11), weight: theme.titleWeight, family: fam, color: '#fff', maxW: PW * 0.85, shadow: true });
      if (theme.id === 'magazine') {
        // a slim accent line instead of a block over the photo
        ctx.fillStyle = colors.accent;
        ctx.fillRect(B + PW / 2 - 16 * k, cy + PH * 0.062, 32 * k, 1.4 * k);
      }
      drawText(ctx, page.subtitle || '', B + PW / 2, cy + PH * 0.1, { size: PH * 0.045, weight: theme.bodyWeight, family: fam, color: '#fff', maxW: PW * 0.8, shadow: true });
    });
    return;
  }
  await framedHero(ctx, page, theme, g, { title: page.title || '', sub: page.subtitle || '' });
}

function renderEnd(ctx, page, env, theme, g) {
  const { album } = env;
  const { B, PW, PH, k, r, colors } = g;
  const fam = theme.font;
  drawOverlayDeco(ctx, theme, colors, g, r, page);
  const text = page.title || (page.quote ? 'הרגעים הקטנים הם הגדולים באמת' : 'נוצר באהבה');
  const sub = page.subtitle ?? (page.quote ? '' : (album.yearRange || ''));
  const big = theme.frame === 'polaroid' || theme.font === 'Amatic SC' || theme.font === 'Karantina';
  // the closing page has lots of room – use big, generous lettering
  const ty = B + PH * 0.42;
  textGroup(ctx, g, 'title', B + PW / 2, ty, () => {
    const ts = drawText(ctx, text, B + PW / 2, ty, { size: PH * (big ? 0.2 : 0.14), weight: theme.titleWeight, family: fam, color: colors.text, maxW: PW * 0.88, gold: theme.goldText });
    const dy = ty + ts * 0.72 + PH * 0.025;
    ctx.fillStyle = theme.goldText ? goldGradient(ctx, B + PW / 2 - 4 * k, dy, 8 * k, 8 * k) : colors.accent;
    ctx.beginPath(); ctx.arc(B + PW / 2, dy, 2.8 * k, 0, Math.PI * 2); ctx.fill();
    drawText(ctx, sub, B + PW / 2, dy + PH * 0.1, { size: PH * (big ? 0.105 : 0.078), weight: theme.bodyWeight, family: fam, color: colors.accent, maxW: PW * 0.88, gold: theme.goldText });
  });
}

// small schematic of a template (for the layout picker)
export function drawTemplateIcon(canvas, tpl, aspect = 1, color = '#2f6f68') {
  const W = 72, H = Math.round(72 / aspect);
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const m = tpl.full ? 0 : 6, gap = 2.5;
  for (const s of tpl.slots) {
    const sx = 1 - s.x - s.w;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(m + sx * (W - 2 * m) + gap / 2, m + s.y * (H - 2 * m) + gap / 2, s.w * (W - 2 * m) - gap, s.h * (H - 2 * m) - gap);
  }
}
