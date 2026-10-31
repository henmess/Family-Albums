// Draws album pages onto a canvas. The same code is used for the on-screen
// preview (small thumbnails) and for the print PDF (full resolution).
import { templateById, rng } from './layout.js?v=3';

export const THEMES = {
  classic: {
    name: 'קלאסי', desc: 'לבן נקי, מסגרות דקות, אלגנטי',
    bg: '#fbf9f4', text: '#2c2a26', accent: '#b08d57',
    font: 'Frank Ruhl Libre', titleWeight: 700, bodyWeight: 400,
    margin: 14, gap: 4, frame: 'line', radius: 0, shadow: false, tilt: 0,
    fullBleedSolo: false, pageNumbers: true,
  },
  modern: {
    name: 'מודרני כהה', desc: 'רקע שחור, תמונות מלאות, דרמטי',
    bg: '#141414', text: '#f4f1ea', accent: '#e9b44c',
    font: 'Rubik', titleWeight: 700, bodyWeight: 300,
    margin: 9, gap: 2.5, frame: 'none', radius: 0, shadow: false, tilt: 0,
    fullBleedSolo: true, pageNumbers: false,
  },
  vintage: {
    name: 'וינטג׳ פולארויד', desc: 'נייר ישן, פולארואידים עקומים וסלוטייפ',
    bg: '#eee3cc', text: '#4a3b2a', accent: '#a0522d',
    font: 'Amatic SC', titleWeight: 700, bodyWeight: 700,
    margin: 16, gap: 9, frame: 'polaroid', radius: 0, shadow: true, tilt: 4,
    paper: true, tape: true, fullBleedSolo: false, allowOverlap: true,
  },
  colorful: {
    name: 'צבעוני', desc: 'צבעי רקע שנלקחים מהתמונות, פינות מעוגלות',
    bg: 'auto', text: '#2a2a2a', accent: 'auto',
    font: 'Secular One', titleWeight: 400, bodyWeight: 400,
    margin: 13, gap: 5, frame: 'none', radius: 5, shadow: true, tilt: 0,
    blobs: true, fullBleedSolo: false,
  },
  magazine: {
    name: 'מגזין', desc: 'כותרות ענק, פס צבע, תמונות עד הקצה',
    bg: '#ffffff', text: '#111111', accent: '#d9432b',
    font: 'Heebo', titleWeight: 900, bodyWeight: 400,
    margin: 10, gap: 3, frame: 'none', radius: 0, shadow: false, tilt: 0,
    fullBleedSolo: true, pageNumbers: true, bars: true,
  },
};

export const FONTS = ['Frank Ruhl Libre', 'Rubik', 'Amatic SC', 'Secular One', 'Heebo'];

export async function ensureFonts() {
  if (!document.fonts) return;
  await Promise.all(FONTS.flatMap(f => [400, 700, 900].map(w =>
    document.fonts.load(`${w} 40px "${f}"`, 'אבגabc').catch(() => {}))));
}

// ---------- color helpers ----------
const mix = (c, d, t) => c.map((v, i) => Math.round(v * (1 - t) + d[i] * t));
const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

function pageColors(theme, page, photosById) {
  if (theme.bg !== 'auto') return { bg: theme.bg, text: theme.text, accent: theme.accent };
  const p = photosById.get(page.photos[0]);
  let base = p ? p.color : [200, 170, 140];
  // make it pleasant: boost saturation slightly and push towards pastel
  const pastel = mix(base, [255, 255, 255], 0.66);
  const deep = mix(base, [20, 20, 30], 0.45);
  return { bg: css(pastel), text: css(mix(base, [15, 15, 20], 0.75)), accent: css(deep), accentRGB: deep };
}

