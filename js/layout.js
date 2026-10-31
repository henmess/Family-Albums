// Automatic album layout: chooses page templates, groups photos into
// chapters (events) and assigns photos to slots so cropping is minimal.
import { isIncluded } from './analyze.js?v=7';
import { uid } from './db.js?v=7';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T = (id, slots, extra = {}) => ({ id, slots: slots.map(([x, y, w, h]) => ({ x, y, w, h })), ...extra });
const third = 1 / 3;

// Slots are in the unit square of the page content area (inside margins).
export const TEMPLATES = [
  // 1 photo
  T('solo', [[0, 0, 1, 1]]),
  T('solo-full', [[0, 0, 1, 1]], { full: true }),
  T('solo-inset', [[0.1, 0.08, 0.8, 0.84]]),
  // 2 photos
  T('duo-cols', [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]),
  T('duo-rows', [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]]),
  T('duo-big-small', [[0, 0, 0.64, 1], [0.64, 0, 0.36, 1]]),
  T('duo-steps', [[0, 0, 0.6, 0.58], [0.4, 0.42, 0.6, 0.58]], { overlap: true }),
  T('duo-overlap', [[0, 0.05, 0.62, 0.62], [0.38, 0.35, 0.62, 0.62]], { overlap: true }),
  T('duo-centered', [[0, 0.12, 0.5, 0.76], [0.5, 0.12, 0.5, 0.76]]),
  // 3 photos
  T('tri-big-right', [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]]),
  T('tri-big-top', [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]]),
  T('tri-big-bottom', [[0, 0, 0.5, 0.4], [0.5, 0, 0.5, 0.4], [0, 0.4, 1, 0.6]]),
  T('tri-cols', [[0, 0, third, 1], [third, 0, third, 1], [2 * third, 0, third, 1]]),
  T('tri-rows', [[0, 0, 1, third], [0, third, 1, third], [0, 2 * third, 1, third]]),
  T('tri-scatter', [[0, 0, 0.55, 0.5], [0.45, 0.25, 0.55, 0.5], [0, 0.5, 0.55, 0.5]], { overlap: true }),
  T('tri-diagonal', [[0, 0, 0.52, 0.48], [0.24, 0.26, 0.52, 0.48], [0.48, 0.52, 0.52, 0.48]], { overlap: true }),
  T('tri-hero-center', [[0.2, 0, 0.6, 0.62], [0, 0.62, 0.5, 0.38], [0.5, 0.62, 0.5, 0.38]]),
  // 4 photos
  T('quad-row', [[0, 0.2, 0.25, 0.6], [0.25, 0.2, 0.25, 0.6], [0.5, 0.2, 0.25, 0.6], [0.75, 0.2, 0.25, 0.6]]),
  T('quad-scatter', [[0, 0, 0.55, 0.5], [0.45, 0.04, 0.55, 0.46], [0.02, 0.52, 0.5, 0.48], [0.48, 0.48, 0.52, 0.52]], { overlap: true }),
  T('quad-grid', [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]),
  T('quad-hero-strip', [[0, 0, 1, 0.64], [0, 0.64, third, 0.36], [third, 0.64, third, 0.36], [2 * third, 0.64, third, 0.36]]),
  T('quad-hero-side', [[0, 0, 0.62, 1], [0.62, 0, 0.38, third], [0.62, third, 0.38, third], [0.62, 2 * third, 0.38, third]]),
  T('quad-mosaic', [[0, 0, 0.58, 0.55], [0.58, 0, 0.42, 0.55], [0, 0.55, 0.42, 0.45], [0.42, 0.55, 0.58, 0.45]]),
  // 5 photos
  T('penta', [[0, 0, 0.5, 0.55], [0.5, 0, 0.5, 0.55], [0, 0.55, third, 0.45], [third, 0.55, third, 0.45], [2 * third, 0.55, third, 0.45]]),
  T('penta-hero', [[0.25, 0.25, 0.5, 0.5], [0, 0, 0.5, 0.25], [0.5, 0, 0.5, 0.25], [0, 0.75, 0.5, 0.25], [0.5, 0.75, 0.5, 0.25]]),
  // 6 photos
  T('hexa-grid', [[0, 0, third, 0.5], [third, 0, third, 0.5], [2 * third, 0, third, 0.5], [0, 0.5, third, 0.5], [third, 0.5, third, 0.5], [2 * third, 0.5, third, 0.5]]),
];

