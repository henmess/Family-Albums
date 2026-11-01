import * as db from './db.js?v=30';
import { analyzeFile, curate, isIncluded, featuresFromBlob, FEAT_VERSION } from './analyze.js?v=30';
import { generateAlbum, rerollPage, templateById, TEMPLATES, chooseTemplate, contentAspect, rng } from './layout.js?v=30';
import { THEMES, renderPage, ensureFonts, effectiveTheme, drawTemplateIcon, BG_SWATCHES } from './render.js?v=30';

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
function toast(msg, ms = 2800, action = null) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-btn';
    b.textContent = action.label;
    b.onclick = () => { t.classList.add('hidden'); action.run(); };
    t.append(' ', b);
  }
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
  if (!(p.thumb instanceof Blob)) return null;
  if (state.thumbCache.has(p.id)) return state.thumbCache.get(p.id);
  const pr = createImageBitmap(p.thumb).then(b => { thumbSet.add(b); return b; });
  state.thumbCache.set(p.id, pr);
  // don't remember failures – try again next time
  pr.catch(() => { if (state.thumbCache.get(p.id) === pr) state.thumbCache.delete(p.id); });
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
      <div class="album-cover">${a.coverThumb instanceof Blob ? `<img src="${URL.createObjectURL(a.coverThumb)}" alt="" onerror="this.remove()">` : '<span>📷</span>'}</div>
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
  await repairPhotos();
  await upgradeFeatures();
  showTab(tab);
}

async function readable(blob) {
  try { await blob.arrayBuffer(); return true; } catch { return false; }
}

// photos saved by an older version: move to the Safari-safe format and
// rebuild a broken thumbnail from the original file when possible
async function repairPhotos() {
  const old = state.photos.filter(p => p.legacy);
  let lost = 0;
  for (const p of old) {
    try {
      if (!(p.thumb instanceof Blob) || !(await readable(p.thumb))) {
        const orig = await db.getOriginal(p.id);
        if (orig && await readable(orig)) {
          const info = await analyzeFile(orig);
          p.thumb = info.thumb; p.feat = info.feat;
        } else { lost++; continue; }
      }
      await db.migratePhoto(p);
    } catch (e) { console.warn('repair failed', e); lost++; }
  }
  if (lost) toast(`${lost} תמונות לא נשמרו כראוי בדפדפן – מומלץ להעלות אותן שוב`, 7000);
}

// photos uploaded with an older version get the new similarity fingerprints
async function upgradeFeatures() {
  const old = state.photos.filter(p => p.feat?.v !== FEAT_VERSION);
  if (!old.length) return;
  const prog = $('#progress');
  prog.classList.remove('hidden');
  let i = 0;
  for (const p of old) {
    prog.querySelector('.label').textContent = `משדרג את זיהוי הכפילויות… ${++i} מתוך ${old.length}`;
    prog.querySelector('.bar').style.width = `${(i / old.length) * 100}%`;
    try { p.feat = await featuresFromBlob(p.thumb); await db.updatePhoto(p); } catch (e) { console.warn(e); }
  }
  const before = state.photos.filter(isIncluded).length;
  await recurate();
  prog.classList.add('hidden');
  const after = state.photos.filter(isIncluded).length;
  if (after !== before) {
    markChanged();
    toast(`זיהוי הכפילויות שודרג – סוננו עוד ${before - after} תמונות דומות`, 5000);
  }
  await db.saveAlbum(state.album);
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
const folderInput = $('#folderInput');
fileInput.onchange = () => { addFiles([...fileInput.files]); fileInput.value = ''; };
folderInput.onchange = () => { addFiles([...folderInput.files]); folderInput.value = ''; };
$('#pickFilesBtn').onclick = e => { e.stopPropagation(); fileInput.click(); };
$('#pickFolderBtn').onclick = e => { e.stopPropagation(); folderInput.click(); };

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);
// phones can't pick folders from the gallery – show how to pick a whole album instead
if (isIOS || isAndroid || !('webkitdirectory' in folderInput)) $('#pickFolderBtn').classList.add('hidden');
if (isIOS || isAndroid) $('#dropzone .dz-title').textContent = 'העלאת תמונות מהגלריה';
if (isIOS) $('#iosTip').classList.remove('hidden');
if (isAndroid) $('#androidTip').classList.remove('hidden');

// ---- paste photos copied from the Photos app (iPhone: Select All → Copy) ----
$('#pasteBtn').onclick = async e => {
  e.stopPropagation();
  if (!navigator.clipboard?.read) {
    toast('הדפדפן לא מאפשר הדבקה בכפתור – נסו ללחוץ לחיצה ארוכה על אזור ההעלאה ולבחור "הדבק"', 6000);
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    let i = 0;
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      files.push(new File([blob], `pasted-${Date.now()}-${++i}.${type.split('/')[1] || 'jpg'}`, { type, lastModified: Date.now() }));
    }
    if (!files.length) { toast('לא נמצאו תמונות בהעתקה. העתיקו תמונות מאפליקציית התמונות ונסו שוב.', 6000); return; }
    toast(`מדביק ${files.length} תמונות…`);
    addFiles(files);
  } catch (err) {
    console.warn(err);
    toast('ההדבקה לא אושרה. לחצו שוב ובחרו "הדבק" בבועה שמופיעה.', 6000);
  }
};
// also support the regular paste gesture / Ctrl+V while on the photos tab
document.addEventListener('paste', e => {
  if (!state.album || $('#photosTab').classList.contains('hidden')) return;
  if (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]')) return;
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  let i = 0;
  addFiles(files.map(f => new File([f], f.name && f.name !== 'image.png' ? f.name : `pasted-${Date.now()}-${++i}.${f.type.split('/')[1]}`, { type: f.type, lastModified: f.lastModified || Date.now() })));
});

const dz = $('#dropzone');
dz.addEventListener('click', e => { if (!e.target.closest('button, .dz-tip')) fileInput.click(); });
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', async e => {
  const entries = [...(e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (entries.some(en => en.isDirectory)) addFiles(await filesFromEntries(entries));
  else addFiles([...e.dataTransfer.files]);
});

// read dropped folders (including sub-folders)
async function filesFromEntries(entries) {
  const out = [];
  const walk = async en => {
    if (en.isFile) {
      out.push(await new Promise((res, rej) => en.file(res, rej)).catch(() => null));
    } else if (en.isDirectory) {
      const reader = en.createReader();
      let batch;
      do {
        batch = await new Promise(res => reader.readEntries(res, () => res([])));
        for (const c of batch) await walk(c);
      } while (batch.length);
    }
  };
  for (const en of entries) await walk(en);
  return out.filter(Boolean);
}

// analyze and store files; returns the new photo records
async function importFiles(files, onProgress = () => {}) {
  files = files.filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  const album = state.album;
  const existing = new Set(state.photos.map(p => p.name + '|' + p.size));
  const added = [];
  let done = 0, failed = 0, skipped = 0;
  for (const f of files) {
    onProgress(done, files.length);
    if (existing.has(f.name + '|' + f.size)) {
      skipped++; done++;
      // already uploaded: still offer that photo
      const p = state.photos.find(x => x.name === f.name && x.size === f.size);
      if (p) added.push(p);
      continue;
    }
    try {
      const info = await analyzeFile(f);
      const photo = { id: db.uid(), albumId: album.id, name: f.name, size: f.size, manual: null, ...info };
      await db.savePhoto(photo, f);
      state.photos.push(photo);
      added.push(photo);
    } catch (e) {
      console.warn('failed', f.name, e);
      failed++;
    }
    done++;
  }
  onProgress(done, files.length);
  return { added, failed, skipped, total: files.length };
}

