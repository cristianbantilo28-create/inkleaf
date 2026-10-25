/* Inkleaf service worker: caches the app shell so it opens offline, and keeps fonts once they have been seen. */
const VERSION = 'inkleaf-v1.8.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/db.js', './js/stickers.js', './js/hwr.js', './js/hwrclient.js', './js/lexicon.js', './js/crnn.js', './js/crnn-wasm.js', './js/crnn-weights.js', './js/transform.js', './js/cover.js', './js/editor.js', './js/bookopen.js', './js/paper.js', './js/search.js', './js/lock.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/mark-128.png', './icons/mark-320.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'inkleaf-fonts').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) {
    // fonts: cache first, refresh in the background
    e.respondWith(caches.open('inkleaf-fonts').then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(hit => hit || fetch(req).catch(() => caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone())); return res; })));
});
