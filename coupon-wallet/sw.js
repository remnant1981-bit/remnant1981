importScripts('logic.js', 'store.js');

const CACHE = `coupon-wallet-${CW.VERSION}`;
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'logic.js', 'store.js', 'scan.js', 'push.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
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

// 공유하기(Web Share Target)로 들어온 사진·글을 IndexedDB에 보관하고 앱으로 넘김 (앱이 열리면 꺼내 씀)
const SHARE_URL = new URL('share-target', self.registration.scope);
const shareRedirect = state => Response.redirect(new URL(`./?share=${state}`, self.registration.scope).href, 303);

async function handleShare(req) {
  try {
    if (!CW.shareOriginAllowed(req.headers.get('sec-fetch-site'))) return shareRedirect('blocked');
    const fd = await req.formData();
    const images = CW.pickShareImages(fd.getAll('image'));
    const text = [fd.get('title'), fd.get('text'), fd.get('url')].map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join('\n').slice(0, 1000);
    if (!images.length && !text) return shareRedirect('none');
    const prev = (await CWStore.getMeta('pendingShare')) || { items: [], text: '' };
    const items = prev.items.concat(images.map(f => ({ name: f.name || 'shared', type: f.type, blob: f }))).slice(-20);
    await CWStore.setMeta('pendingShare', { items, text: text || prev.text || '', at: Date.now() });
    return shareRedirect(images.length ? 'image' : 'text');
  } catch (e) {
    return shareRedirect('error');
  }
}

// 네트워크 우선(항상 최신) + 3초 안에 응답이 없거나 오프라인이면 캐시 (느린 망에서 빈 화면 방지)
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname === SHARE_URL.pathname) {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // 같은 사이트의 다른 앱(예: /rnd-budget/)은 건드리지 않음: 캐시하지 않고, 오프라인 대체 화면도 보여주지 않음
  if (!CW.isOwnPath(url.pathname, new URL(self.registration.scope).pathname)) return;
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

// 서버 푸시(내용 없는 신호): 기기 데이터로 알림을 만듦
self.addEventListener('push', e => {
  e.waitUntil(CWStore.handlePush(self.registration).catch(() =>
    self.registration.showNotification('쿠폰 지갑', { body: '확인할 쿠폰이 있는지 앱을 열어 보세요', icon: 'icon-192.png', tag: 'daily' })));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => (list[0] ? list[0].focus() : self.clients.openWindow('./')))
  );
});