async function addFiles(files) {
  if (!files.some(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))) return;
  const album = state.album;
  const prog = $('#progress');
  prog.classList.remove('hidden');
  const res = await importFiles(files, (done, total) => {
    prog.querySelector('.label').textContent = `מנתח תמונות… ${Math.min(done + 1, total)} מתוך ${total}`;
    prog.querySelector('.bar').style.width = `${(done / total) * 100}%`;
  });
  prog.querySelector('.bar').style.width = '100%';
  prog.querySelector('.label').textContent = 'מזהה כפילויות ובוחר את התמונות הטובות…';
  await recurate();
  prog.classList.add('hidden');
  if (album.pages) album.needsRedesign = true;
  await db.saveAlbum(album);
  renderPhotos();
  let msg = `נוספו ${res.total - res.failed - res.skipped} תמונות`;
  if (res.skipped) msg += ` · ${res.skipped} כבר היו באלבום`;
  if (res.failed) msg += ` · ${res.failed} לא נתמכו (למשל HEIC – נסו להמיר ל-JPG)`;
  toast(msg, 5000);
}

async function recurate() {
  const before = new Map(state.photos.map(p => [p.id, `${p.duplicate}|${p.weak}|${p.dupGroup}`]));
  curate(state.photos, state.album.dedup || 'normal');
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
  $('#dedupRow').classList.toggle('hidden', !has);
  $$('#dedupSeg button').forEach(b => b.classList.toggle('active', b.dataset.v === (state.album.dedup || 'normal')));
  $('#toDesignRow').classList.toggle('hidden', !has);
  $('#designBar').classList.toggle('hidden', !has);
  $('#designBarCount').textContent = `${photos.filter(isIncluded).length} תמונות נבחרו לאלבום`;
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
  const filtered = visiblePhotos();
  $('#bulkRow').classList.toggle('hidden', !has);
  $('#bulkScope').textContent = { all: '', in: ' (בתצוגה הנוכחית)', dup: ' לתמונות הדומות', weak: ' לתמונות החלשות' }[state.filter] || '';
  // day headers (only when showing photos in date order)
  const byDay = state.filter !== 'dup' && filtered.length > 0;
  const days = new Map();
  if (byDay) for (const p of filtered) {
    const k = new Date(p.date).toDateString();
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(p);
  }
  let lastDay = null;
  if (state.filter === 'dup') filtered.sort((a, b) => String(a.dupGroup).localeCompare(String(b.dupGroup)) || (a.duplicate - b.duplicate) || b.quality.score - a.quality.score);

  const groupColors = new Map();
  const palette = ['#e76f51', '#2a9d8f', '#8e44ad', '#e9c46a', '#3a86ff', '#ff006e', '#06d6a0', '#8338ec'];
  for (const p of filtered) {
    if (p.dupGroup && !groupColors.has(p.dupGroup)) groupColors.set(p.dupGroup, palette[groupColors.size % palette.length]);
    const dayKey = new Date(p.date).toDateString();
    if (byDay && days.size > 1 && dayKey !== lastDay) {
      lastDay = dayKey;
      const list = days.get(dayKey);
      const allIn = list.every(isIncluded);
      const h = document.createElement('div');
      h.className = 'day-head';
      h.innerHTML = `<span class="day-name">${dayFmt.format(new Date(p.date))}</span>
        <span class="day-count">${list.filter(isIncluded).length} מתוך ${list.length} נבחרו</span>
        <button class="chip small">${allIn ? '✕ בטל את כל היום' : '✓ סמן את כל היום'}</button>`;
      h.querySelector('button').onclick = () => bulkSelect(list, allIn ? 'none' : 'all');
      grid.appendChild(h);
    }
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
    const img = el.querySelector('img');
    if (p.thumb instanceof Blob) {
      const url = URL.createObjectURL(p.thumb);
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
      img.onerror = () => { URL.revokeObjectURL(url); el.classList.add('broken'); };
    } else {
      el.classList.add('broken');
    }
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

const autoIncluded = p => !p.duplicate && !p.weak;

// mode: 'all' | 'none' | 'auto'
async function bulkSelect(list, mode) {
  for (const p of list) {
    if (mode === 'all') p.manual = autoIncluded(p) ? null : 'in';
    else if (mode === 'none') p.manual = autoIncluded(p) ? 'out' : null;
    else p.manual = null;
  }
  await db.updatePhotos(list);
  markChanged();
  renderPhotos();
}

function visiblePhotos() {
  const photos = [...state.photos].sort((a, b) => a.date - b.date);
  return photos.filter(p => {
    if (state.filter === 'in') return isIncluded(p);
    if (state.filter === 'dup') return p.dupGroup;
    if (state.filter === 'weak') return p.weak;
    return true;
  });
}

$$('#bulkRow [data-bulk]').forEach(b => b.onclick = async () => {
  const list = visiblePhotos();
  const before = state.photos.filter(isIncluded).length;
  await bulkSelect(list, b.dataset.bulk);
  const after = state.photos.filter(isIncluded).length;
  toast(`${after} תמונות נבחרו לאלבום (${after - before >= 0 ? '+' : ''}${after - before})`);
});

const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function markChanged() {
  if (state.album.pages) state.album.needsRedesign = true;
  db.saveAlbum(state.album);
}

$$('#filters .chip').forEach(c => c.onclick = () => {
  state.filter = c.dataset.filter;
  $$('#filters .chip').forEach(x => x.classList.toggle('active', x === c));
  renderPhotos();
});

$$('#dedupSeg button').forEach(b => b.onclick = async () => {
  const before = state.photos.filter(isIncluded).length;
  state.album.dedup = b.dataset.v;
  await recurate();
  markChanged();
  renderPhotos();
  const after = state.photos.filter(isIncluded).length;
  toast(`${after} תמונות נבחרו (${after - before >= 0 ? '+' : ''}${after - before})`);
});

$('#toDesignBtn').onclick = () => { location.hash = `#album/${state.album.id}/design`; };
$('#designBarBtn').onclick = () => { location.hash = `#album/${state.album.id}/design`; window.scrollTo(0, 0); };

// ---- "back to top" button ----
const toTop = $('#toTop');
const syncTop = () => {
  toTop.classList.toggle('show', window.scrollY > 500);
  document.documentElement.style.setProperty('--topbar', $('.topbar').offsetHeight + 'px');
};
window.addEventListener('scroll', syncTop, { passive: true });
window.addEventListener('resize', syncTop);
syncTop();
toTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// ---------------- design tab ----------------
let renderToken = 0;

async function openDesign() {
  const a = state.album;
  $('#titleInput').value = a.title || '';
  $('#subtitleInput').value = a.subtitle || '';
  $('#subtitle2Input').value = a.subtitle2 || '';
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
  // show an inside page too, not just the cover
  const inner = a.pages?.find(p => p.type === 'photos' && p.photos.length >= 2 && !templateById(p.template)?.full)
    || a.pages?.find(p => p.type === 'photos');
  for (const [id, t] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.className = 'theme-card' + (id === a.theme ? ' active' : '');
    b.innerHTML = `<div class="previews"><canvas></canvas><canvas></canvas></div><div><strong>${t.name}</strong><small>${t.desc}</small></div>`;
    b.onclick = async () => {
      if (a.theme === id) return;
      a.theme = id;
      $$('.theme-card').forEach(x => x.classList.toggle('active', x === b));
      await regenerate(false);
      renderPages();
      renderThemePicker();
    };
    wrap.appendChild(b);
    const f = formatOf(a);
    const [c1, c2] = b.querySelectorAll('canvas');
    const env = { format: f, theme: t, album: a, photosById: photosById(), pxPerMm: 200 / f.w, getImage: thumbBitmap };
    const clean = pg => ({ ...pg, style: null, bg: null, shapes: null });
    if (cover) renderPage(c1, clean(cover), env).catch(() => {});
    if (inner) renderPage(c2, clean(inner), { ...env, pageNumber: 2 }).catch(() => {}); else c2.remove();
  }
}

$('#titleInput').oninput = debounce(async () => { state.album.title = $('#titleInput').value; await db.saveAlbum(state.album); rerenderPagesOfType('cover'); }, 350);
$('#subtitleInput').oninput = debounce(async () => { state.album.subtitle = $('#subtitleInput').value; await db.saveAlbum(state.album); rerenderPagesOfType('cover'); }, 350);
$('#subtitle2Input').oninput = debounce(async () => { state.album.subtitle2 = $('#subtitle2Input').value; await db.saveAlbum(state.album); rerenderPagesOfType('cover'); }, 350);
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
      const label = i === 0 ? 'כריכה' : pg.textPage ? `עמוד טקסט · ${i}` : (PAGE_LABEL[pg.type] ? `${PAGE_LABEL[pg.type]} · ${i}` : `עמוד ${i}`);
      el.innerHTML = `
        <div class="canvas-wrap"><canvas></canvas></div>
        <div class="page-bar">
          <span class="pnum">${label}</span>
          <div class="acts">
            ${pg.type === 'photos' ? '<button data-act="reroll" title="פריסה אחרת">🔄</button><button data-act="shuffle" title="ערבוב סדר התמונות">🔀</button>' : '<button data-act="reroll" title="וריאציה">🔄</button>'}
            <button data-act="edit" title="עריכת העמוד">✏️</button>
            ${i > 1 ? '<button data-act="up" title="הזזה אחורה">⬅</button>' : ''}
            ${i > 0 && i < pages.length - 1 ? '<button data-act="down" title="הזזה קדימה">➡</button>' : ''}
            ${i < pages.length - 1 ? '<button data-act="add" title="הוספת עמוד אחרי העמוד הזה">➕</button>' : ''}
            ${i > 0 ? '<button data-act="del" title="מחיקת העמוד">🗑</button>' : ''}
          </div>
        </div>`;
      el.querySelectorAll('[data-act]').forEach(btn => btn.onclick = () => pageAction(i, btn.dataset.act));
      el.querySelector('.canvas-wrap').onclick = () => { if (!dragJustEnded) openEditor(i); };
      setupPageDrag(el);
      s.appendChild(el);
      io.observe(el);
    }
    host.appendChild(s);
    // "+" between spreads: inserts a page right here (never after the closing page)
    const after = sp[sp.length - 1];
    if (after < pages.length - 1) {
      const add = document.createElement('button');
      add.className = 'add-between';
      add.innerHTML = '<span>＋</span> הוספת עמוד כאן';
      add.title = `הוספת עמוד בין עמוד ${after} לעמוד ${after + 1}`;
      add.onclick = () => addPageAt(after + 1);
      host.appendChild(add);
    }
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
  let res = null;
  try {
    res = await renderPage(c, page, previewEnv(i));
  } catch (e) { console.error(e); }
  if (token !== renderToken) return;
  el._slots = res?.slots || [];
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
    pages[i] = rerollPage(pg, photosById(), settingsOf(a), effectiveTheme(pg, themeOf(a)));
    await db.saveAlbum(a);
    rerenderPage(i);
    return;
  }
  if (act === 'edit') { openEditor(i); return; }
  if (act === 'add') { addPageAt(i + 1); return; }
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