const byCount = n => TEMPLATES.filter(t => t.slots.length === n);
export const templateById = id => TEMPLATES.find(t => t.id === id);

const DENSITY = {
  airy:   { 1: 0.3, 2: 0.4, 3: 0.2, 4: 0.1 },
  normal: { 1: 0.12, 2: 0.28, 3: 0.32, 4: 0.2, 5: 0.05, 6: 0.03 },
  packed: { 1: 0.05, 2: 0.15, 3: 0.25, 4: 0.3, 5: 0.15, 6: 0.1 },
};

function pickWeighted(weights, r) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of entries) { if ((x -= w) <= 0) return +k; }
  return +entries[entries.length - 1][0];
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((v, i) => {
    for (const p of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([v, ...p]);
  });
  return out;
}

// cost of placing photos into a template (crop amount)
function fitTemplate(tpl, photos, contentAR) {
  const idx = photos.map((_, i) => i);
  const perms = photos.length <= 5 ? permutations(idx) : [idx];
  let best = null;
  for (const perm of perms) {
    let cost = 0;
    perm.forEach((pi, si) => {
      const s = tpl.slots[si];
      const slotAR = (s.w / s.h) * contentAR;
      const p = photos[pi];
      cost += Math.abs(Math.log(slotAR / (p.width / p.height)));
    });
    // prefer keeping chronological order a little
    perm.forEach((pi, si) => { if (pi !== si) cost += 0.03; });
    if (!best || cost < best.cost) best = { cost, perm };
  }
  best.cost /= photos.length;
  return best;
}

export function chooseTemplate(photos, contentAR, r, opts = {}) {
  let cands = byCount(photos.length);
  if (!opts.allowFull) cands = cands.filter(t => !t.full);
  if (!opts.allowOverlap) cands = cands.filter(t => !t.overlap);
  if (opts.avoid) {
    const f = cands.filter(t => t.id !== opts.avoid);
    if (f.length) cands = f;
  }
  const scored = cands.map(t => ({ t, ...fitTemplate(t, photos, contentAR) }))
    .sort((a, b) => a.cost - b.cost);
  const min = scored[0].cost;
  const good = scored.filter(s => s.cost <= min + 0.35);
  const pick = good[Math.floor(r() * good.length)];
  return { template: pick.t.id, photos: pick.perm.map(i => photos[i].id) };
}

export function splitEvents(photos, gapHours = 5) {
  const events = [];
  let cur = [];
  for (const p of photos) {
    if (cur.length && p.date - cur[cur.length - 1].date > gapHours * 3600 * 1000) {
      events.push(cur); cur = [];
    }
    cur.push(p);
  }
  if (cur.length) events.push(cur);
  return events;
}

export function contentAspect(format, theme) {
  const m = theme.margin;
  return (format.w - 2 * m) / (format.h - 2 * m);
}

const monthFmt = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

export function eventTitle(event) {
  const a = new Date(event[0].date), b = new Date(event[event.length - 1].date);
  if (a.toDateString() === b.toDateString()) return dayFmt.format(a);
  return monthFmt.format(a);
}

