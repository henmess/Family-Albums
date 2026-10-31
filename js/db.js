// Local storage of albums and photos in the browser (IndexedDB).
// Nothing is uploaded to any server – photos stay on the user's device.

const DB_NAME = 'family-albums';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('albums')) {
        db.createObjectStore('albums', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('albumId', 'albumId');
      }
      if (!db.objectStoreNames.contains('originals')) {
        db.createObjectStore('originals', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

// Safari can fail to read Blobs back from IndexedDB after a reload, so binary
// data is stored as ArrayBuffer + type and turned back into a Blob on read.
async function packBlob(b) {
  if (!(b instanceof Blob)) return b;
  try {
    return { __blob: true, type: b.type, buf: await b.arrayBuffer() };
  } catch {
    return b; // unreadable (old Safari data) – keep as is
  }
}
function unpackBlob(v) {
  if (v && v.__blob) return new Blob([v.buf], { type: v.type });
  return v;
}
async function packPhoto(p) {
  const { legacy, ...rest } = p;
  return { ...rest, thumb: await packBlob(p.thumb) };
}
function unpackPhoto(r) {
  if (r) {
    r.legacy = !(r.thumb && r.thumb.__blob); // saved by an older version
    r.thumb = unpackBlob(r.thumb);
  }
  return r;
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- albums ----------
export async function listAlbums() {
  const all = (await promisify((await store('albums')).getAll())).map(unpackAlbum);
  return all.sort((a, b) => b.updated - a.updated);
}
function unpackAlbum(a) {
  if (a) a.coverThumb = unpackBlob(a.coverThumb);
  return a;
}
export async function getAlbum(id) {
  return unpackAlbum(await promisify((await store('albums')).get(id)));
}
export async function saveAlbum(album) {
  album.updated = Date.now();
  const rec = { ...album, coverThumb: await packBlob(album.coverThumb) };
  return promisify((await store('albums', 'readwrite')).put(rec));
}
export async function deleteAlbum(id) {
  const photos = await listPhotos(id);
  for (const p of photos) await deletePhoto(p.id);
  return promisify((await store('albums', 'readwrite')).delete(id));
}

// ---------- photos ----------
// photo record: metadata + small thumbnail blob. The full-resolution file
// lives in a separate store and is loaded only for print export.
export async function listPhotos(albumId) {
  const s = await store('photos');
  return (await promisify(s.index('albumId').getAll(albumId))).map(unpackPhoto);
}
export async function savePhoto(photo, original) {
  const rec = await packPhoto(photo);
  const orig = original ? await packBlob(original) : null;
  const db = await openDB();
  const tx = db.transaction(['photos', 'originals'], 'readwrite');
  tx.objectStore('photos').put(rec);
  if (orig) tx.objectStore('originals').put({ id: photo.id, blob: orig });
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
export async function updatePhoto(photo) {
  const rec = await packPhoto(photo);
  return promisify((await store('photos', 'readwrite')).put(rec));
}
export async function updatePhotos(photos) {
  const recs = await Promise.all(photos.map(packPhoto));
  const db = await openDB();
  const tx = db.transaction('photos', 'readwrite');
  const st = tx.objectStore('photos');
  recs.forEach(r => st.put(r));
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
export async function getOriginal(id) {
  const r = await promisify((await store('originals')).get(id));
  return r ? unpackBlob(r.blob) : null;
}
// re-save an old record in the Safari-safe format (also the original file)
export async function migratePhoto(photo) {
  const r = await promisify((await store('originals')).get(photo.id));
  if (r && r.blob instanceof Blob) {
    const packed = await packBlob(r.blob);
    if (packed !== r.blob) await promisify((await store('originals', 'readwrite')).put({ id: photo.id, blob: packed }));
  }
  await updatePhoto(photo);
  photo.legacy = false;
}

export async function deletePhoto(id) {
  const db = await openDB();
  const tx = db.transaction(['photos', 'originals'], 'readwrite');
  tx.objectStore('photos').delete(id);
  tx.objectStore('originals').delete(id);
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