// Phones often open a PDF instead of downloading it (with no way back), so
// the finished file is offered through explicit buttons: share/save, download, view.
function offerPdf(blob, name, asciiName = name) {
  const file = new File([blob], name, { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  const mb = (blob.size / 1048576).toFixed(1);
  modal('הקובץ מוכן להדפסה 🎉', `
    <p class="pdf-info">${esc(name)} · ${mb} MB<br><span class="small">שם הקובץ בהורדה: ${esc(asciiName)}</span></p>
    <div class="pdf-actions">
      ${canShare ? '<button class="btn primary big full" id="pdfShare">📤 שמירה / שליחה</button>' : ''}
      <button class="btn ${canShare ? 'ghost' : 'primary'} big full" id="pdfDownload">⬇️ הורדה למכשיר</button>
      <button class="btn ghost full" id="pdfView">👁 פתיחה לצפייה בלשונית חדשה</button>
    </div>
    ${isIOS && canShare ? '<p class="small">💡 באייפון: לחצו "שמירה / שליחה" ובחרו <b>"שמור בקבצים"</b>, או שלחו ישירות בוואטסאפ/מייל לבית הדפוס.</p>' : ''}
    ${isIOS && !canShare ? '<p class="small">💡 באייפון: אחרי "הורדה למכשיר" הקובץ נשמר באפליקציית <b>קבצים</b> ← <b>הורדות</b>.</p>' : ''}
  `, 'סגירה').then(() => setTimeout(() => URL.revokeObjectURL(url), 60000));
  $('#modalCancel').classList.add('hidden');
  const restore = () => $('#modalCancel').classList.remove('hidden');
  $('#modalOk').addEventListener('click', restore, { once: true });
  $('#pdfShare')?.addEventListener('click', async () => {
    try { await navigator.share({ files: [file], title: name }); }
    catch (e) { if (e.name !== 'AbortError') toast('השיתוף לא הצליח – נסו "הורדה למכשיר"', 5000); }
  });
  $('#pdfDownload').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = url; a.download = asciiName; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('#pdfView').addEventListener('click', () => {
    const w = window.open(url, '_blank');
    if (!w) toast('הדפדפן חסם פתיחת לשונית – נסו "הורדה למכשיר"', 5000);
  });
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
    const name = `${(a.name || 'album').replace(/[\\/:*?"<>|]/g, '')}.pdf`;
    // some browsers drop non-Latin download names (leaving a file with no .pdf), so the
    // downloaded copy gets a safe Latin name; sharing keeps the Hebrew album name
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const latin = (a.name || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-');
    offerPdf(pdf.output('blob'), name, `${latin || 'family-album'}-${stamp}-${a.id.slice(-4)}.pdf`);
  } catch (e) {
    console.error(e);
    toast('אירעה שגיאה ביצירת הקובץ. נסו "איכות טובה" או פחות עמודים.', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇️ הורדת PDF להדפסה';
    canvas.width = canvas.height = 1;
  }
}



// ================= drag a photo from page to page =================
let drag = null;
let dragJustEnded = false;

function slotAt(el, x, y) {
  const c = el.querySelector('canvas');
  if (!c || !el._slots?.length) return null;
  const r = c.getBoundingClientRect();
  const sc = c.width / r.width;
  const px = (x - r.left) * sc, py = (y - r.top) * sc;
  for (let i = el._slots.length - 1; i >= 0; i--) {
    const s = el._slots[i];
    if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) return s;
  }
  return null;
}

function setupPageDrag(el) {
  const wrap = el.querySelector('.canvas-wrap');
  // mouse: start dragging after a small movement
  wrap.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const slot = slotAt(el, e.clientX, e.clientY);
    if (!slot) return;
    const start = { x: e.clientX, y: e.clientY };
    const move = ev => {
      if (!drag && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) beginDrag(el, slot, ev.clientX, ev.clientY);
      if (drag) { ev.preventDefault(); updateDrag(ev.clientX, ev.clientY); }
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (drag) endDrag(ev.clientX, ev.clientY);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  // touch: long-press, then drag (a normal swipe still scrolls the page)
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t0 = e.touches[0];
    const slot = slotAt(el, t0.clientX, t0.clientY);
    if (!slot) return;
    let last = { x: t0.clientX, y: t0.clientY };
    const timer = setTimeout(() => {
      beginDrag(el, slot, last.x, last.y);
      navigator.vibrate?.(25);
    }, 380);
    const move = ev => {
      const t = ev.touches[0];
      if (!drag) {
        if (Math.hypot(t.clientX - t0.clientX, t.clientY - t0.clientY) > 10) cleanup();
        last = { x: t.clientX, y: t.clientY };
        return;
      }
      ev.preventDefault();
      last = { x: t.clientX, y: t.clientY };
      updateDrag(last.x, last.y);
    };
    const end = () => { const was = !!drag; cleanup(); if (was) endDrag(last.x, last.y); };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
  }, { passive: true });
  wrap.addEventListener('contextmenu', e => { if (drag) e.preventDefault(); });
}

function beginDrag(el, slot, x, y) {
  const i = +el.dataset.index;
  const page = state.album.pages[i];
  const pid = page?.photos[slot.index];
  const p = photosById().get(pid);
  if (!p) return;
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  if (p.thumb instanceof Blob) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(p.thumb);
    ghost.appendChild(img);
  }
  document.body.appendChild(ghost);
  document.body.classList.add('dragging-photo');
  el.classList.add('drag-source');
  drag = { el, from: i, slot: slot.index, pid, ghost, target: null, x, y, raf: 0 };
  updateDrag(x, y);
  const scroll = () => {
    if (!drag) return;
    const edge = 90;
    if (drag.y < edge) window.scrollBy(0, -Math.ceil((edge - drag.y) / 6));
    else if (drag.y > innerHeight - edge) window.scrollBy(0, Math.ceil((drag.y - innerHeight + edge) / 6));
    drag.raf = requestAnimationFrame(scroll);
  };
  drag.raf = requestAnimationFrame(scroll);
}

