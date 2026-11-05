// Phiên bản + mã website lấy từ config.js (phienBan, maApp) để chỉ phải sửa ở một nơi. Cách đặt tên cache phải trùng với app.js
try { importScripts("./config.js"); } catch (e) { /* không đọc được config.js: dùng giá trị mặc định */ }
const APP_CFG = self.APP_CONFIG || {};
const MA = String(APP_CFG.maApp || "").replace(/[^A-Za-z0-9_-]/g, "");
// Số phiên bản lấy từ CHÍNH địa chỉ đăng ký sw.js?v=rXX (app.js đăng ký kèm ?v=): luôn khớp tên bộ nhớ app.js đã lưu.
// Không dựa vào config.js được nạp qua importScripts vì GitHub Pages cho trình duyệt giữ bản cũ tới 10 phút -> SW có thể tính ra phiên bản cũ, tìm sai bộ nhớ (hiện "Không thể truy cập") và xoá nhầm bộ nhớ mới.
const URL_V = (() => { try { return new URL(self.location.href).searchParams.get("v") || ""; } catch (e) { return ""; } })();
const REV = URL_V || String(APP_CFG.phienBan || "dev").split("-")[0];
const V = "?v=" + REV;
const SHELL_PREFIX = "panorama-shell:" + MA + ":";
const SHELL_CACHE = SHELL_PREFIX + REV;
const CDN_CACHE = "panorama-cdn-v2";
const IMG_CACHE = "panorama-img-v2"; // ảnh landing (Picsum / Google Drive qua wsrv.nl)
// Không tải sẵn gì khi cài: việc lưu các tệp giao diện/thư viện vào bộ nhớ offline do app.js làm (có thanh tiến trình, khi người dùng yêu cầu tạo bản offline)
self.addEventListener("install", event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const stale = k => k.startsWith("panorama-shell-")                                   // tên kiểu cũ (trước khi có maApp)
      || (k.startsWith(SHELL_PREFIX) && k !== SHELL_CACHE)                                // phiên bản cũ của chính website này
      || (k.startsWith("panorama-cdn-") && k !== CDN_CACHE) || (k.startsWith("panorama-img-") && k !== IMG_CACHE);
    await Promise.all(keys.filter(stale).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
// Tìm tệp trong BẤT KỲ bộ nhớ giao diện nào của website (phòng khi tên bộ nhớ SW tính ra khác tên app.js đã lưu, ví dụ đổi phiên bản giữa chừng)
async function findShell(...urls) {
  for (const k of await caches.keys()) {
    if (!k.startsWith("panorama-shell")) continue;
    const c = await caches.open(k);
    for (const u of urls) { const r = await c.match(u, { ignoreSearch: true }); if (r) return r; }
  }
  return null;
}
// Bản "sạch" của phản hồi đã lưu: Chrome không cho trả phản hồi có cờ redirected cho lượt điều hướng. Bỏ Content-Encoding/Length vì nội dung đã được giải nén.
const cleanHeaders = h => { const n = new Headers(h); n.delete("content-encoding"); n.delete("content-length"); return n; };
const clean = async r => (r && r.redirected) ? new Response(await r.blob(), { status: 200, statusText: "OK", headers: cleanHeaders(r.headers) }) : r;
// Phản hồi lấy từ bộ nhớ khi không có mạng (dùng chung cho fetch thật và cho kiểm tra chẩn đoán)
async function offlineResponse(req, sameOrigin, isNav) {
  const cache = await caches.open(sameOrigin ? SHELL_CACHE : CDN_CACHE);
  const hit = (await cache.match(req, { ignoreSearch: true })) || (sameOrigin ? await findShell(req.url) : null);
  if (hit) return clean(hit);
  if (sameOrigin && isNav) {
    const fb = (await cache.match("./index.html", { ignoreSearch: true })) || (await cache.match("./", { ignoreSearch: true })) || (await findShell("./index.html", "./"));
    if (fb) return clean(fb);
  }
  return null;
}
// Trang diag.html hỏi SW để biết nó thấy gì trong bộ nhớ
self.addEventListener("message", event => {
  const d = event.data || {};
  if (d.type !== "diag" || !event.ports || !event.ports[0]) return;
  event.waitUntil((async () => {
    const out = { rev: REV, urlV: URL_V, configRev: APP_CFG.phienBan || null, shellCache: SHELL_CACHE, scope: self.registration.scope, caches: {}, offlineTests: {} };
    try { for (const k of await caches.keys()) out.caches[k] = (await (await caches.open(k)).keys()).map(r => r.url); } catch (e) { out.cachesError = String(e); }
    for (const u of ["./index.html", "./"]) {
      try {
        const r = await offlineResponse(new Request(new URL(u, self.registration.scope).href), true, true);
        out.offlineTests[u] = r ? { found: true, status: r.status, type: r.type, redirected: r.redirected, contentEncoding: r.headers.get("content-encoding"), contentType: r.headers.get("content-type") } : { found: false };
      } catch (e) { out.offlineTests[u] = { found: false, error: String(e) }; }
    }
    event.ports[0].postMessage(out);
  })());
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return; // bỏ qua blob:, data:
  const sameOrigin = url.origin === self.location.origin;
  const cdn = url.hostname === "cdn.jsdelivr.net";
  if (!sameOrigin && !cdn) {
    // Ảnh nền/ảnh minh hoạ của trang giới thiệu: ưu tiên cache để chạy offline (cho phép response opaque)
    if (req.destination === "image") event.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      // Chỉ lưu phản hồi đã xác nhận là thành công. KHÔNG lưu phản hồi "opaque": loại này không cho biết ảnh tốt hay lỗi (404, hết hạn mức...),
      // lưu vào sẽ khiến ảnh lỗi bị trả lại mãi dù file Drive đã được chia sẻ công khai về sau.
      if (r.ok) cache.put(req, r.clone()).catch(() => {});
      return r;
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(sameOrigin ? SHELL_CACHE : CDN_CACHE);
    // Same-origin (app.js, index.html, tours/*): ưu tiên mạng, rớt mạng thì dùng cache -> cập nhật code luôn có hiệu lực
    // CDN: ưu tiên cache (file có version cố định)
    if (!sameOrigin) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    try {
      const response = await fetch(req, sameOrigin ? { cache: "no-cache" } : undefined);
      if (response.ok && response.type !== "opaque") cache.put(req, response.clone()).catch(() => {});
      return response;
    } catch (e) {
      const r = await offlineResponse(req, sameOrigin, req.mode === "navigate");
      if (r) return r;
      throw e;
    }
  })());
});