// ---------------- album generation ----------------
export function generateAlbum(allPhotos, settings, theme) {
  const r = rng(settings.seed || 1);
  const format = settings.format;
  const contentAR = contentAspect(format, theme);
  const fullOK = theme.fullBleedSolo;
  const overlapOK = !!theme.allowOverlap;

  let photos = allPhotos.filter(isIncluded);
  if (!photos.length) return [];
  if (settings.maxPhotos && photos.length > settings.maxPhotos) {
    photos = [...photos].sort((a, b) => b.quality.score - a.quality.score).slice(0, settings.maxPhotos);
  }
  photos = [...photos].sort((a, b) => a.date - b.date);

  const pages = [];
  // cover: best photo, preferring the page's orientation
  const pageAR = format.w / format.h;
  const coverPhoto = [...photos].sort((a, b) => {
    const fa = a.quality.score - 0.15 * Math.abs(Math.log((a.width / a.height) / pageAR));
    const fb = b.quality.score - 0.15 * Math.abs(Math.log((b.width / b.height) / pageAR));
    return fb - fa;
  })[0];
  pages.push({ id: uid(), type: 'cover', photos: [coverPhoto.id], variant: r() });
  if (photos.length > 8) photos = photos.filter(p => p !== coverPhoto);

  const scores = photos.map(p => p.quality.score).sort((a, b) => a - b);
  const heroThreshold = scores[Math.floor(scores.length * 0.85)] ?? 1;
  const weights = DENSITY[settings.density] || DENSITY.normal;

  let lastTpl = null;
  const events = splitEvents(photos);
  for (const ev of events) {
    let flow = ev;
    let hasChapter = false;
    if (settings.chapters && events.length > 1 && ev.length >= 5) {
      hasChapter = true;
      const hero = [...ev].sort((a, b) => b.quality.score - a.quality.score)[0];
      pages.push({ id: uid(), type: 'chapter', photos: [hero.id], title: eventTitle(ev), variant: r() });
      flow = ev.filter(p => p !== hero);
    }
    let i = 0;
    while (i < flow.length) {
      const remaining = flow.length - i;
      let n;
      if (flow[i].quality.score >= heroThreshold && r() < 0.35) n = 1;
      else n = pickWeighted(weights, r);
      n = Math.min(n, remaining);
      // avoid leaving a lonely single photo at the end of an event
      if (remaining - n === 1 && n < 6) n += 1;
      const group = flow.slice(i, i + n);
      const useFull = n === 1 && fullOK && r() < 0.7;
      const choice = useFull
        ? { template: 'solo-full', photos: [group[0].id] }
        : chooseTemplate(group, contentAR, r, { allowOverlap: overlapOK, avoid: lastTpl });
      lastTpl = choice.template;
      const page = { id: uid(), type: 'photos', ...choice, variant: r() };
      if (i === 0 && !hasChapter && events.length > 1) page.label = eventTitle(ev);
      pages.push(page);
      i += n;
    }
  }
  pages.push({ id: uid(), type: 'end', photos: [], variant: r() });

  // keep the interior (everything except the cover) an even page count
  if ((pages.length - 1) % 2 === 1) {
    const photosById = new Map(allPhotos.map(p => [p.id, p]));
    const idx = pages.findIndex(p => p.type === 'photos' && p.photos.length >= 4);
    const splitIdx = idx >= 0 ? idx : pages.findIndex(p => p.type === 'photos' && p.photos.length >= 2);
    if (splitIdx >= 0) {
      const pg = pages[splitIdx];
      const ps = pg.photos.map(id => photosById.get(id)).sort((a, b) => a.date - b.date);
      const half = Math.ceil(ps.length / 2);
      const a = chooseTemplate(ps.slice(0, half), contentAR, r, { allowOverlap: overlapOK, allowFull: fullOK });
      const b = chooseTemplate(ps.slice(half), contentAR, r, { allowOverlap: overlapOK, allowFull: fullOK, avoid: a.template });
      pages.splice(splitIdx, 1,
        { id: uid(), type: 'photos', ...a, variant: r() },
        { id: uid(), type: 'photos', ...b, variant: r() });
    } else {
      pages.splice(pages.length - 1, 0, { id: uid(), type: 'end', photos: [], variant: r(), quote: true });
    }
  }
  return pages;
}

// re-design a single page with a different template
export function rerollPage(page, photosById, settings, theme) {
  const r = rng(Math.floor(Math.random() * 1e9));
  if (page.type !== 'photos') return { ...page, variant: r() };
  const ps = page.photos.map(id => photosById.get(id)).filter(Boolean);
  if (!ps.length) return page;
  const contentAR = contentAspect(settings.format, theme);
  const choice = chooseTemplate(ps, contentAR, r, {
    allowOverlap: !!theme.allowOverlap, allowFull: theme.fullBleedSolo, avoid: page.template,
  });
  const { shapes, ...rest } = page; // shapes belong to the old slots
  return { ...rest, ...choice, variant: r() };
}