function updateDrag(x, y) {
  if (!drag) return;
  drag.x = x; drag.y = y;
  drag.ghost.style.transform = `translate(${x - 45}px, ${y - 45}px)`;
  drag.ghost.style.display = 'none';
  const under = document.elementFromPoint(x, y)?.closest('#pages .page');
  drag.ghost.style.display = '';
  const target = under && under !== drag.el ? under : null;
  if (target !== drag.target) {
    drag.target?.classList.remove('drop-target');
    target?.classList.add('drop-target');
    drag.target = target;
  }
}

async function endDrag(x, y) {
  const d = drag;
  drag = null;
  cancelAnimationFrame(d.raf);
  const img = d.ghost.querySelector('img');
  if (img) URL.revokeObjectURL(img.src);
  d.ghost.remove();
  document.body.classList.remove('dragging-photo');
  d.el.classList.remove('drag-source');
  d.target?.classList.remove('drop-target');
  dragJustEnded = true;
  setTimeout(() => { dragJustEnded = false; }, 60);
  if (!d.target) return;
  const to = +d.target.dataset.index;
  const toSlot = slotAt(d.target, x, y);
  await movePhoto(d.from, d.slot, to, toSlot ? toSlot.index : null);
}

// re-design a page for its (new) set of photos
function relayoutPage(pg) {
  const a = state.album;
  const theme = effectiveTheme(pg, themeOf(a));
  const byId = photosById();
  const ps = pg.photos.map(id => byId.get(id)).filter(Boolean);
  if (!ps.length) return;
  const choice = chooseTemplate(ps, contentAspect(formatOf(a), theme), rng(Math.floor(Math.random() * 1e9)), { allowOverlap: !!theme.allowOverlap });
  pg.template = choice.template;
  pg.photos = choice.photos;
  delete pg.shapes;
  pg.variant = Math.random();
}

// insert a new page at position `at` (asks what kind of page)
async function addPageAt(at) {
  const a = state.album;
  if (!a.pages) return;
  at = Math.max(1, Math.min(at, a.pages.length - 1)); // between the cover and the closing page
  const body = await modal('הוספת עמוד', `
    <p class="small" style="text-align:right">העמוד החדש ייכנס במקום ${at} (בין עמוד ${at - 1 || 'הכריכה'} לעמוד ${at}).</p>
    <div class="add-kinds">
      <label><input type="radio" name="kind" value="photos" checked><b>🖼️ עמוד תמונות</b><small>בוחרים תמונה, ואפשר להוסיף עוד בעריכה</small></label>
      <label><input type="radio" name="kind" value="chapter"><b>📖 פתיחת פרק</b><small>תמונה ראשית עם כותרת גדולה</small></label>
      <label><input type="radio" name="kind" value="text"><b>✍️ עמוד טקסט</b><small>כותרת וטקסט, בלי תמונות</small></label>
    </div>`, 'המשך');
  if (!body) return;
  const kind = body.querySelector('input[name=kind]:checked').value;
  const before = structuredClone(a.pages);
  let page;
  if (kind === 'text') {
    page = { id: db.uid(), type: 'end', textPage: true, photos: [], title: 'כותרת', subtitle: '', variant: Math.random() };
  } else {
    ed.index = -1; // the picker is not tied to an open editor here
    const id = await pickPhoto();
    if (!id) return;
    const ph = photosById().get(id);
    if (kind === 'chapter') {
      page = { id: db.uid(), type: 'chapter', photos: [id], title: ph ? chapterDateFmt.format(new Date(ph.date)) : '', subtitle: '', variant: Math.random() };
    } else {
      page = { id: db.uid(), type: 'photos', photos: [id], variant: Math.random() };
      relayoutPage(page);
    }
  }
  a.pages.splice(at, 0, page);
  await db.saveAlbum(a);
  renderPages();
  let msg = 'העמוד נוסף – אפשר להמשיך לערוך אותו';
  if ((a.pages.length - 1) % 2) msg += ' · שימו לב: מספר עמודים אי-זוגי';
  await openEditor(at);
  toast(msg, 6000, { label: 'ביטול', run: async () => { a.pages = before; await db.saveAlbum(a); closeEditor(); renderPages(); } });
}

// switch a page between "regular photo page" and "chapter opening"
const chapterDateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
function setPageType(i, type) {
  const a = state.album;
  const pg = a.pages[i];
  if (!pg || pg.type === type) return null;
  const keep = { id: pg.id, variant: pg.variant, style: pg.style, bg: pg.bg, crops: pg.crops, caption: pg.caption, captionBullets: pg.captionBullets };
  let note = '';
  if (type === 'chapter' && pg.type === 'photos') {
    const byId = photosById();
    // the first photo in reading order becomes the opening photo
    const ordered = [...pg.photos];
    const [first, ...rest] = ordered;
    const ph = byId.get(first);
    a.pages[i] = { ...keep, type: 'chapter', photos: [first], title: pg.title || (ph ? chapterDateFmt.format(new Date(ph.date)) : ''), subtitle: pg.subtitle || '' };
    if (rest.length) {
      const next = a.pages[i + 1];
      if (next && next.type === 'photos' && next.photos.length + rest.length <= 6) {
        next.photos = [...rest, ...next.photos];
        for (const id of rest) if (pg.captions?.[id]) (next.captions ||= {})[id] = pg.captions[id];
        relayoutPage(next);
        note = `שאר ${rest.length} התמונות עברו לעמוד הבא, שעוצב מחדש`;
      } else {
        const np = { id: db.uid(), type: 'photos', photos: rest, variant: Math.random() };
        for (const id of rest) if (pg.captions?.[id]) (np.captions ||= {})[id] = pg.captions[id];
        relayoutPage(np);
        a.pages.splice(i + 1, 0, np);
        note = `שאר ${rest.length} התמונות עברו לעמוד חדש אחרי הפתיחה`;
      }
    }
  } else if (type === 'photos' && pg.type === 'chapter') {
    a.pages[i] = { ...keep, type: 'photos', photos: [...pg.photos] };
    relayoutPage(a.pages[i]);
    note = 'העמוד הפך לעמוד תמונות רגיל';
  } else return null;
  return note;
}

async function movePhoto(from, slot, to, toSlot) {
  const a = state.album;
  const before = structuredClone(a.pages);
  const src = a.pages[from], dst = a.pages[to];
  const pid = src.photos[slot];
  if (!dst || dst.type === 'end') { toast('אי אפשר להעביר תמונה לעמוד הסיום'); return; }
  const single = pg => pg.type === 'cover' || pg.type === 'chapter';
  let removedPage = false;
  if (single(src) || single(dst)) {
    // cover / chapter pages hold one photo, so the two photos swap places
    const ds = single(dst) ? 0 : (toSlot ?? 0);
    const other = dst.photos[ds];
    if (!other) return;
    src.photos[slot] = other;
    dst.photos[ds] = pid;
    if (src.type === 'photos') relayoutPage(src);
    if (dst.type === 'photos') relayoutPage(dst);
  } else {
    if (dst.photos.length >= 6) { toast('בעמוד הזה כבר יש 6 תמונות – הוציאו ממנו תמונה קודם'); return; }
    src.photos.splice(slot, 1);
    dst.photos.push(pid);
    for (const key of ['captions', 'crops']) {
      if (src[key]?.[pid] != null) { (dst[key] ||= {})[pid] = src[key][pid]; delete src[key][pid]; }
    }
    relayoutPage(dst);
    if (src.photos.length) relayoutPage(src);
    else { a.pages.splice(from, 1); removedPage = true; }
  }
  await db.saveAlbum(a);
  if (removedPage) renderPages();
  else { rerenderPage(from); rerenderPage(to); }
  const undo = { label: 'ביטול', run: async () => { a.pages = before; await db.saveAlbum(a); renderPages(); } };
  let msg = removedPage ? 'התמונה הועברה, והעמוד שהתרוקן נמחק' : 'התמונה הועברה ושני העמודים עוצבו מחדש';
  if (removedPage && (a.pages.length - 1) % 2) msg += ' (שימו לב: מספר עמודים אי-זוגי)';
  toast(msg, 6000, undo);
}

