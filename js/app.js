import * as db from './db.js';
import { analyzeFile, curate, isIncluded } from './analyze.js';
import { generateAlbum, rerollPage, templateById } from './layout.js';
import { THEMES, renderPage, ensureFonts } from './render.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

export const FORMATS = {
  sq20: { w: 200, h: 200, name: 'ריבועי 20×20 ס"מ' },
  sq25: { w: 250, h: 250, name: 'ריבועי 25×25 ס"מ' },
  sq30: { w: 300, h: 300, name: 'ריבועי 30×30 ס"מ' },
  l2822: { w: 280, h: 215, name: 'לרוחב 28×21.5 ס"מ' },
  a4l: { w: 297, h: 210, name: 'A4 לרוחב' },
  a4p: { w: 210, h: 297, name: 'A4 לאורך' },
};

const state = {
  album: null,
  photos: [],
  filter: 'all',
  thumbCache: new Map(),
  dpi: 300,
};

// ---------------- helpers ----------------
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

function modal(title, bodyHtml, okText = 'אישור') {
  return new Promise(resolve => {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    $('#modalOk').textContent = okText;
    $('#modal').classList.remove('hidden');
    const first = $('#modalBody input, #modalBody textarea');
    if (first) setTimeout(() => first.focus(), 30);
    const done = ok => {
      $('#modal').classList.add('hidden');
      $('#modalOk').onclick = $('#modalCancel').onclick = null;
      resolve(ok ? $('#modalBody') : null);
    };
    $('#modalOk').onclick = () => done(true);
    $('#modalCancel').onclick = () => done(false);
  });
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function thumbBitmap(p) {
  if (state.thumbCache.has(p.id)) return state.thumbCache.get(p.id);
  const pr = createImageBitmap(p.thumb).then(b => { thumbSet.add(b); return b; });
  state.thumbCache.set(p.id, pr);
  return pr;
}

const thumbSet = new WeakSet();
const photosById = () => new Map(state.photos.map(p => [p.id, p]));
const themeOf = a => THEMES[a.theme] || THEMES.classic;
const formatOf = a => FORMATS[a.format] || FORMATS.sq20;

function settingsOf(a) {
  return { seed: a.seed, format: formatOf(a), density: a.density, chapters: a.chapters, maxPhotos: a.maxPhotos };
}

function yearRange(photos) {
  if (!photos.length) return '';
  const ys = photos.map(p => new Date(p.date).getFullYear());
  const a = Math.min(...ys), b = Math.max(...ys);
  return a === b ? String(a) : `${a}–${b}`;
}

// ---------------- routing ----------------
async function route() {
  const m = location.hash.match(/^#album\/([^/]+)(?:\/(\w+))?/);
  if (m) await openAlbum(m[1], m[2] || 'photos');
  else await showHome();
}
window.addEventListener('hashchange', route);

// ---------------- home ----------------
async function showHome() {
  state.album = null;
  for (const b of state.thumbCache.values()) b.then(x => x.close && x.close()).catch(() => {});
  state.thumbCache.clear();
  $('#albumView').classList.add('hidden');
  $('#homeView').classList.remove('hidden');
  const albums = await db.listAlbums();
  const grid = $('#albumGrid');
  if (!albums.length) {
    grid.innerHTML = `<div class="empty">
      <div class="empty-icon">📚</div>
      <p>עדיין אין אלבומים. צרו את האלבום הראשון – למשל "חופשה באילת" או "שנה ראשונה של נועה".</p>
    </div>`;
    return;
  }
  grid.innerHTML = albums.map(a => `
    <a class="album-card" href="#album/${a.id}">
      <div class="album-cover">${a.coverThumb ? `<img src="${URL.createObjectURL(a.coverThumb)}" alt="">` : '<span>📷</span>'}</div>
      <div class="album-info">
        <strong>${esc(a.name)}</strong>
        <span>${a.photoCount || 0} תמונות · ${THEMES[a.theme]?.name || ''}</span>
      </div>
    </a>`).join('');
}

$('#newAlbumBtn').onclick = async () => {
  const body = await modal('אלבום חדש', `
    <label class="lbl">שם האלבום</label>
    <input class="input" id="newName" placeholder="למשל: חופשה משפחתית ביוון">`, 'יצירה');
  if (!body) return;
  const name = body.querySelector('#newName').value.trim() || 'אלבום חדש';
  const album = {
    id: db.uid(), name, title: name, subtitle: '', created: Date.now(),
    theme: 'classic', format: 'sq20', density: 'normal', chapters: true,
    maxPhotos: 0, bleed: 0, seed: Math.floor(Math.random() * 1e9), pages: null, photoCount: 0,
  };
  await db.saveAlbum(album);
  location.hash = `#album/${album.id}`;
};

$('#homeLink').onclick = e => { e.preventDefault(); location.hash = ''; };
$('#backBtn').onclick = () => { location.hash = ''; };

// ---------------- album ----------------
async function openAlbum(id, tab) {
  if (!state.album || state.album.id !== id) {
    const album = await db.getAlbum(id);
    if (!album) { location.hash = ''; return; }
    state.album = album;
    state.photos = await db.listPhotos(id);
  }
  $('#homeView').classList.add('hidden');
  $('#albumView').classList.remove('hidden');
  $('#albumName').textContent = state.album.name;
  showTab(tab);
}

$('#albumName').addEventListener('blur', async () => {
  const name = $('#albumName').textContent.trim();
  if (!state.album || !name || name === state.album.name) return;
  if (state.album.title === state.album.name) state.album.title = name;
  state.album.name = name;
  await db.saveAlbum(state.album);
});
$('#albumName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

$('#deleteAlbumBtn').onclick = async () => {
  const ok = await modal('מחיקת אלבום', `<p>למחוק את "${esc(state.album.name)}" ואת כל התמונות שבו? אי אפשר לבטל.</p>`, 'מחיקה');
  if (!ok) return;
  await db.deleteAlbum(state.album.id);
  location.hash = '';
};

$$('.tab').forEach(t => t.onclick = () => { location.hash = `#album/${state.album.id}/${t.dataset.tab}`; });

function showTab(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('#photosTab').classList.toggle('hidden', tab !== 'photos');
  $('#designTab').classList.toggle('hidden', tab !== 'design');
  if (tab === 'photos') renderPhotos();
  else openDesign();
}

// ---------------- photos tab ----------------
const fileInput = $('#fileInput');
fileInput.onchange = () => { addFiles([...fileInput.files]); fileInput.value = ''; };
const dz = $('#dropzone');
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));

async function addFiles(files) {
  files = files.filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  if (!files.length) return;
  const album = state.album;
  const prog = $('#progress');
  prog.classList.remove('hidden');
  const existing = new Set(state.photos.map(p => p.name + '|' + p.size));
  let done = 0, failed = 0, skipped = 0;
  for (const f of files) {
    prog.querySelector('.label').textContent = `מנתח תמונות… ${done + 1} מתוך ${files.length}`;
    prog.querySelector('.bar').style.width = `${(done / files.length) * 100}%`;
    if (existing.has(f.name + '|' + f.size)) { skipped++; done++; continue; }
    try {
      const info = await analyzeFile(f);
      const photo = { id: db.uid(), albumId: album.id, name: f.name, size: f.size, manual: null, ...info };
      await db.savePhoto(photo, f);
      state.photos.push(photo);
    } catch (e) {
      console.warn('failed', f.name, e);
      failed++;
    }
    done++;
  }
  prog.querySelector('.bar').style.width = '100%';
  prog.querySelector('.label').textContent = 'מזהה כפילויות ובוחר את התמונות הטובות…';
  await recurate();
  prog.classList.add('hidden');
  if (album.pages) album.needsRedesign = true;
  await db.saveAlbum(album);
  renderPhotos();
  let msg = `נוספו ${done - failed - skipped} תמונות`;
  if (skipped) msg += ` · ${skipped} כבר היו באלבום`;
  if (failed) msg += ` · ${failed} לא נתמכו (למשל HEIC – נסו להמיר ל-JPG)`;
  toast(msg, 5000);
}

async function recurate() {
  const before = new Map(state.photos.map(p => [p.id, `${p.duplicate}|${p.weak}|${p.dupGroup}`]));
  curate(state.photos);
  for (const p of state.photos) {
    if (before.get(p.id) !== `${p.duplicate}|${p.weak}|${p.dupGroup}`) await db.updatePhoto(p);
  }
  const a = state.album;
  a.photoCount = state.photos.length;
  a.yearRange = yearRange(state.photos.filter(isIncluded));
  const best = [...state.photos].filter(isIncluded).sort((x, y) => y.quality.score - x.quality.score)[0];
  a.coverThumb = best ? best.thumb : null;
}

function renderPhotos() {
  const photos = [...state.photos].sort((a, b) => a.date - b.date);
  const has = photos.length > 0;
  $('#photoStats').classList.toggle('hidden', !has);
  $('#filters').classList.toggle('hidden', !has);
  $('#toDesignRow').classList.toggle('hidden', !has);
  const inc = photos.filter(isIncluded).length;
  const dups = photos.filter(p => p.duplicate).length;
  const weak = photos.filter(p => p.weak && !p.duplicate).length;
  $('#photoStats').innerHTML = `
    <div><b>${photos.length}</b><span>הועלו</span></div>
    <div class="good"><b>${inc}</b><span>נבחרו לאלבום</span></div>
    <div><b>${dups}</b><span>כפילויות שסוננו</span></div>
    <div><b>${weak}</b><span>מטושטשות / חשוכות</span></div>`;

  const grid = $('#photoGrid');
  grid.innerHTML = '';
  const filtered = photos.filter(p => {
    if (state.filter === 'in') return isIncluded(p);
    if (state.filter === 'dup') return p.dupGroup;
    if (state.filter === 'weak') return p.weak;
    return true;
  });
  if (state.filter === 'dup') filtered.sort((a, b) => (a.dupGroup > b.dupGroup ? 1 : -1) || b.quality.score - a.quality.score);

  const groupColors = new Map();
  const palette = ['#e76f51', '#2a9d8f', '#8e44ad', '#e9c46a', '#3a86ff', '#ff006e', '#06d6a0', '#8338ec'];
  for (const p of filtered) {
    if (p.dupGroup && !groupColors.has(p.dupGroup)) groupColors.set(p.dupGroup, palette[groupColors.size % palette.length]);
    const el = document.createElement('div');
    const included = isIncluded(p);
    el.className = 'photo' + (included ? ' in' : ' out');
    if (p.dupGroup) el.style.setProperty('--group', groupColors.get(p.dupGroup));
    const stars = Math.max(1, Math.round(p.quality.score * 5));
    let badge = '';
    if (p.duplicate) badge = '<span class="badge dup">כפילות</span>';
    else if (p.dupGroup) badge = '<span class="badge best">הנבחרת מהסדרה</span>';
    if (p.weak) badge += '<span class="badge weak">חלשה</span>';
    if (p.manual) badge += `<span class="badge manual">${p.manual === 'in' ? 'נבחרה ידנית' : 'הוצאה ידנית'}</span>`;
    el.innerHTML = `
      <img loading="lazy" alt="">
      <div class="ph-top">${badge}</div>
      <div class="ph-bottom"><span class="stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>
        <button class="del" title="מחיקה מהאלבום">🗑</button></div>
      <div class="check">${included ? '✓' : ''}</div>`;
    const url = URL.createObjectURL(p.thumb);
    const img = el.querySelector('img');
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    el.onclick = async e => {
      if (e.target.closest('.del')) return;
      const auto = !p.duplicate && !p.weak;
      p.manual = included ? (auto ? 'out' : null) : (auto ? null : 'in');
      await db.updatePhoto(p);
      markChanged();
      renderPhotos();
    };
    el.querySelector('.del').onclick = async e => {
      e.stopPropagation();
      await db.deletePhoto(p.id);
      state.photos = state.photos.filter(x => x.id !== p.id);
      await recurate();
      markChanged();
      renderPhotos();
    };
    grid.appendChild(el);
  }
}

function markChanged() {
  if (state.album.pages) state.album.needsRedesign = true;
  db.saveAlbum(state.album);
}

$$('#filters .chip').forEach(c => c.onclick = () => {
  state.filter = c.dataset.filter;
  $$('#filters .chip').forEach(x => x.classList.toggle('active', x === c));
  renderPhotos();
});

$('#toDesignBtn').onclick = () => { location.hash = `#album/${state.album.id}/design`; };

// ---------------- design tab ----------------
let renderToken = 0;

async function openDesign() {
  const a = state.album;
  $('#titleInput').value = a.title || '';
  $('#subtitleInput').value = a.subtitle || '';
  $('#formatSelect').innerHTML = Object.entries(FORMATS).map(([k, f]) => `<option value="${k}" ${k === a.format ? 'selected' : ''}>${f.name}</option>`).join('');
  $$('#densitySeg button').forEach(b => b.classList.toggle('active', b.dataset.v === a.density));
  $$('#dpiSeg button').forEach(b => b.classList.toggle('active', +b.dataset.v === state.dpi));
  $('#chaptersChk').checked = !!a.chapters;
  $('#bleedChk').checked = !!a.bleed;
  const inc = state.photos.filter(isIncluded).length;
  const range = $('#maxPhotos');
  range.max = Math.max(1, inc);
  range.min = Math.min(inc, 10);
  range.value = a.maxPhotos && a.maxPhotos < inc ? a.maxPhotos : inc;
  updateMaxLabel();

  await ensureFonts();
  if (!state.photos.filter(isIncluded).length) {
    renderThemePicker();
    $('#pages').innerHTML = '<div class="empty"><p>אין עדיין תמונות באלבום. חזרו ללשונית "התמונות" והעלו כמה.</p></div>';
    return;
  }
  if (!a.pages) await regenerate(false);
  renderThemePicker();
  $('#redesignBanner').classList.toggle('hidden', !a.needsRedesign);
  renderPages();
}

function updateMaxLabel() {
  const inc = state.photos.filter(isIncluded).length;
  const v = +$('#maxPhotos').value;
  $('#maxPhotosLabel').textContent = v >= inc ? `כולן (${inc})` : `${v} הטובות ביותר`;
}

async function regenerate(newSeed = true) {
  const a = state.album;
  if (newSeed) a.seed = Math.floor(Math.random() * 1e9);
  a.pages = generateAlbum(state.photos, settingsOf(a), themeOf(a));
  a.needsRedesign = false;
  a.yearRange = yearRange(state.photos.filter(isIncluded));
  await db.saveAlbum(a);
  $('#redesignBanner').classList.add('hidden');
}

async function renderThemePicker() {
  const a = state.album;
  const wrap = $('#themePicker');
  wrap.innerHTML = '';
  const cover = a.pages?.find(p => p.type === 'cover');
  for (const [id, t] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.className = 'theme-card' + (id === a.theme ? ' active' : '');
    b.innerHTML = `<canvas></canvas><div><strong>${t.name}</strong><small>${t.desc}</small></div>`;
    b.onclick = async () => {
      if (a.theme === id) return;
      a.theme = id;
      $$('.theme-card').forEach(x => x.classList.toggle('active', x === b));
      await regenerate(false);
      renderPages();
      renderThemePicker();
    };
    wrap.appendChild(b);
    if (cover) {
      const f = { w: 60, h: 60 * formatOf(a).h / formatOf(a).w };
      renderPage(b.querySelector('canvas'), cover, {
        format: f, theme: { ...t, margin: t.margin * 0.3, gap: t.gap * 0.3 }, album: a,
        photosById: photosById(), pxPerMm: 2, getImage: thumbBitmap,
      }).catch(() => {});
    }
  }
}

$('#titleInput').oninput = debounce(async () => { state.album.title = $('#titleInput').value; await db.saveAlbum(state.album); rerenderPagesOfType('cover'); }, 350);
$('#subtitleInput').oninput = debounce(async () => { state.album.subtitle = $('#subtitleInput').value; await db.saveAlbum(state.album); rerenderPagesOfType('cover'); }, 350);
$('#formatSelect').onchange = async e => { state.album.format = e.target.value; await regenerate(false); renderPages(); renderThemePicker(); };
$$('#densitySeg button').forEach(b => b.onclick = async () => {
  state.album.density = b.dataset.v;
  $$('#densitySeg button').forEach(x => x.classList.toggle('active', x === b));
  await regenerate(false); renderPages();
});
$$('#dpiSeg button').forEach(b => b.onclick = () => {
  state.dpi = +b.dataset.v;
  $$('#dpiSeg button').forEach(x => x.classList.toggle('active', x === b));
});
$('#maxPhotos').oninput = updateMaxLabel;
$('#maxPhotos').onchange = async () => {
  const inc = state.photos.filter(isIncluded).length;
  const v = +$('#maxPhotos').value;
  state.album.maxPhotos = v >= inc ? 0 : v;
  await regenerate(false); renderPages();
};
$('#chaptersChk').onchange = async e => { state.album.chapters = e.target.checked; await regenerate(false); renderPages(); };
$('#bleedChk').onchange = async e => { state.album.bleed = e.target.checked ? 3 : 0; await db.saveAlbum(state.album); toast(e.target.checked ? 'יתווספו 3 מ"מ מכל צד בקובץ ההדפסה' : 'ללא שולי חיתוך'); };
$('#regenBtn').onclick = async () => { await regenerate(true); renderPages(); renderThemePicker(); };
$('#bannerRegen').onclick = async () => { await regenerate(true); renderPages(); renderThemePicker(); };

function debounce(fn, ms) {
  let h;
  return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
}

const PAGE_LABEL = { cover: 'כריכה', chapter: 'פתיחת פרק', end: 'סיום' };

function previewEnv(pageNumber) {
  const a = state.album;
  const f = formatOf(a);
  const cssW = f.w >= f.h ? 340 : 260;
  return {
    format: f, theme: themeOf(a), album: a, photosById: photosById(), bleed: 0,
    pxPerMm: (cssW * Math.min(2, devicePixelRatio || 1)) / f.w,
    getImage: thumbBitmap, pageNumber,
  };
}

function renderPages() {
  const a = state.album;
  const token = ++renderToken;
  const pages = a.pages || [];
  const host = $('#pages');
  host.innerHTML = '';
  const f = formatOf(a);
  host.style.setProperty('--ar', `${f.w} / ${f.h}`);
  host.classList.toggle('portrait', f.h > f.w);

  // cover alone, then spreads of two
  const spreads = [[0]];
  for (let i = 1; i < pages.length; i += 2) spreads.push(pages[i + 1] ? [i, i + 1] : [i]);

  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      drawPreview(en.target, token);
    }
  }, { rootMargin: '400px' });

  spreads.forEach(sp => {
    const s = document.createElement('div');
    s.className = 'spread' + (sp.length === 1 ? ' single' : '');
    for (const i of sp) {
      const pg = pages[i];
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.index = i;
      const label = i === 0 ? 'כריכה' : (PAGE_LABEL[pg.type] ? `${PAGE_LABEL[pg.type]} · ${i}` : `עמוד ${i}`);
      el.innerHTML = `
        <div class="canvas-wrap"><canvas></canvas></div>
        <div class="page-bar">
          <span class="pnum">${label}</span>
          <div class="acts">
            ${pg.type === 'photos' ? '<button data-act="reroll" title="פריסה אחרת">🔄</button><button data-act="shuffle" title="ערבוב סדר התמונות">🔀</button>' : '<button data-act="reroll" title="וריאציה">🔄</button>'}
            <button data-act="text" title="טקסט">✏️</button>
            ${i > 1 ? '<button data-act="up" title="הזזה אחורה">⬅</button>' : ''}
            ${i > 0 && i < pages.length - 1 ? '<button data-act="down" title="הזזה קדימה">➡</button>' : ''}
            ${i > 0 ? '<button data-act="del" title="מחיקת העמוד">🗑</button>' : ''}
          </div>
        </div>`;
      el.querySelectorAll('[data-act]').forEach(btn => btn.onclick = () => pageAction(i, btn.dataset.act));
      s.appendChild(el);
      io.observe(el);
    }
    host.appendChild(s);
  });

  const interior = pages.length - 1;
  $('#pageCount').textContent = `${interior} עמודים פנימיים + כריכה · ${state.photos.filter(isIncluded).length} תמונות`;
}

