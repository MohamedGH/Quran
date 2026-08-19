// audio-sw.js — Quran audio cache via IndexedDB
// Place in /public/ — Vite serves it at root scope.
//
// In dev:  intercepts /audio-proxy/*.mp3  (Vite proxies these to CDN, no CORS)
// In prod: intercepts cdn.islamic.network/*.mp3 directly (no CORS on Android)
// Both paths → fetch succeeds → ArrayBuffer readable → stored in IDB.

const IDB_NAME        = 'quran-ts-cache';
const IDB_VERSION     = 3;
const IDB_AUDIO_STORE = 'audio';
const CDN_ORIGIN      = 'https://cdn.islamic.network';
const PROXY_PATH      = '/audio-proxy/';

// ── IDB ──────────────────────────────────────────────────────────────────────
let _db = null;
function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('timestamps')) db.createObjectStore('timestamps');
      if (!db.objectStoreNames.contains('quran'))      db.createObjectStore('quran');
      if (!db.objectStoreNames.contains(IDB_AUDIO_STORE)) db.createObjectStore(IDB_AUDIO_STORE);
    };
    req.onsuccess = e => { _db = e.target.result; res(_db); };
    req.onerror   = e => rej(e.target.error);
  });
}
async function idbGet(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const req = db.transaction(IDB_AUDIO_STORE, 'readonly')
                  .objectStore(IDB_AUDIO_STORE).get(key);
    req.onsuccess = () => res(req.result ?? null);
    req.onerror   = e => rej(e.target.error);
  });
}
async function idbSet(key, buf) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx  = db.transaction(IDB_AUDIO_STORE, 'readwrite');
    const req = tx.objectStore(IDB_AUDIO_STORE).put(buf, key);
    req.onerror   = e => rej(e.target.error);
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}

const urlToKey = url => url.split('/').pop(); // "7456.mp3"

function isAudioRequest(url) {
  return (url.includes(PROXY_PATH) || url.startsWith(CDN_ORIGIN)) && url.endsWith('.mp3');
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));

// ── Fetch interception ────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (!isAudioRequest(e.request.url)) return;

  e.respondWith((async () => {
    const key = urlToKey(e.request.url);

    // 1. Serve from IDB
    try {
      const buf = await idbGet(key);
      if (buf && buf.byteLength > 0) {
        return new Response(buf, {
          status: 200,
          headers: {
            'Content-Type':   'audio/mpeg',
            'Content-Length': String(buf.byteLength),
            'Accept-Ranges':  'bytes',
          },
        });
      }
    } catch {}

    // 2. Fetch (same-origin proxy in dev → no CORS; direct CDN in prod → no CORS on Android)
    try {
      const response = await fetch(e.request);
      if (response.ok) {
        const buf = await response.arrayBuffer();
        if (buf.byteLength > 0) {
          idbSet(key, buf).catch(() => {});
          return new Response(buf, {
            status:  200,
            headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(buf.byteLength), 'Accept-Ranges': 'bytes' },
          });
        }
      }
      return response;
    } catch {
      return new Response(null, { status: 503, statusText: 'Offline' });
    }
  })());
});

// ── Pre-cache on demand ───────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type !== 'PRECACHE_AUDIO') return;
  const urls = e.data.urls || [];
  (async () => {
    for (const url of urls) {
      try {
        const key = urlToKey(url);
        const existing = await idbGet(key);
        if (existing && existing.byteLength > 0) continue;
        const r = await fetch(url);
        if (r.ok) {
          const buf = await r.arrayBuffer();
          if (buf.byteLength > 0) await idbSet(key, buf);
        }
      } catch {}
    }
  })();
});