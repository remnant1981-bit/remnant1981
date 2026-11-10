importScripts('logic.js', 'store.js');

const CACHE = `coupon-wallet-${CW.VERSION}`;
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'logic.js', 'store.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const NET_TIMEOUT = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('coupon-wallet-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선(항상 최신) + 3초 안에 응답이 없거나 오프라인이면 캐시 (느린 망에서 빈 화면 방지)
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NET_TIMEOUT))
      ]);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});

// 백그라운드 점검: 설치된 PWA에서 크롬이 허용하는 주기(보통 하루 1회 안팎, 보장되지 않음)로 호출됨
self.addEventListener('periodicsync', e => {
  if (e.tag === 'expiry-check') e.waitUntil(CWStore.checkAndNotify(self.registration).catch(() => {}));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => (list[0] ? list[0].focus() : self.clients.openWindow('./')))
  );
});
