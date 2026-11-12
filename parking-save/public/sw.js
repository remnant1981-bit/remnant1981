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
