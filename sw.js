/* Service worker: best-effort precache (one file at a time, never addAll — a single
   missing file under NetSpark or a flaky connection must never block the whole install),
   network-first fetching, and the share-target handoff into ZugMatchDB's inbox store. */

const VERSION = '1';
const CACHE = 'zugmatch-v' + VERSION;
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './styles.css',
  './js/app.js', './js/db.js', './js/util.js', './js/history.js', './js/lists.js',
  './js/person.js', './js/forms.js', './js/send.js', './js/match.js', './js/backup.js',
  './js/import-whatsapp.js', './js/attach.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('zugmatch-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('ZugMatchDB', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('inbox')) d.createObjectStore('inbox');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function saveShare(req) {
  const f = await req.formData();
  const files = f.getAll('files').filter(Boolean);
  const d = await openDB();
  await new Promise((resolve, reject) => {
    const tx = d.transaction('inbox', 'readwrite');
    tx.objectStore('inbox').put({ title: String(f.get('title') || ''), text: String(f.get('text') || ''), url: String(f.get('url') || ''), files, ts: Date.now() }, 'pending');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try { await saveShare(e.request); return Response.redirect('./?shared=1', 303); }
      catch { return new Response('Import failed', { status: 500 }); }
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    try {
      const r = await fetch(e.request, { cache: 'no-store' });
      if (r.ok) { const c = await caches.open(CACHE); c.put(e.request, r.clone()); }
      return r;
    } catch {
      return (await caches.match(e.request)) || (e.request.mode === 'navigate' ? caches.match('./index.html') : new Response('', { status: 504 }));
    }
  })());
});