// ================= page editor =================
const ed = { index: -1, page: null, sel: null, selText: null, texts: [], swap: false, slots: [], scale: 1, rendering: false, again: false, album: null };

function edEnv() {
  const a = state.album;
  const f = formatOf(a);
  const stage = $('.ed-stage');
  const narrow = matchMedia('(max-width: 860px)').matches;
  // on phones the page is pinned at the top, so keep it to ~40% of the screen height
  const maxW = narrow ? Math.max(200, stage.clientWidth - 24) : Math.max(240, Math.min(stage.clientWidth - 36, 720));
  const maxH = narrow ? Math.max(200, innerHeight * 0.4) : Math.max(240, stage.clientHeight - 70);
  const cssW = Math.min(maxW, maxH * f.w / f.h);
  return {
    format: f, theme: themeOf(a), album: ed.album, photosById: photosById(), bleed: 0,
    pxPerMm: (cssW * Math.min(2, devicePixelRatio || 1)) / f.w, getImage: thumbBitmap, pageNumber: ed.index, cssW,
  };
}

async function edRender() {
  if (ed.rendering) { ed.again = true; return; }
  ed.rendering = true;
  try {
    const env = edEnv();
    const c = document.createElement('canvas');
    const res = await renderPage(c, ed.page, env);
    const old = $('#edCanvas');
    c.id = 'edCanvas';
    c.style.width = env.cssW + 'px';
    old.replaceWith(c);
    ed.slots = res.slots;
    ed.texts = res.texts || [];
    ed.scale = env.cssW / c.width;
    c.onpointerdown = edPointerDown;
    edDrawSel();
  } finally {
    ed.rendering = false;
    if (ed.again) { ed.again = false; edRender(); }
  }
}

function edDrawSel() {
  const box = $('#edSel');
  const s = ed.selText ? ed.texts.find(x => x.id === ed.selText) : ed.slots.find(x => x.index === ed.sel);
  box.classList.toggle('hidden', !s);
  box.classList.toggle('swap', ed.swap);
  box.classList.toggle('text', !!ed.selText);
  if (!s) return;
  Object.assign(box.style, { left: s.x * ed.scale + 'px', top: s.y * ed.scale + 'px', width: s.w * ed.scale + 'px', height: s.h * ed.scale + 'px' });
}

function edHitText(ev) {
  const rect = $('#edCanvas').getBoundingClientRect();
  const x = (ev.clientX - rect.left) / ed.scale, y = (ev.clientY - rect.top) / ed.scale;
  for (let i = ed.texts.length - 1; i >= 0; i--) {
    const t = ed.texts[i];
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return t;
  }
  return null;
}

// settings of a text group; the automatic top/bottom choice is frozen once the user moves it
function textCfg(id) {
  ed.page.text ||= {};
  const t = (ed.page.text[id] ||= {});
  const box = ed.texts.find(x => x.id === id);
  if (t.top == null && box && box.top != null) t.top = box.top;
  return t;
}

// the editor canvas is replaced on every redraw, so drags are tracked on the window
function trackDrag(move) {
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function edTextDrag(ev, hit) {
  const t = textCfg(hit.id);
  const canvas = $('#edCanvas');
  const W = canvas.width, H = canvas.height;
  const start = { x: ev.clientX, y: ev.clientY, dx: t.dx || 0, dy: t.dy || 0 };
  let raf = 0;
  const lockY = hit.id === 'caption';
  const move = e => {
    t.dx = start.dx + (e.clientX - start.x) / ed.scale / W;
    if (!lockY) t.dy = start.dy + (e.clientY - start.y) / ed.scale / H;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; edRender(); });
  };
  trackDrag(move);
}

function edHit(ev) {
  const rect = $('#edCanvas').getBoundingClientRect();
  const x = (ev.clientX - rect.left) / ed.scale, y = (ev.clientY - rect.top) / ed.scale;
  for (let i = ed.slots.length - 1; i >= 0; i--) {
    const s = ed.slots[i];
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s;
  }
  return null;
}

function cropFor(i) {
  const pid = ed.page.photos[i];
  const p = photosById().get(pid);
  ed.page.crops ||= {};
  if (!ed.page.crops[pid]) ed.page.crops[pid] = { x: p?.focal?.x ?? 0.5, y: p?.focal?.y ?? 0.5, zoom: 1 };
  return ed.page.crops[pid];
}

function edPointerDown(ev) {
  // titles and captions sit on top of the photos, so they are checked first
  const th = !ed.swap && edHitText(ev);
  if (th) {
    ed.selText = th.id; ed.sel = null;
    edUpdatePanel(); edDrawSel();
    edTextDrag(ev, th);
    return;
  }
  ed.selText = null;
  const hit = edHit(ev);
  if (!hit) { ed.sel = null; ed.swap = false; edUpdatePanel(); edDrawSel(); return; }
  if (ed.swap && ed.sel != null && hit.index !== ed.sel) {
    const ps = ed.page.photos;
    [ps[ed.sel], ps[hit.index]] = [ps[hit.index], ps[ed.sel]];
    ed.swap = false; ed.sel = hit.index;
    edUpdatePanel(); edRender();
    return;
  }
  const wasSelected = ed.sel === hit.index;
  ed.sel = hit.index; ed.swap = false;
  edUpdatePanel(); edDrawSel();
  if (!wasSelected) return;
  // drag to pan the crop
  const p = photosById().get(ed.page.photos[hit.index]);
  if (!p) return;
  const crop = cropFor(hit.index);
  const start = { x: ev.clientX, y: ev.clientY, cx: crop.x, cy: crop.y };
  const canvas = $('#edCanvas');
  let raf = 0;
  const move = e => {
    const wPx = hit.w * ed.scale, hPx = hit.h * ed.scale;
    const s = Math.max(hit.w / p.width, hit.h / p.height) * (crop.zoom || 1);
    const fw = Math.min(1, (hit.w / s) / p.width), fh = Math.min(1, (hit.h / s) / p.height);
    crop.x = Math.max(fw / 2, Math.min(1 - fw / 2, start.cx - (e.clientX - start.x) / wPx * fw));
    crop.y = Math.max(fh / 2, Math.min(1 - fh / 2, start.cy - (e.clientY - start.y) / hPx * fh));
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; edRender(); });
  };
  trackDrag(move);
}

function edTheme() { return effectiveTheme(ed.page, themeOf(state.album)); }

function relayout(photoIds, avoid) {
  const byId = photosById();
  const ps = photoIds.map(id => byId.get(id)).filter(Boolean);
  const choice = chooseTemplate(ps, contentAspect(formatOf(state.album), edTheme()), rng(Math.floor(Math.random() * 1e9)),
    { allowOverlap: !!edTheme().allowOverlap, avoid });
  ed.page.template = choice.template;
  ed.page.photos = choice.photos;
  delete ed.page.shapes;
}