async function drawPreview(el, token) {
  const i = +el.dataset.index;
  const page = state.album.pages[i];
  if (!page || token !== renderToken) return;
  const c = document.createElement('canvas');
  el.classList.add('loading');
  try {
    await renderPage(c, page, previewEnv(i));
  } catch (e) { console.error(e); }
  if (token !== renderToken) return;
  const old = el.querySelector('canvas');
  old.replaceWith(c);
  el.classList.remove('loading');
}

function rerenderPage(i) {
  const el = $(`#pages .page[data-index="${i}"]`);
  if (el) drawPreview(el, renderToken);
}
function rerenderPagesOfType(type) {
  (state.album.pages || []).forEach((p, i) => { if (p.type === type) rerenderPage(i); });
  if (type === 'cover') renderThemePicker();
}

async function pageAction(i, act) {
  const a = state.album;
  const pages = a.pages;
  const pg = pages[i];
  if (act === 'reroll') {
    pages[i] = rerollPage(pg, photosById(), settingsOf(a), themeOf(a));
    await db.saveAlbum(a);
    rerenderPage(i);
    return;
  }
  if (act === 'shuffle') {
    const ids = [...pg.photos];
    for (let k = ids.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [ids[k], ids[j]] = [ids[j], ids[k]]; }
    pg.photos = ids;
    await db.saveAlbum(a);
    rerenderPage(i);
    return;
  }
  if (act === 'text') {
    const isPhotos = pg.type === 'photos';
    const isCover = pg.type === 'cover';
    const body = await modal(isCover ? 'כותרת הכריכה' : isPhotos ? 'כיתוב לעמוד' : 'טקסט העמוד', isCover ? `
        <label class="lbl">כותרת</label><input class="input" id="t1" value="${esc(a.title)}">
        <label class="lbl">כותרת משנה</label><input class="input" id="t2" value="${esc(a.subtitle)}">`
      : isPhotos ? `<label class="lbl">כיתוב (יופיע בתחתית העמוד)</label><input class="input" id="t1" value="${esc(pg.caption)}" placeholder="למשל: סבתא וסבא בחתונה">`
      : `<label class="lbl">כותרת</label><input class="input" id="t1" value="${esc(pg.title)}">
         <label class="lbl">שורה נוספת</label><input class="input" id="t2" value="${esc(pg.subtitle)}" placeholder="למשל: הטיול לצפון">`);
    if (!body) return;
    const t1 = body.querySelector('#t1')?.value ?? '';
    const t2 = body.querySelector('#t2')?.value ?? '';
    if (isCover) {
      a.title = t1; a.subtitle = t2;
      $('#titleInput').value = t1; $('#subtitleInput').value = t2;
    } else if (isPhotos) pg.caption = t1;
    else { pg.title = t1; pg.subtitle = t2; }
    await db.saveAlbum(a);
    if (isCover) rerenderPagesOfType('cover'); else rerenderPage(i);
    return;
  }
  if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    if (j < 1 || j >= pages.length) return;
    [pages[i], pages[j]] = [pages[j], pages[i]];
    await db.saveAlbum(a);
    renderPages();
    return;
  }
  if (act === 'del') {
    pages.splice(i, 1);
    await db.saveAlbum(a);
    renderPages();
    if ((pages.length - 1) % 2) toast('שימו לב: מספר העמודים הפנימיים אי-זוגי. רוב בתי הדפוס דורשים מספר זוגי.', 4500);
  }
}

