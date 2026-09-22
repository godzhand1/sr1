// IndexedDB store for user-authored custom character GLBs.
//
// After the user rigs a mesh in Rig Lab and clicks "Use in Game",
// the exported GLB blob lands here and characterMeshy.js will
// prefer it over the shipped /models/meshy_warrior.glb for every
// spawn — so the whole game (multiplayer, bots, matchmaking) uses
// the user's own rigged model until they revert.
//
// IndexedDB (not localStorage) because character GLBs are 20-100
// MB and localStorage tops out at ~5 MB. The store is a single
// key so we hold ONE custom character at a time — replacing it is
// a one-write operation and reverting is a one-delete.
//
// Public API:
//   saveCustomCharacter(blob)         → Promise<{ bytes }>
//   getCustomCharacterBlobURL()       → Promise<string | null>
//   hasCustomCharacter()              → Promise<boolean>
//   clearCustomCharacter()            → Promise<void>

const DB_NAME = 'brawl3d_custom_character';
const DB_VERSION = 1;
const STORE = 'characters';
const KEY = 'active';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCustomCharacter(blob) {
  if (!(blob instanceof Blob)) throw new Error('saveCustomCharacter: pass a Blob');
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return { bytes: blob.size };
  } finally {
    db.close();
  }
}

// Returns a blob URL for the stored character, or `null` if none.
// Callers should URL.revokeObjectURL after they're done with it —
// characterMeshy.js does this in its loader `.finally` block.
export async function getCustomCharacterBlobURL() {
  const db = await openDB();
  try {
    const blob = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    db.close();
  }
}

export async function hasCustomCharacter() {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count(KEY);
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function clearCustomCharacter() {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