function edUpdatePanel() {
  const pg = ed.page;
  const isPhotos = pg.type === 'photos';
  const typeable = pg.type === 'photos' || pg.type === 'chapter';
  $('#edTypeSec').classList.toggle('hidden', !typeable);
  if (typeable) {
    $$('#edType button').forEach(b => b.classList.toggle('active', b.dataset.v === pg.type));
    $('#edTypeHint').textContent = pg.type === 'chapter'
      ? 'עמוד פתיחה: תמונה ראשית אחת עם כותרת גדולה.'
      : (pg.photos.length > 1 ? 'בהפיכה לפתיחת פרק: התמונה הראשונה נשארת, והשאר עוברות לעמוד הבא.' : '');
  }
  const hasSel = ed.sel != null && !ed.selText && pg.photos.length > 0 && pg.type !== 'end';
  $('#edSlot').classList.toggle('hidden', !hasSel);
  $('#edTextSel').classList.toggle('hidden', !ed.selText);
  if (ed.selText) {
    $$('.ed-pos [data-v]').forEach(b => b.classList.toggle('hidden', ed.selText === 'caption'));
    const sc = pg.text?.[ed.selText]?.scale || 1;
    $('#edTextSize').value = sc;
    $('#edTextSizeLbl').textContent = Math.round(sc * 100) + '%';
  }
  $('#edSwap').classList.toggle('hidden', !isPhotos || pg.photos.length < 2);
  $('#edRemove').classList.toggle('hidden', !isPhotos);
  $('#edSwap').textContent = ed.swap ? 'בחרו תמונה להחלפה…' : '↔ החלפת מקום';
  $('#edHint').textContent = ed.swap ? 'לחצו על התמונה שאיתה להחליף מקום'
    : ed.selText === 'caption' ? 'הכיתוב נשאר תמיד בתחתית העמוד · את הגודל משנים בפאנל'
    : ed.selText ? 'גררו את הטקסט למקום אחר · את הגודל משנים בפאנל'
    : hasSel ? 'גררו את התמונה המסומנת כדי לשנות את החיתוך' : 'לחצו על תמונה או על כותרת כדי לבחור אותה';
  if (hasSel) {
    const pid = pg.photos[ed.sel];
    $('#edZoom').value = pg.crops?.[pid]?.zoom || 1;
    $('#edPhotoCaption').value = pg.captions?.[pid] || '';
    $('#edPhotoCaption').classList.toggle('hidden', !isPhotos);
    $('#edPhotoCaption').previousElementSibling.classList.toggle('hidden', !isPhotos);
    const shape = pg.shapes?.[ed.sel] || '';
    $$('#edShape button').forEach(b => b.classList.toggle('active', b.dataset.v === shape));
  }
  // layouts
  $('#edLayoutSec').classList.toggle('hidden', !isPhotos);
  if (isPhotos) {
    const wrap = $('#edLayouts');
    wrap.innerHTML = '';
    const f = formatOf(state.album);
    const n = pg.photos.length;
    for (const t of TEMPLATES.filter(t => t.slots.length === n)) {
      const b = document.createElement('button');
      b.className = t.id === pg.template ? 'active' : '';
      b.title = t.id;
      const c = document.createElement('canvas');
      drawTemplateIcon(c, t, f.w / f.h);
      b.appendChild(c);
      b.onclick = () => { pg.template = t.id; delete pg.shapes; edUpdatePanel(); edRender(); };
      wrap.appendChild(b);
    }
    $('#edAdd').disabled = n >= 6;
  }
  // styles
  const st = $('#edStyles');
  st.innerHTML = '';
  const addChip = (id, name) => {
    const b = document.createElement('button');
    b.className = 'chip small' + ((pg.style || '') === id ? ' active' : '');
    b.textContent = name;
    b.onclick = () => { if (id) pg.style = id; else delete pg.style; edUpdatePanel(); edRender(); };
    st.appendChild(b);
  };
  addChip('', 'כמו האלבום');
  for (const [id, t] of Object.entries(THEMES)) addChip(id, t.name);
  // backgrounds
  const bgs = $('#edBgs');
  bgs.innerHTML = '';
  const def = document.createElement('button');
  def.textContent = 'אוטו';
  def.title = 'צבע הסגנון';
  def.className = pg.bg ? '' : 'active';
  def.onclick = () => { delete pg.bg; edUpdatePanel(); edRender(); };
  bgs.appendChild(def);
  for (const c of BG_SWATCHES) {
    const b = document.createElement('button');
    b.style.background = c;
    b.className = pg.bg === c ? 'active' : '';
    b.onclick = () => { pg.bg = c; edUpdatePanel(); edRender(); };
    bgs.appendChild(b);
  }
  const custom = document.createElement('input');
  custom.type = 'color'; custom.title = 'צבע אחר';
  custom.value = pg.bg && pg.bg.startsWith('#') ? pg.bg : '#ffffff';
  custom.oninput = debounce(() => { pg.bg = custom.value; edRender(); }, 120);
  bgs.appendChild(custom);
  // text
  const tx = $('#edText');
  const field = (label, value, set, ph = '') => {
    const l = document.createElement('label'); l.className = 'lbl'; l.textContent = label;
    // a box that grows with the text, so long captions are fully visible while typing
    const i = document.createElement('textarea'); i.className = 'input grow'; i.rows = 1; i.value = value || ''; i.placeholder = ph;
    const fit = () => { i.style.height = 'auto'; i.style.height = i.scrollHeight + 2 + 'px'; };
    i.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); }); // one-line text, wrapped only on screen
    i.addEventListener('input', fit);
    i.oninput = debounce(() => { set(i.value.replace(/\s*\n\s*/g, ' ')); edRender(); }, 250);
    tx.append(l, i);
    requestAnimationFrame(fit);
    if (label === 'כיתוב בתחתית העמוד') {
      const b = document.createElement('label');
      b.className = 'check';
      b.innerHTML = `<input type="checkbox" ${pg.captionBullets ? 'checked' : ''}> הצגה כבולטים – מפרידים בפסיק (למשל: מפלי טראון, פלאכאו)`;
      b.querySelector('input').onchange = e => { if (e.target.checked) pg.captionBullets = true; else delete pg.captionBullets; edRender(); };
      tx.append(b);
    }
  };
  tx.innerHTML = '';
  if (pg.type === 'cover') {
    field('כותרת', ed.album.title, v => ed.album.title = v);
    field('כותרת משנה', ed.album.subtitle, v => ed.album.subtitle = v);
    field('שורה שלישית', ed.album.subtitle2, v => ed.album.subtitle2 = v, 'למשל: נועה, איתי ותמר');
    field('כיתוב בתחתית העמוד', pg.caption, v => pg.caption = v, 'למשל: באהבה, סבא וסבתא');
  } else if (pg.type === 'photos') {
    // a page title can be added to any photo page
    const selectTitle = before => {
      if (before || !(pg.title || pg.subtitle)) return;
      // a new title was just added – select it so it can be moved/resized right away
      ed.selText = 'title'; ed.sel = null;
      $('#edSlot').classList.add('hidden');
      $('#edTextSel').classList.remove('hidden');
      $('#edTextSize').value = pg.text?.title?.scale || 1;
      $('#edTextSizeLbl').textContent = Math.round((pg.text?.title?.scale || 1) * 100) + '%';
    };
    field('כותרת לעמוד', pg.title, v => { const had = pg.title || pg.subtitle; pg.title = v; selectTitle(had); }, 'למשל: החתונה של דנה');
    field('שורה נוספת מתחת לכותרת', pg.subtitle, v => { const had = pg.title || pg.subtitle; pg.subtitle = v; selectTitle(had); }, 'למשל: אוגוסט 2025');
    const chk = document.createElement('label');
    chk.className = 'check';
    const boxedNow = pg.titleBox ?? edTheme().titlePanel !== false;
    chk.innerHTML = `<input type="checkbox" ${boxedNow ? 'checked' : ''}> רקע מאחורי הכותרת (קריא גם מעל תמונות)`;
    chk.querySelector('input').onchange = e => { pg.titleBox = e.target.checked; edRender(); };
    tx.append(chk);
    field('כיתוב בתחתית העמוד', pg.caption, v => pg.caption = v, 'למשל: סבתא וסבא בחתונה');
    const dchk = document.createElement('label');
    dchk.className = 'check';
    dchk.innerHTML = `<input type="checkbox" ${pg.showDate ? 'checked' : ''}> הצגת התאריך בתחתית העמוד (כשאין כיתוב)`;
    dchk.querySelector('input').onchange = e => { if (e.target.checked) pg.showDate = true; else delete pg.showDate; edRender(); };
    tx.append(dchk);
    if (edTheme().labels) field('תווית בראש העמוד', pg.label, v => pg.label = v, 'למשל: יולי 2025');
  } else {
    field('כותרת', pg.title, v => pg.title = v);
    field('שורה נוספת', pg.subtitle, v => pg.subtitle = v, pg.type === 'chapter' ? 'למשל: הטיול לצפון' : '');
    field('כיתוב בתחתית העמוד', pg.caption, v => pg.caption = v, 'למשל: הרגע שבו הכל התחיל');
  }
}