// ---------------- PDF export ----------------
$('#exportBtn').onclick = exportPDF;

async function loadFull(p, wPx, hPx) {
  const blob = await db.getOriginal(p.id);
  if (!blob) return thumbBitmap(p);
  const scale = Math.min(1, Math.max(wPx / p.width, hPx / p.height) * 1.05);
  try {
    if (scale < 0.95) {
      return await createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(p.width * scale)), resizeHeight: Math.max(1, Math.round(p.height * scale)), resizeQuality: 'high' });
    }
    return await createImageBitmap(blob);
  } catch {
    try { return await createImageBitmap(blob); } catch { return thumbBitmap(p); }
  }
}

async function exportPDF() {
  const a = state.album;
  if (!a.pages?.length) return;
  if (!window.jspdf) { toast('ספריית ה-PDF לא נטענה. בדקו חיבור לאינטרנט ורעננו.'); return; }
  const btn = $('#exportBtn');
  btn.disabled = true;
  const f = formatOf(a);
  const bleed = a.bleed || 0;
  const pw = f.w + 2 * bleed, ph = f.h + 2 * bleed;
  const k = state.dpi / 25.4;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: [pw, ph], orientation: pw >= ph ? 'landscape' : 'portrait', compress: true });
  const canvas = document.createElement('canvas');
  const byId = photosById();
  try {
    for (let i = 0; i < a.pages.length; i++) {
      btn.textContent = `מכין עמוד ${i + 1} מתוך ${a.pages.length}…`;
      const opened = [];
      await renderPage(canvas, a.pages[i], {
        format: f, theme: themeOf(a), album: a, photosById: byId, bleed, pxPerMm: k, pageNumber: i,
        getImage: async (p, w, h) => { const b = await loadFull(p, w, h); opened.push(b); return b; },
      });
      const data = canvas.toDataURL('image/jpeg', 0.93);
      if (i > 0) pdf.addPage([pw, ph], pw >= ph ? 'landscape' : 'portrait');
      pdf.addImage(data, 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
      // free full-resolution bitmaps (thumb bitmaps are shared and cached)
      for (const b of opened) if (b && !thumbSet.has(b)) b.close?.();
      await new Promise(r => setTimeout(r, 0));
    }
    btn.textContent = 'שומר קובץ…';
    pdf.save(`${a.name || 'album'}.pdf`);
    toast('הקובץ מוכן! אפשר לשלוח אותו לבית הדפוס 🎉', 5000);
  } catch (e) {
    console.error(e);
    toast('אירעה שגיאה ביצירת הקובץ. נסו "איכות טובה" או פחות עמודים.', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇️ הורדת PDF להדפסה';
    canvas.width = canvas.height = 1;
  }
}

route();
