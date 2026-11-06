// Service worker（讓網站可以「加到主畫面」像 App 一樣開）
// 策略：網路優先。有網路一律拿最新版，沒網路才用上次存的版本，所以改版不會卡舊畫面。
// 只處理本站檔案；活動資料（Firebase）不經過這裡。
const CACHE = "sky-board-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && !req.url.includes("/ics/")) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("./")))
  );
});