// ---------- drawing primitives ----------
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(ctx, img, photo, x, y, w, h) {
  const iw = img.width, ih = img.height;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s, sh = h / s;
  const f = photo?.focal || { x: 0.5, y: 0.5 };
  const sx = Math.max(0, Math.min(iw - sw, f.x * iw - sw / 2));
  const sy = Math.max(0, Math.min(ih - sh, f.y * ih - sh / 2));
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

const noiseCache = new Map();
function paperPattern(ctx, scale) {
  const key = Math.round(scale * 10);
  if (!noiseCache.has(key)) {
    const size = Math.round(160 * Math.max(1, scale / 4));
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const d = x.createImageData(size, size);
    const r = rng(7);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 120 + r() * 100;
      d.data[i] = v; d.data[i + 1] = v * 0.92; d.data[i + 2] = v * 0.8;
      d.data[i + 3] = r() * 26;
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

function drawText(ctx, text, x, y, { size, weight, family, color, maxW, align = 'center', shadow = false, baseline = 'middle' }) {
  if (!text) return 0;
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  const s = fitFont(ctx, text, weight, family, size, maxW);
  ctx.fillStyle = color;
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = s * 0.35; ctx.shadowOffsetY = s * 0.05; }
  ctx.fillText(text, x, y);
  ctx.restore();
  return s;
}

// Draws one photo inside a slot, with the theme's frame/tilt/shadow/tape.
function drawPhoto(ctx, img, photo, box, theme, k, r, opts = {}) {
  let { x, y, w, h } = box;
  const tilt = theme.tilt && !opts.noTilt ? (r() * 2 - 1) * theme.tilt * Math.PI / 180 : 0;
  ctx.save();
  if (tilt) {
    const shrink = 0.9;
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(tilt);
    w *= shrink; h *= shrink;
    x = -w / 2; y = -h / 2;
  }
  if (theme.frame === 'polaroid') {
    const b = Math.min(w, h) * 0.05;
    const bottom = Math.min(w, h) * 0.16;
    ctx.save();
    ctx.shadowColor = 'rgba(40,25,10,0.35)';
    ctx.shadowBlur = 3 * k; ctx.shadowOffsetY = 1.2 * k; ctx.shadowOffsetX = 0.6 * k;
    ctx.fillStyle = '#fdfcf8';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    if (img) drawCover(ctx, img, photo, x + b, y + b, w - 2 * b, h - b - bottom);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 0.2 * k;
    ctx.strokeRect(x + b, y + b, w - 2 * b, h - b - bottom);
  } else {
    const rad = (theme.radius || 0) * k;
    if (theme.shadow && !opts.full) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 3.5 * k; ctx.shadowOffsetY = 1.2 * k;
      ctx.fillStyle = '#fff';
      roundRectPath(ctx, x, y, w, h, rad); ctx.fill();
      ctx.restore();
    }
    ctx.save();
    roundRectPath(ctx, x, y, w, h, opts.full ? 0 : rad);
    ctx.clip();
    if (img) drawCover(ctx, img, photo, x, y, w, h);
    else { ctx.fillStyle = '#ccc'; ctx.fillRect(x, y, w, h); }
    ctx.restore();
    if (theme.frame === 'line' && !opts.full) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.25 * k;
      ctx.strokeRect(x + 0.1 * k, y + 0.1 * k, w - 0.2 * k, h - 0.2 * k);
    }
  }
  if (theme.tape && r() < 0.75) {
    const tw = Math.min(w, h) * 0.32, th = tw * 0.28;
    ctx.save();
    ctx.translate(x + w / 2 + (r() - 0.5) * w * 0.2, y + th * 0.15);
    ctx.rotate((r() - 0.5) * 0.35);
    ctx.fillStyle = 'rgba(245, 235, 200, 0.72)';
    ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 0.6 * k;
    ctx.fillRect(-tw / 2, -th / 2, tw, th);
    ctx.restore();
  }
  ctx.restore();
}