async function openEditor(i) {
  const a = state.album;
  if (!a.pages?.[i]) return;
  ed.index = i;
  ed.page = structuredClone(a.pages[i]);
  ed.album = { ...a, pages: undefined };
  ed.sel = ed.page.photos.length === 1 ? 0 : null;
  ed.selText = null;
  ed.swap = false;
  const label = i === 0 ? 'כריכה' : ed.page.textPage ? 'עמוד טקסט' : ({ chapter: 'פתיחת פרק', end: 'עמוד סיום' }[ed.page.type] || 'עמוד');
  $('#edTitle').textContent = `${label} · ${i === 0 ? '' : i + ' מתוך ' + (a.pages.length - 1)}`.replace(/ · $/, '');
  $('#edPrev').disabled = i === 0;
  $('#edNext').disabled = i >= a.pages.length - 1;
  $('#editor').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  edUpdatePanel();
  await edRender();
}

async function edCommit() {
  const a = state.album;
  a.pages[ed.index] = ed.page;
  const coverChanged = ed.page.type === 'cover' && (a.title !== ed.album.title || a.subtitle !== ed.album.subtitle || a.subtitle2 !== ed.album.subtitle2);
  a.title = ed.album.title; a.subtitle = ed.album.subtitle; a.subtitle2 = ed.album.subtitle2;
  await db.saveAlbum(a);
  rerenderPage(ed.index);
  if (coverChanged || ed.index === 0) {
    $('#titleInput').value = a.title || ''; $('#subtitleInput').value = a.subtitle || ''; $('#subtitle2Input').value = a.subtitle2 || '';
    renderThemePicker();
  }
}
function closeEditor() {
  $('#editor').classList.add('hidden');
  document.body.style.overflow = '';
}

$$('#edType button').forEach(b => b.onclick = async () => {
  const type = b.dataset.v;
  if (ed.page.type === type) return;
  const i = ed.index;
  await edCommit(); // keep edits made so far
  const before = structuredClone(state.album.pages);
  const note = setPageType(i, type);
  if (note == null) return;
  await db.saveAlbum(state.album);
  renderPages();
  await openEditor(i);
  if (type === 'chapter') { ed.selText = null; edUpdatePanel(); }
  let msg = note || 'העמוד הפך לפתיחת פרק';
  if ((state.album.pages.length - 1) % 2) msg += ' · שימו לב: מספר עמודים אי-זוגי';
  toast(msg, 6000, { label: 'ביטול', run: async () => { state.album.pages = before; await db.saveAlbum(state.album); renderPages(); closeEditor(); } });
});

$('#edSave').onclick = async () => { await edCommit(); closeEditor(); toast('העמוד נשמר'); };
$('#edCancel').onclick = closeEditor;
$('#edPrev').onclick = async () => { await edCommit(); openEditor(ed.index - 1); };
$('#edNext').onclick = async () => { await edCommit(); openEditor(ed.index + 1); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#editor').classList.contains('hidden') && $('#picker').classList.contains('hidden')) closeEditor(); });
window.addEventListener('resize', debounce(() => { if (!$('#editor').classList.contains('hidden')) edRender(); }, 200));

$('#edPhotoCaption').oninput = debounce(() => {
  if (ed.sel == null) return;
  const pid = ed.page.photos[ed.sel];
  const v = $('#edPhotoCaption').value;
  ed.page.captions ||= {};
  if (v) ed.page.captions[pid] = v; else delete ed.page.captions[pid];
  edRender();
}, 250);

$('#edTextSize').oninput = () => {
  if (!ed.selText) return;
  const t = textCfg(ed.selText);
  t.scale = +$('#edTextSize').value;
  $('#edTextSizeLbl').textContent = Math.round(t.scale * 100) + '%';
  edRender();
};
$$('.ed-pos button').forEach(b => b.onclick = () => {
  if (!ed.selText) return;
  const box = ed.texts.find(x => x.id === ed.selText);
  if (!box) return;
  const t = textCfg(ed.selText);
  const c = $('#edCanvas'), W = c.width, H = c.height, m = 0.05;
  if (b.dataset.v) {
    const target = b.dataset.v === 'top' ? H * m : b.dataset.v === 'bottom' ? H * (1 - m) - box.h : (H - box.h) / 2;
    t.dy = (t.dy || 0) + (target - box.y) / H;
  } else {
    const target = b.dataset.h === 'right' ? W * (1 - m) - box.w : b.dataset.h === 'left' ? W * m : (W - box.w) / 2;
    t.dx = (t.dx || 0) + (target - box.x) / W;
  }
  edRender();
});
$('#edTextReset').onclick = () => {
  if (!ed.selText || !ed.page.text) return;
  delete ed.page.text[ed.selText];
  edUpdatePanel(); edRender();
};

$('#edZoom').oninput = () => {
  if (ed.sel == null) return;
  cropFor(ed.sel).zoom = +$('#edZoom').value;
  edRender();
};
$('#edResetCrop').onclick = () => {
  if (ed.sel == null || !ed.page.crops) return;
  delete ed.page.crops[ed.page.photos[ed.sel]];
  $('#edZoom').value = 1;
  edRender();
};
$$('#edShape button').forEach(b => b.onclick = () => {
  if (ed.sel == null) return;
  ed.page.shapes ||= {};
  if (b.dataset.v) ed.page.shapes[ed.sel] = b.dataset.v; else delete ed.page.shapes[ed.sel];
  edUpdatePanel(); edRender();
});
$('#edSwap').onclick = () => { ed.swap = !ed.swap; edUpdatePanel(); edDrawSel(); };
$('#edReplace').onclick = async () => {
  const id = await pickPhoto(ed.sel != null ? ed.page.photos[ed.sel] : null);
  if (!id || ed.sel == null) return;
  ed.page.photos[ed.sel] = id;
  edUpdatePanel(); edRender();
};
$('#edRemove').onclick = () => {
  const pg = ed.page;
  if (pg.photos.length <= 1) { toast('זו התמונה היחידה בעמוד – אפשר להחליף אותה, או למחוק את כל העמוד'); return; }
  const ids = pg.photos.filter((_, k) => k !== ed.sel);
  relayout(ids);
  ed.sel = null;
  edUpdatePanel(); edRender();
};
$('#edAdd').onclick = async () => {
  const id = await pickPhoto();
  if (!id) return;
  relayout([...ed.page.photos, id]);
  ed.sel = ed.page.photos.indexOf(id);
  edUpdatePanel(); edRender();
};
$('#edAuto').onclick = () => { relayout(ed.page.photos, ed.page.template); edUpdatePanel(); edRender(); };
// copy a page's look (style, background, texts and their size/position) from another album
const PAGE_KIND = p => p.type === 'cover' ? 'כריכה' : p.type === 'chapter' ? 'פתיחת פרק' : p.type === 'end' ? (p.textPage ? 'עמוד טקסט' : 'עמוד סיום') : 'עמוד תמונות';
$('#edCopyFrom').onclick = async () => {
  const others = (await db.listAlbums()).filter(x => x.id !== state.album.id && x.pages?.length);
  if (!others.length) { toast('אין עדיין אלבום אחר מעוצב להעתיק ממנו'); return; }
  const cur = ed.page, curIdx = ed.index, curLast = curIdx === state.album.pages.length - 1;
  // suggest the matching page: same kind, and the last page for the last page
  const suggest = al => {
    if (curLast) return al.pages.length - 1;
    if (cur.type === 'cover') return 0;
    const same = al.pages.findIndex((p, i) => i > 0 && p.type === cur.type);
    return same >= 0 ? same : Math.min(curIdx, al.pages.length - 1);
  };
  const optsFor = al => al.pages.map((p, i) => `<option value="${i}" ${i === suggest(al) ? 'selected' : ''}>${i === 0 ? 'כריכה' : `עמוד ${i} · ${PAGE_KIND(p)}`}${p.title ? ' – ' + esc(p.title).slice(0, 30) : ''}</option>`).join('');
  const body = await modal('העתקת עיצוב מאלבום אחר', `
    <label class="lbl">מאיזה אלבום?</label>
    <select class="input" id="cpAlbum">${others.map(al => `<option value="${al.id}">${esc(al.name)}</option>`).join('')}</select>
    <label class="lbl">מאיזה עמוד?</label>
    <select class="input" id="cpPage">${optsFor(others[0])}</select>
    <p class="small" style="text-align:right">יועתקו: הסגנון, צבע הרקע, הכותרות והכיתוב, וגודל ומיקום הטקסט. התמונות של העמוד הזה לא ישתנו – אחרי ההעתקה אפשר לשנות את הטקסט.</p>`, 'העתקה');
  if (body) { /* handled below */ }
  else return;
  const al = others.find(x => x.id === body.querySelector('#cpAlbum').value);
  const src = al.pages[+body.querySelector('#cpPage').value];
  if (!src) return;
  for (const key of ['style', 'bg', 'title', 'subtitle', 'caption', 'captionBullets', 'showDate', 'titleBox', 'text', 'variant', 'quote', 'label']) {
    if (src[key] === undefined) delete ed.page[key]; else ed.page[key] = structuredClone(src[key]);
  }
  if (cur.type === 'end' && src.type === 'end') { if (src.textPage) ed.page.textPage = true; else delete ed.page.textPage; }
  if (cur.type === 'cover' && src.type === 'cover') {
    ed.album.title = al.title; ed.album.subtitle = al.subtitle; ed.album.subtitle2 = al.subtitle2;
  }
  ed.selText = null;
  edUpdatePanel(); edRender();
  toast('העיצוב הועתק – עכשיו אפשר לשנות את הטקסט בחלק "טקסט" ואז "שמירה"', 6000);
};
// refresh the page list when another album is chosen in the copy dialog
document.addEventListener('change', async e => {
  if (e.target.id !== 'cpAlbum') return;
  const al = (await db.listAlbums()).find(x => x.id === e.target.value);
  if (!al) return;
  const curLast = ed.index === state.album.pages.length - 1;
  const idx = curLast ? al.pages.length - 1 : ed.page.type === 'cover' ? 0 : Math.max(0, al.pages.findIndex((p, i) => i > 0 && p.type === ed.page.type));
  $('#cpPage').innerHTML = al.pages.map((p, i) => `<option value="${i}" ${i === idx ? 'selected' : ''}>${i === 0 ? 'כריכה' : `עמוד ${i} · ${PAGE_KIND(p)}`}${p.title ? ' – ' + esc(p.title).slice(0, 30) : ''}</option>`).join('');
});

$('#edVariant').onclick = () => { ed.page.variant = Math.random(); edRender(); };

// ---------- photo picker ----------
let pickerResolve = null;
let pickerTab = 'unused';
let pickerCurrent = null;
let pickerNew = [];
const pickerDayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
try { const v = localStorage.getItem('pickerSize'); if (v) document.documentElement.style.setProperty('--pk', v + 'px'); } catch {}

function pickPhoto(currentId = null) {
  return new Promise(resolve => {
    pickerResolve = resolve;
    pickerCurrent = currentId;
    pickerNew = [];
    $('#pickerTabs [data-v="new"]').classList.add('hidden');
    if (pickerTab === 'new') pickerTab = 'unused';
    $('#picker').classList.remove('hidden');
    syncPickerControls();
    renderPicker();
  });
}
function closePicker(id) {
  $('#picker').classList.add('hidden');
  $('#pickerGrid').innerHTML = '';
  const r = pickerResolve; pickerResolve = null;
  r && r(id || null);
}
function syncPickerControls() {
  $$('#pickerTabs button').forEach(x => x.classList.toggle('active', x.dataset.v === pickerTab));
  const size = getComputedStyle(document.documentElement).getPropertyValue('--pk').trim() || '140px';
  $$('#pickerSize button').forEach(x => x.classList.toggle('active', x.dataset.v + 'px' === size));
}
$('#pickerClose').onclick = () => closePicker(null);
$('#picker').onclick = e => { if (e.target.id === 'picker') closePicker(null); };
$$('#pickerTabs button').forEach(b => b.onclick = () => { pickerTab = b.dataset.v; syncPickerControls(); renderPicker(); });
$$('#pickerSize button').forEach(b => b.onclick = () => {
  document.documentElement.style.setProperty('--pk', b.dataset.v + 'px');
  try { localStorage.setItem('pickerSize', b.dataset.v); } catch {}
  syncPickerControls();
});

// upload straight from the gallery inside the picker
$('#pickerFile').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const prog = $('#pickerProgress');
  prog.classList.remove('hidden');
  const res = await importFiles(files, (done, total) => {
    prog.textContent = `מעלה ומנתח… ${Math.min(done + 1, total)} מתוך ${total}`;
  });
  prog.textContent = 'כמעט מוכן…';
  // photos picked by hand belong in the album even if they look like duplicates
  for (const p of res.added) if (p.manual !== 'in') p.manual = 'in';
  await recurate();
  await db.updatePhotos(res.added);
  await db.saveAlbum(state.album);
  prog.classList.add('hidden');
  if (res.failed) toast(`${res.failed} תמונות לא נתמכו (למשל HEIC – נסו להמיר ל-JPG)`, 5000);
  if (!res.added.length) return;
  if (res.added.length === 1) { closePicker(res.added[0].id); return; }
  pickerNew = res.added.map(p => p.id);
  const nb = $('#pickerTabs [data-v="new"]');
  nb.classList.remove('hidden');
  nb.textContent = `שהועלו עכשיו (${pickerNew.length})`;
  pickerTab = 'new';
  syncPickerControls();
  renderPicker();
};

