// Offline support for the Dyad Gong Timer.
// Strategy: network-first for the page itself (so updates propagate),
// cache-first for the immutable assets (audio, icons).
const CACHE = 'gong-timer-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './individual_gong.mp3',
  './final_gongs.mp3',
  './full_session.mp3',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    // Network-first: always try to pick up a newer page, fall back to cache
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Media elements fetch with Range headers; the Cache API stores full
  // responses, so serve ranges by slicing the cached body. This keeps audio
  // playback and seeking working fully offline.
  if (req.headers.has('range')) {
    event.respondWith(
      caches.match(req.url).then((cached) => {
        if (!cached) return fetch(req);
        return cached.arrayBuffer().then((buf) => {
          const total = buf.byteLength;
          const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range'));
          const start = m && m[1] ? parseInt(m[1], 10) : 0;
          const end = m && m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
          if (start >= total) {
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
          }
          return new Response(buf.slice(start, end + 1), {
            status: 206,
            headers: {
              'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Content-Length': String(end - start + 1),
              'Accept-Ranges': 'bytes',
            },
          });
        });
      })
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