function drawBackground(ctx, W, H, colors, theme, k, r) {
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);
  if (theme.paper) {
    ctx.fillStyle = paperPattern(ctx, k);
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(90,60,20,0.22)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (theme.blobs) {
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

/**
 * Render a page.
 * env: { format:{w,h} (mm), bleed (mm), pxPerMm, theme, album, photosById,
 *        getImage(photo, wPx, hPx) -> Promise<ImageBitmap>, pageNumber }
 */
export async function renderPage(canvas, page, env) {
  const { format, theme, photosById, pxPerMm: k } = env;
  const bleed = env.bleed || 0;
  const W = Math.round((format.w + 2 * bleed) * k);
  const H = Math.round((format.h + 2 * bleed) * k);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const r = rng(Math.floor((page.variant || 0.5) * 1e9));
  const colors = pageColors(theme, page, photosById);
  const B = bleed * k;            // bleed in px
  const PW = format.w * k, PH = format.h * k; // trim size in px
  const M = theme.margin * k;
  const fam = theme.font;

  drawBackground(ctx, W, H, colors, theme, k, r);

  const photoOf = id => photosById.get(id);
  const load = async (p, w, h) => {
    if (!p) return null;
    try { return await env.getImage(p, w, h); } catch (e) { console.warn('image failed', e); return null; }
  };

  if (page.type === 'photos') {
    const tpl = templateById(page.template);
    if (!tpl) return;
    const gap = theme.gap * k;
    if (tpl.full) {
      const p = photoOf(page.photos[0]);
      const img = await load(p, W, H);
      drawPhoto(ctx, img, p, { x: 0, y: 0, w: W, h: H }, theme, k, r, { full: true, noTilt: true });
    } else {
      const cx = B + M - gap / 2, cy = B + M - gap / 2;
      const cw = PW - 2 * M + gap, ch = PH - 2 * M + gap;
      const imgs = await Promise.all(tpl.slots.map((s, i) => {
        const p = photoOf(page.photos[i]);
        return load(p, s.w * cw, s.h * ch);
      }));
      tpl.slots.forEach((s, i) => {
        const p = photoOf(page.photos[i]);
        // mirror horizontally: Hebrew albums read right-to-left
        const sx = 1 - s.x - s.w;
        const box = { x: cx + sx * cw + gap / 2, y: cy + s.y * ch + gap / 2, w: s.w * cw - gap, h: s.h * ch - gap };
        drawPhoto(ctx, imgs[i], p, box, theme, k, r);
      });
    }
    if (page.caption) {
      drawText(ctx, page.caption, B + PW / 2, B + PH - M * 0.45, {
        size: 5 * k, weight: theme.bodyWeight, family: fam, color: colors.text, maxW: PW - 2 * M,
        shadow: tpl.full, ...(tpl.full ? { color: '#fff' } : {}),
      });
    }
  } else if (page.type === 'cover') {
    await renderCover(ctx, page, env, { W, H, B, PW, PH, M, k, r, colors, load, photoOf });
  } else if (page.type === 'chapter') {
    await renderChapter(ctx, page, env, { W, H, B, PW, PH, M, k, r, colors, load, photoOf });
  } else if (page.type === 'end') {
    renderEnd(ctx, page, env, { W, H, B, PW, PH, M, k, r, colors });
  }

  if (theme.bars && page.type === 'photos' && !templateById(page.template)?.full) {
    ctx.fillStyle = colors.accent;
    ctx.fillRect(B + PW - M - 14 * k, B + M * 0.4, 14 * k, 1.2 * k);
  }
  if (theme.pageNumbers && env.pageNumber && page.type === 'photos' && !templateById(page.template)?.full) {
    const left = env.pageNumber % 2 === 0;
    drawText(ctx, String(env.pageNumber), left ? B + M * 0.5 : B + PW - M * 0.5, B + PH - M * 0.45, {
      size: 3.2 * k, weight: 400, family: fam, color: colors.text, maxW: 20 * k,
    });
  }
}

async function renderCover(ctx, page, env, g) {
  const { theme, album } = env;
  const { W, H, B, PW, PH, M, k, r, colors, load, photoOf } = g;
  const p = photoOf(page.photos[0]);
  const title = album.title || album.name || 'האלבום שלנו';
  const sub = album.subtitle || '';
  const fam = theme.font;

  if (theme.frame === 'polaroid') {
    const w = PW * 0.66, h = w * 1.12;
    const img = await load(p, w, h);
    drawPhoto(ctx, img, p, { x: B + (PW - w) / 2, y: B + PH * 0.08, w, h: Math.min(h, PH * 0.66) }, theme, k, r);
    drawText(ctx, title, B + PW / 2, B + PH * 0.83, { size: PH * 0.11, weight: 700, family: fam, color: colors.text, maxW: PW * 0.85 });
    drawText(ctx, sub, B + PW / 2, B + PH * 0.92, { size: PH * 0.05, weight: 700, family: fam, color: colors.accent, maxW: PW * 0.8 });
    return;
  }
  if (theme.id === 'classic' || theme.id === 'colorful') {
    const bw = PW - 2 * M * 1.4, bh = PH * 0.62;
    const img = await load(p, bw, bh);
    drawPhoto(ctx, img, p, { x: B + (PW - bw) / 2, y: B + M * 1.4, w: bw, h: bh }, theme, k, r, { noTilt: true });
    const ty = B + M * 1.4 + bh + (PH - M * 1.4 - bh) * 0.42;
    drawText(ctx, title, B + PW / 2, ty, { size: PH * 0.085, weight: theme.titleWeight, family: fam, color: colors.text, maxW: PW * 0.85 });
    if (theme.id === 'classic') {
      ctx.fillStyle = colors.accent;
      ctx.fillRect(B + PW / 2 - 12 * k, ty + PH * 0.055, 24 * k, 0.4 * k);
    }
    drawText(ctx, sub, B + PW / 2, ty + PH * 0.1, { size: PH * 0.038, weight: theme.bodyWeight, family: fam, color: colors.accent, maxW: PW * 0.8 });
    return;
  }
  // modern + magazine: full-bleed cover
  const img = await load(p, W, H);
  drawPhoto(ctx, img, p, { x: 0, y: 0, w: W, h: H }, theme, k, r, { full: true, noTilt: true });
  if (theme.id === 'magazine') {
    const gr = ctx.createLinearGradient(0, 0, 0, H * 0.45);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H * 0.45);
    drawText(ctx, title, B + PW - M, B + M + PH * 0.08, { size: PH * 0.16, weight: 900, family: fam, color: '#fff', maxW: PW - 2 * M, align: 'right', shadow: true });
    ctx.fillStyle = colors.accent;
    ctx.fillRect(B + PW - M - 30 * k, B + M + PH * 0.16, 30 * k, 2.2 * k);
    drawText(ctx, sub, B + PW - M, B + M + PH * 0.21, { size: PH * 0.045, weight: 700, family: fam, color: '#fff', maxW: PW - 2 * M, align: 'right', shadow: true });
  } else {
    const gr = ctx.createLinearGradient(0, H * 0.45, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = gr; ctx.fillRect(0, H * 0.45, W, H * 0.55);
    drawText(ctx, title, B + PW - M * 1.5, B + PH - M * 1.5 - PH * 0.08, { size: PH * 0.1, weight: 700, family: fam, color: '#fff', maxW: PW - 3 * M, align: 'right' });
    ctx.fillStyle = colors.accent;
    ctx.fillRect(B + PW - M * 1.5 - 18 * k, B + PH - M * 1.5 - PH * 0.025, 18 * k, 0.9 * k);
    drawText(ctx, sub, B + PW - M * 1.5, B + PH - M * 1.5 + PH * 0.005, { size: PH * 0.04, weight: 300, family: fam, color: '#f0f0f0', maxW: PW - 3 * M, align: 'right' });
  }
}

async function renderChapter(ctx, page, env, g) {
  const { theme } = env;
  const { W, H, B, PW, PH, M, k, r, colors, load, photoOf } = g;
  const p = photoOf(page.photos[0]);
  const fam = theme.font;
  const title = page.title || '';
  const sub = page.subtitle || '';

  if (theme.fullBleedSolo) {
    const img = await load(p, W, H);
    drawPhoto(ctx, img, p, { x: 0, y: 0, w: W, h: H }, theme, k, r, { full: true, noTilt: true });
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(0, 0, W, H);
    if (theme.bars) {
      ctx.fillStyle = colors.accent;
      ctx.fillRect(B + PW / 2 - 15 * k, B + PH / 2 - PH * 0.13, 30 * k, 2 * k);
    }
    drawText(ctx, title, B + PW / 2, B + PH / 2, { size: PH * 0.11, weight: theme.titleWeight, family: fam, color: '#fff', maxW: PW * 0.85, shadow: true });
    drawText(ctx, sub, B + PW / 2, B + PH / 2 + PH * 0.09, { size: PH * 0.045, weight: theme.bodyWeight, family: fam, color: '#fff', maxW: PW * 0.8, shadow: true });
    return;
  }
  const w = PW - 2 * M * 1.6, h = PH * 0.6;
  const img = await load(p, w, h);
  drawPhoto(ctx, img, p, { x: B + (PW - w) / 2, y: B + M * 1.4, w, h }, theme, k, r);
  const ty = B + M * 1.4 + h + (PH - M * 1.4 - h) * 0.42;
  drawText(ctx, title, B + PW / 2, ty, { size: PH * (theme.frame === 'polaroid' ? 0.11 : 0.075), weight: theme.titleWeight, family: fam, color: colors.text, maxW: PW * 0.85 });
  if (sub) drawText(ctx, sub, B + PW / 2, ty + PH * 0.08, { size: PH * 0.04, weight: theme.bodyWeight, family: fam, color: colors.accent, maxW: PW * 0.8 });
  else {
    // ornament
    ctx.fillStyle = colors.accent;
    const oy = ty + PH * 0.065;
    ctx.fillRect(B + PW / 2 - 10 * k, oy, 20 * k, 0.4 * k);
    ctx.beginPath(); ctx.arc(B + PW / 2, oy + 0.2 * k, 1.1 * k, 0, Math.PI * 2); ctx.fill();
  }
}

function renderEnd(ctx, page, env, g) {
  const { theme, album } = env;
  const { B, PW, PH, k, colors } = g;
  const fam = theme.font;
  const text = page.title || (page.quote ? 'הרגעים הקטנים הם הגדולים באמת' : 'נוצר באהבה');
  const sub = page.subtitle ?? (page.quote ? '' : (album.yearRange || ''));
  drawText(ctx, text, B + PW / 2, B + PH * 0.47, { size: PH * (theme.frame === 'polaroid' ? 0.09 : 0.06), weight: theme.titleWeight, family: fam, color: colors.text, maxW: PW * 0.8 });
  ctx.fillStyle = colors.accent;
  ctx.beginPath(); ctx.arc(B + PW / 2, B + PH * 0.54, 1.3 * k, 0, Math.PI * 2); ctx.fill();
  drawText(ctx, sub, B + PW / 2, B + PH * 0.6, { size: PH * 0.035, weight: theme.bodyWeight, family: fam, color: colors.accent, maxW: PW * 0.8 });
}

for (const [id, t] of Object.entries(THEMES)) t.id = id;
