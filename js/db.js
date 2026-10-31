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

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- albums ----------
export async function listAlbums() {
  const all = await promisify((await store('albums')).getAll());
  return all.sort((a, b) => b.updated - a.updated);
}
export async function getAlbum(id) {
  return promisify((await store('albums')).get(id));
}
export async function saveAlbum(album) {
  album.updated = Date.now();
  return promisify((await store('albums', 'readwrite')).put(album));
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
  return promisify(s.index('albumId').getAll(albumId));
}
export async function savePhoto(photo, original) {
  const db = await openDB();
  const tx = db.transaction(['photos', 'originals'], 'readwrite');
  tx.objectStore('photos').put(photo);
  if (original) tx.objectStore('originals').put({ id: photo.id, blob: original });
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
export async function updatePhoto(photo) {
  return promisify((await store('photos', 'readwrite')).put(photo));
}
export async function getOriginal(id) {
  const r = await promisify((await store('originals')).get(id));
  return r ? r.blob : null;
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
