// 파킹세이브 서비스 워커: 오프라인일 때 화면 이동 요청에만 안내 페이지를 보여준다.
// 검색 결과·요금·API 응답은 캐시하지 않는다(요금·운영 정보는 최신 데이터로 계산해야 하고, 위치가 담긴 요청을 기기에 남기지 않기 위함).
const CACHE = "parkingsave-offline-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" }))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // 화면 이동만 처리, 나머지는 브라우저 기본 동작
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

// 주차 타이머 알림을 누르면 해당 주차장 화면으로(같은 사이트 경로만)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const url = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const w = wins.find((c) => "focus" in c);
      if (w) return (w.navigate ? w.navigate(url) : Promise.resolve()).then(() => w.focus());
      return self.clients.openWindow(url);
    }),
  );
});