function renderPicker() {
  const a = state.album;
  const usedOn = new Map();
  (a.pages || []).forEach((pg, i) => (i === ed.index ? ed.page : pg).photos.forEach(id => { if (!usedOn.has(id)) usedOn.set(id, i); }));
  const all = [...state.photos].sort((x, y) => x.date - y.date);
  const unused = all.filter(p => !usedOn.has(p.id));
  const tabs = $$('#pickerTabs button');
  tabs[0].textContent = `לא בשימוש (${unused.length})`;
  tabs[1].textContent = `כל התמונות (${all.length})`;
  let list = pickerTab === 'unused' ? unused : pickerTab === 'new' ? all.filter(p => pickerNew.includes(p.id)) : all;
  const grid = $('#pickerGrid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = `<div class="picker-empty">${pickerTab === 'unused'
      ? 'כל התמונות כבר נמצאות באלבום.<br>עברו ל"כל התמונות", או העלו תמונה חדשה מהגלריה.'
      : 'אין עדיין תמונות. לחצו "📷 העלאה מהגלריה".'}</div>`;
    return;
  }
  let lastDay = null;
  for (const p of list) {
    const day = new Date(p.date).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      const h = document.createElement('div');
      h.className = 'picker-day';
      h.textContent = pickerDayFmt.format(new Date(p.date));
      grid.appendChild(h);
    }
    const b = document.createElement('button');
    b.className = 'picker-item' + (isIncluded(p) ? '' : ' excluded') + (p.id === pickerCurrent ? ' current' : '');
    const img = document.createElement('img');
    img.loading = 'lazy';
    if (p.thumb instanceof Blob) { const u = URL.createObjectURL(p.thumb); img.src = u; img.onload = () => URL.revokeObjectURL(u); }
    b.appendChild(img);
    let badges = '';
    if (p.id === pickerCurrent) badges += '<span class="pk-badge cur">התמונה הנוכחית</span>';
    else if (usedOn.has(p.id)) { const n = usedOn.get(p.id); badges += `<span class="pk-badge">${n === 0 ? 'בכריכה' : 'בעמוד ' + n}</span>`; }
    if (!isIncluded(p)) badges += `<span class="pk-badge dim">${p.duplicate ? 'כפילות' : 'לא נבחרה'}</span>`;
    if (badges) b.insertAdjacentHTML('beforeend', `<div class="pk-badges">${badges}</div>`);
    b.onclick = async () => {
      if (p.id === pickerCurrent) { closePicker(null); return; }
      if (!isIncluded(p)) { p.manual = 'in'; await db.updatePhoto(p); }
      closePicker(p.id);
    };
    grid.appendChild(b);
  }
}

route().catch(e => { console.error(e); toast('משהו השתבש בטעינה – נסו לרענן את הדף', 8000); });
window.__albumsReady = true;
