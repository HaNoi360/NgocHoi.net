(() => {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  // ===== Các giá trị riêng của từng website đều lấy từ config.js (không sửa trong file này) =====
  const MA = String(CFG.maApp || "").replace(/[^A-Za-z0-9_-]/g, ""); // mã website (chỉ cần khi nhiều website chung một tên miền)
  const APP_VERSION = CFG.phienBan || "dev";
  const REV = APP_VERSION.split("-")[0];   // vd "r33": dùng đặt tên bộ nhớ offline + gắn ?v= cho tệp giao diện
  const V = "?v=" + REV;
  const lsKey = k => k + (MA ? "_" + MA : ""); // khóa localStorage riêng cho từng website
  // Bản ONLINE (mặc định): chỉ tải thứ cần dùng khi được gọi. Bản OFFLINE chỉ được tạo khi khách/Admin nhấn giữ nút cỡ chữ 5 giây.
  const OFFLINE_FLAG = lsKey("ap_offline"), SHELL_STAMP = lsKey("ap_shell");
  const isOfflineReady = () => { try { return localStorage.getItem(OFFLINE_FLAG) === "1"; } catch { return false; } };
  const setOfflineReady = on => { try { on ? localStorage.setItem(OFFLINE_FLAG, "1") : localStorage.removeItem(OFFLINE_FLAG); } catch {} };
  const DB_NAME = "panorama-tours-offline" + (MA ? "-" + MA : "");
  const DB_VERSION = 3;
  const TOUR_STORE = "tours";
  const IMAGE_STORE = "images";
  const THUMB_STORE = "thumbs";
  const LANDING_STORE = "landing"; // ảnh trang giới thiệu + bóc mái (khóa = URL nguồn)
  const SHELL_CACHE = "panorama-shell:" + MA + ":" + REV; // phải trùng cách đặt tên trong sw.js
  const CDN_CACHE = "panorama-cdn-v2";
  const TOUR_INDEX_URL = "./tours/index.json";
  // ===== Gửi đăng ký tư vấn về Google Sheet + email (xem file Code.gs). Địa chỉ + mã bí mật đặt trong config.js (guiDangKy) =====
  const LEAD_ENDPOINT = (CFG.guiDangKy && CFG.guiDangKy.url) || "";
  const LEAD_TOKEN = (CFG.guiDangKy && CFG.guiDangKy.token) || "";
  const SRC = CFG.nguonAnh || {};
  const $ = id => document.getElementById(id);
  // Tên App lấy từ config.js: đặt tiêu đề trang + tạo manifest với tên đó (để khi cài/lưu vào máy dùng đúng tên)
  (async function applyIdentity() {
    if (!CFG.tenApp) return;
    try {
      document.title = CFG.tenApp;
      document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", CFG.tenNgan || CFG.tenApp);
      const link = document.querySelector('link[rel="manifest"]'); if (!link) return;
      const mu = new URL(link.getAttribute("href"), location.href);
      const m = await (await fetch(mu, { cache: "no-cache" })).json();
      m.name = CFG.tenApp; m.short_name = CFG.tenNgan || CFG.tenApp; if (CFG.moTa) m.description = CFG.moTa;
      try { // màu thanh tiêu đề + màn hình chờ khi mở App lấy theo --ink trong theme.css
        const rgb = getComputedStyle(document.documentElement).getPropertyValue("--ink-rgb").trim().split(/\s+/).map(Number);
        if (rgb.length === 3 && rgb.every(Number.isFinite)) m.theme_color = m.background_color = "#" + rgb.map(n => n.toString(16).padStart(2, "0")).join("");
      } catch {}
      for (const k of ["id", "start_url", "scope"]) if (m[k]) m[k] = new URL(m[k], mu).href; // manifest tạo động phải dùng địa chỉ tuyệt đối
      (m.icons || []).forEach(i => { i.src = new URL(i.src, mu).href; });
      link.href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: "application/manifest+json" }));
    } catch (e) { console.warn("manifest", e); }
  })();
  // Bắt sự kiện cài đặt PWA sớm (có thể bắn trước khi người dùng bấm nút)
  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; });
  window.addEventListener("appinstalled", () => { deferredInstall = null; setAppStatus("Đã cài App lên thiết bị. Mở App từ màn hình chính/danh sách ứng dụng."); });
  const isStandalone = () => ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some(m => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true || document.referrer.startsWith("android-app://");
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const setAppStatus = s => { const el = document.getElementById("appStatus"); if (el) el.textContent = s; };
  const qp = new URLSearchParams(location.search);
  // Mặc định = App dành cho khách. Trang cài đặt (nút Tạo App) mở bằng ?admin=1
  const appMode = qp.get("admin") !== "1";
  let db, tours = [], selectedTourId = null, viewer = null, objectUrls = [];
  let busy = false;

  const openDB = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(TOUR_STORE)) d.createObjectStore(TOUR_STORE, { keyPath: "id" });
      if (!d.objectStoreNames.contains(IMAGE_STORE)) d.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      if (!d.objectStoreNames.contains(THUMB_STORE)) d.createObjectStore(THUMB_STORE, { keyPath: "id" });
      if (!d.objectStoreNames.contains(LANDING_STORE)) d.createObjectStore(LANDING_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const store = (name, mode="readonly") => db.transaction(name, mode).objectStore(name);
  const reqPromise = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const getAll = name => reqPromise(store(name).getAll());
  const put = (name, value) => reqPromise(store(name, "readwrite").put(value));
  const get = (name, id) => reqPromise(store(name).get(id));
  const del = (name, id) => reqPromise(store(name, "readwrite").delete(id));

  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
  const bytes = n => {
    if (!Number.isFinite(n)) return "—";
    const u = ["B","KB","MB","GB","TB"]; let i=0, v=n;
    while (v >= 1024 && i < u.length-1) { v /= 1024; i++; }
    return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
  };
  const setStatus = s => { const el = $("downloadStatus"); if (el) el.textContent = s; };
  const sceneKey = (tourId, sceneId) => `${tourId}::${sceneId}`;
  const imageKey = panoramaId => String(panoramaId);

  // The source JSON stores Google Drive file IDs in scenes[*].panorama.
  // All source images must be shared publicly or otherwise fetchable by wsrv.nl.
  function makeImageUrl(fileId) {
    const driveUrl = `${SRC.drive || "https://drive.google.com/uc?export=download&id="}${encodeURIComponent(fileId)}`;
    return `${SRC.proxy || "https://wsrv.nl/?url="}${encodeURIComponent(driveUrl)}`;
  }
  function normalizeTour(entry, config) {
    if (!config || !config.scenes || typeof config.scenes !== "object") {
      throw new Error(`File tour ${entry.file} không có thuộc tính scenes hợp lệ.`);
    }
    return {
      id: String(entry.id),
      title: String(entry.title || entry.name || entry.id),
      file: entry.file,
      config,
      updatedAt: Date.now()
    };
  }
  async function syncTours(onStep) {
    if (!navigator.onLine) {
      await loadLocalTours();
      setStatus("Đang offline: chỉ hiển thị các tour đã đồng bộ trước đó.");
      return;
    }
    setStatus("Đang đọc tours/index.json…");
    const response = await fetch(TOUR_INDEX_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Không đọc được tours/index.json (HTTP ${response.status}).`);
    const index = await response.json();
    if (!Array.isArray(index.tours)) throw new Error('tours/index.json phải có thuộc tính "tours" là một mảng.');
    let count = 0; const nTours = index.tours.length;
    onStep && onStep(0, nTours);
    for (const [order, entry] of index.tours.entries()) {
      if (!entry.id || !entry.file) continue;
      const url = new URL(`./tours/${entry.file}`, location.href).href;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`Không đọc được ${entry.file} (HTTP ${r.status}).`);
      const config = await r.json();
      const t = normalizeTour(entry, config); t.order = order;
      await put(TOUR_STORE, t);
      count++; onStep && onStep(count, nTours);
    }
    await loadLocalTours();
    setStatus(`Đã đồng bộ ${count} tour. Chọn tour rồi tải ảnh trước khi ngắt mạng.`);
  }
  function sortTours() { tours.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.title.localeCompare(b.title)); }
  async function loadLocalTours() {
    tours = await getAll(TOUR_STORE);
    sortTours();
    if (appMode) return;
    renderTours();
    if (selectedTourId && !tours.some(t => t.id === selectedTourId)) selectedTourId = null;
    if (!selectedTourId && tours.length) selectedTourId = tours[0].id;
    renderSelectedTour();
    await updateStorage();
  }
  function selectedTour() { return tours.find(t => t.id === selectedTourId) || null; }
  function sceneEntries(tour) {
    if (!tour?.config?.scenes) return [];
    return Object.entries(tour.config.scenes).map(([id, scene]) => ({ id, ...scene }));
  }
  async function imageForScene(scene) {
    if (!scene?.panorama) return null;
    return get(IMAGE_STORE, imageKey(scene.panorama));
  }
  async function renderTours() {
    const wrap = $("tourList");
    wrap.innerHTML = "";
    if (!tours.length) {
      wrap.innerHTML = '<div class="alert alert-info mb-0">Chưa có tour. Đưa file JSON vào thư mục tours và thêm mục vào tours/index.json, sau đó bấm “Đồng bộ tour”.</div>';
      return;
    }
    for (const tour of tours) {
      const scenes = sceneEntries(tour);
      let saved = 0;
      for (const scene of scenes) if (await imageForScene(scene)) saved++;
      const card = document.createElement("button");
      card.type = "button";
      card.className = `btn text-start tour-card ${tour.id === selectedTourId ? "active" : ""}`;
      card.innerHTML = `<div class="fw-semibold">${escapeHtml(tour.title)}</div>
        <div class="small-muted">${scenes.length} cảnh · ${saved}/${scenes.length} ảnh đã tải</div>`;
      card.addEventListener("click", async () => {
        selectedTourId = tour.id;
        renderTours();
        renderSelectedTour();
      });
      wrap.appendChild(card);
    }
  }
  async function renderSelectedTour() {
    const tour = selectedTour();
    $("selectedTourName").textContent = tour?.title || "Chưa chọn tour";
    const scenes = sceneEntries(tour);
    let saved = 0;
    for (const s of scenes) if (await imageForScene(s)) saved++;
    $("tourProgressText").textContent = tour ? `${saved}/${scenes.length} ảnh đã lưu · ${scenes.length} cảnh` : "—";
    $("downloadTour").disabled = !tour || busy;
    $("openTour").disabled = !tour || saved === 0;
    $("deleteTour").disabled = !tour || saved === 0 || busy;
    await renderScenes();
  }
  async function renderScenes() {
    const tour = selectedTour();
    const query = $("sceneSearch").value.trim().toLowerCase();
    const wrap = $("sceneList");
    wrap.innerHTML = "";
    if (!tour) return;
    const scenes = sceneEntries(tour).filter(s => s.id.toLowerCase().includes(query) || String(s.title || s.name || s.id).toLowerCase().includes(query));
    for (const scene of scenes) {
      const img = await imageForScene(scene);
      const label = scene.title || scene.name || scene.id;
      const row = document.createElement("div");
      row.className = "scene-row";
      row.innerHTML = `<div class="fw-semibold">${escapeHtml(label)}</div>
        <div class="small-muted"><span class="status-dot ${img ? "ok" : "bad"}"></span>${img ? `Đã tải · ${bytes(img.blob.size)}` : "Chưa tải ảnh"}</div>`;
      wrap.appendChild(row);
    }
  }
  async function downloadTour() {
    const tour = selectedTour();
    if (!tour || busy) return;
    if (!navigator.onLine) { setStatus("Đang offline. Cần kết nối Internet để tải ảnh còn thiếu."); return; }
    busy = true;
    $("downloadTour").disabled = true;
    $("downloadProgressWrap").classList.remove("d-none");
    const scenes = sceneEntries(tour);
    let success = 0, failed = [];
    for (let i=0; i<scenes.length; i++) {
      const scene = scenes[i];
      const id = imageKey(scene.panorama);
      const already = await get(IMAGE_STORE, id);
      if (already?.blob) { success++; }
      else {
        setStatus(`Đang tải ảnh ${i+1}/${scenes.length}: ${scene.id}`);
        try {
          const url = makeImageUrl(scene.panorama);
          const r = await fetch(url, { mode:"cors", cache:"no-store" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const blob = await r.blob();
          if (!blob.size || (!blob.type.startsWith("image/"))) {
            throw new Error(`Nguồn không trả về ảnh hợp lệ (${blob.type || "không rõ kiểu dữ liệu"}).`);
          }
          await put(IMAGE_STORE, { id, panoramaId: scene.panorama, blob, mimeType: blob.type, size: blob.size, downloadedAt: Date.now() });
          success++;
        } catch (e) {
          failed.push(`${scene.id}: ${e.message}`);
        }
      }
      const pct = Math.round((i+1)/scenes.length*100);
      $("downloadProgress").style.width = `${pct}%`;
      $("downloadProgress").textContent = `${pct}%`;
      await updateStorage();
      await renderScenes();
    }
    busy = false;
    await renderSelectedTour();
    await renderTours();
    setStatus(`Hoàn tất tour "${tour.title}": ${success}/${scenes.length} ảnh có trên máy.` +
      (failed.length ? ` Lỗi ${failed.length} ảnh: ${failed.slice(0,3).join(" | ")}${failed.length>3?"…":""}` : ""));
  }
  async function deleteTourImages() {
    const tour = selectedTour();
    if (!tour || !confirm(`Xóa ảnh đã tải của tour "${tour.title}"? Ảnh dùng chung với tour khác cũng có thể bị ảnh hưởng nếu dùng cùng ID.`)) return;
    for (const scene of sceneEntries(tour)) {
      // IDs may be shared across tours. Remove only if no other downloaded tour references it.
      const pid = imageKey(scene.panorama);
      const referencedElsewhere = tours.some(other => other.id !== tour.id && sceneEntries(other).some(s => imageKey(s.panorama) === pid));
      if (!referencedElsewhere) { await del(IMAGE_STORE, pid); await del(THUMB_STORE, pid); }
    }
    await renderSelectedTour();
    await renderTours();
    await updateStorage();
    setStatus("Đã xóa ảnh không còn được tham chiếu bởi tour khác.");
  }
  function destroyViewer() {
    if (viewer?.destroy) { try { viewer.destroy(); } catch {} }
    viewer = null;
    objectUrls.forEach(URL.revokeObjectURL);
    objectUrls = [];
  }
  async function openTour() {
    const tour = selectedTour();
    if (!tour) return;
    destroyViewer(); // phải hủy viewer cũ TRƯỚC khi tạo blob URL mới (nếu không sẽ revoke luôn URL vừa tạo)
    const config = JSON.parse(JSON.stringify(tour.config));
    const originalScenes = config.scenes || {};
    for (const [sceneId, scene] of Object.entries(originalScenes)) {
      const image = await get(IMAGE_STORE, imageKey(scene.panorama));
      if (!image?.blob) {
        // Keep hotspot structure, but mark this scene unavailable in UI if not downloaded.
        scene.panorama = "";
        continue;
      }
      const url = URL.createObjectURL(image.blob);
      objectUrls.push(url);
      scene.panorama = url;
      scene.type = "equirectangular";
    }
    const first = config.default?.firstScene || Object.keys(originalScenes)[0];
    if (!config.scenes[first]?.panorama) {
      alert("Cảnh bắt đầu chưa được tải. Hãy tải ảnh của cảnh đó trước.");
      destroyViewer();
      return;
    }
    $("viewerMessage").textContent = `${tour.title} — đang chạy từ dữ liệu cục bộ (app ${APP_VERSION})`;
    $("backToTour").disabled = false;
    // Keep Panellum's multi-scene config and hotspot coordinates from the original JSON.
    viewer = pannellum.viewer("panorama", {
      default: config.default || {},
      scenes: config.scenes,
      sceneFadeDuration: 500
    });
    // Disable scene hotspots whose target image is not stored locally.
    viewer.on("error", msg => console.error("Pannellum error:", msg));
    viewer.on("load", () => {
      // Panellum itself uses the original hotspot sceneId; scenes without a local panorama are not usable.
      // The downloader downloads all scenes in the selected tour, so this only matters after partial failure.
    });
  }
  // ====== TẠO APP: tải toàn bộ ảnh của mọi tour + cài PWA ======
  let creatingApp = false;
  function uniquePanoramas() {
    const map = new Map();
    for (const t of tours) for (const s of sceneEntries(t)) {
      if (s.panorama && !map.has(imageKey(s.panorama))) map.set(imageKey(s.panorama), { id: imageKey(s.panorama), panorama: s.panorama, name: s.id, tour: t.title });
    }
    return [...map.values()];
  }
  // Tải một ảnh; onFrac(0..1) báo tiến độ theo từng phần ảnh (khi máy chủ cho biết dung lượng) để thanh tiến trình chạy mượt
  async function fetchImageBlob(url, onFrac) {
    const r = await fetch(url, { mode: "cors", cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const total = +r.headers.get("content-length") || 0;
    let blob;
    if (onFrac && total && r.body?.getReader) {
      const rd = r.body.getReader(), parts = []; let got = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onFrac(Math.min(0.98, got / total)); }
      blob = new Blob(parts, { type: r.headers.get("content-type") || "" });
    } else blob = await r.blob();
    if (!blob.size || !blob.type.startsWith("image/")) throw new Error(`không phải ảnh (${blob.type || "không rõ"})`);
    return blob;
  }
  async function fetchPanoramaWithRetry(item, tries = 3, onFrac) {
    let lastErr;
    for (let k = 1; k <= tries; k++) {
      try {
        const blob = await fetchImageBlob(makeImageUrl(item.panorama), onFrac);
        await put(IMAGE_STORE, { id: item.id, panoramaId: item.panorama, blob, mimeType: blob.type, size: blob.size, downloadedAt: Date.now() });
        return blob.size;
      } catch (e) {
        lastErr = e;
        if (k < tries) await new Promise(res => setTimeout(res, 800 * k));
      }
    }
    throw lastErr;
  }
  async function downloadAllImages(onTick) {
    const all = uniquePanoramas(), todo = [];
    for (const it of all) if (!(await get(IMAGE_STORE, it.id))?.blob) todo.push(it);
    const total = todo.length, failed = [];
    let done = 0, bytesDone = 0, next = 0;
    const tick = () => onTick && onTick({ done, total, bytesDone, failed });
    tick();
    const worker = async () => {
      while (next < todo.length) {
        const it = todo[next++];
        try { bytesDone += await fetchPanoramaWithRetry(it); }
        catch (e) { failed.push(`${it.name}: ${e.message}`); }
        done++; tick();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return { all, total, failed };
  }

  // ===== Bảo đảm chạy offline 100%: tải đủ -> tự thử lại -> kiểm tra từng tệp =====
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const SHELL_URLS = ["./", "./index.html", "./app.js" + V, "./theme.css" + V, "./config.js" + V, "./app.css" + V, "./vendor/bootstrap.min.css", "./vendor/bootstrap.bundle.min.js", "./vendor/pannellum.css", "./vendor/pannellum.js", "./manifest.json", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./tours/index.json", "./fonts/be-vietnam-pro-latin-400-normal.woff2", "./fonts/be-vietnam-pro-latin-500-normal.woff2", "./fonts/be-vietnam-pro-latin-ext-400-normal.woff2", "./fonts/be-vietnam-pro-latin-ext-500-normal.woff2", "./fonts/be-vietnam-pro-vietnamese-400-normal.woff2", "./fonts/be-vietnam-pro-vietnamese-500-normal.woff2", "./fonts/cormorant-garamond-latin-600-normal.woff2", "./fonts/cormorant-garamond-latin-ext-600-normal.woff2", "./fonts/cormorant-garamond-vietnamese-600-normal.woff2"];
  const LIB_PAIRS = [["./vendor/bootstrap.min.css", "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"], ["./vendor/bootstrap.bundle.min.js", "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"], ["./vendor/pannellum.css", "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css"], ["./vendor/pannellum.js", "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js"]];
  async function panoMissing() {
    const have = await haveKeys();
    return uniquePanoramas().filter(it => !have.has(it.id));
  }
  // Tải toàn bộ ảnh 360° + ảnh giới thiệu/bóc mái/carousel. Ảnh lỗi được tự tải lại tối đa 4 lượt.
  async function downloadEverything(onProgress, doSync = true) {
    if (doSync) await syncTours();
    let pass = 1;
    for (; pass <= 4; pass++) {
      await downloadAllImages(p => onProgress && onProgress({ ...p, label: "ảnh 360°", pass }));
      await downloadLanding(p => onProgress && onProgress({ ...p, label: "ảnh giới thiệu", pass }));
      const pm = await panoMissing(), lm = await landingMissing();
      if (!pm.length && !lm.todo.length) return { failed: [], pass };
      if (!navigator.onLine || pass === 4) break;
      await sleep(1500 * pass);
    }
    const pm = await panoMissing(), lm = await landingMissing();
    return { failed: [...pm.map(it => `${it.name} (${it.tour})`), ...lm.todo.map(() => "ảnh giới thiệu")], pass };
  }
  // Đảm bảo mọi tệp giao diện (JS, CSS, font, icon, thư viện) nằm trong bộ nhớ offline. Tệp thiếu sẽ được tải bổ sung.
  async function ensureShell() {
    const missing = [];
    const cache = await caches.open(SHELL_CACHE), cdn = await caches.open(CDN_CACHE);
    const libVendor = new Set(LIB_PAIRS.map(p => p[0]));
    for (const u of SHELL_URLS) {
      if (await cache.match(u)) continue;
      try { const r = await fetch(new Request(u, { cache: "reload" })); if (!r.ok) throw new Error("HTTP " + r.status); await cache.put(u, r); }
      catch (e) { if (!libVendor.has(u)) missing.push(u); }
    }
    for (const [v, c] of LIB_PAIRS) {
      if ((await cache.match(v)) || (await cdn.match(c))) continue;
      try { const r = await fetch(c, { mode: "cors" }); if (!r.ok) throw new Error("HTTP " + r.status); await cdn.put(c, r); }
      catch (e) { missing.push(v.replace("./vendor/", "thư viện ")); }
    }
    return { missing, total: SHELL_URLS.length };
  }
  async function refreshAppButton() {
    const btn = $("createApp");
    if (!btn || creatingApp) return;
    const list = uniquePanoramas();
    let have = 0;
    for (const it of list) if ((await get(IMAGE_STORE, it.id))?.blob) have++;
    const lm = await landingMissing();
    if (list.length && have === list.length && !lm.todo.length) {
      btn.textContent = isStandalone() ? "⟳ Cập nhật App" : "✔ App đã sẵn sàng — Cài / cập nhật";
      $("appHint").textContent = `Đã có đủ ${have}/${list.length} ảnh 360° của ${tours.length} tour và ${lm.all.length} ảnh giới thiệu trên máy.`;
    } else if (list.length) {
      btn.textContent = "⬇ Tạo App";
      $("appHint").textContent = `Mới có ${have}/${list.length} ảnh 360° của ${tours.length} tour${lm.todo.length ? ` (còn ${lm.todo.length} ảnh giới thiệu)` : ""}. Bấm để tải phần còn lại và cài ứng dụng.`;
    }
  }
  async function installApp() {
    if (isStandalone()) return "Đang chạy trong App — không cần cài thêm.";
    if (deferredInstall) {
      const ev = deferredInstall; deferredInstall = null;
      ev.prompt();
      const choice = await ev.userChoice;
      return choice.outcome === "accepted" ? "Đã chấp nhận cài App." : "Anh đã từ chối cài App (có thể bấm Tạo App lần nữa).";
    }
    if (isIOS()) return "iPhone/iPad: bấm nút Chia sẻ của Safari → \"Thêm vào Màn hình chính\". Lưu ý App trên màn hình chính có bộ nhớ riêng: hãy mở App đó rồi bấm Tạo App để tải ảnh lại.";
    return "Nếu trình duyệt không tự hiện hộp thoại cài: mở menu ⋮ → \"Cài đặt ứng dụng\" / \"Thêm vào màn hình chính\" (máy tính: biểu tượng cài đặt ở cuối thanh địa chỉ).";
  }
  async function createApp() {
    if (creatingApp) return;
    if (!navigator.onLine) { setAppStatus("Đang offline. Cần Internet để tải ảnh và tạo App."); return; }
    creatingApp = true;
    const btn = $("createApp");
    btn.disabled = true;
    $("appProgressWrap").classList.remove("d-none");
    const bar = $("appProgress");
    const setPct = p => { bar.style.width = `${p}%`; bar.textContent = `${p}%`; };
    let wake = null;
    try {
      // 1) Cài App ngay khi còn thao tác người dùng (trình duyệt chỉ cho hiện hộp thoại cài trong vài giây sau khi bấm)
      let installMsg = "";
      if (!isStandalone() && deferredInstall) installMsg = await installApp();
      // 2) Đồng bộ danh sách tour
      setPct(0); setAppStatus("Đang đồng bộ danh sách tour…");
      await syncTours();
      try { await navigator.storage?.persist?.(); } catch {}
      try { wake = await navigator.wakeLock?.request?.("screen"); } catch {}
      // 3) Tải TOÀN BỘ ảnh (360°, giới thiệu, bóc mái, carousel); ảnh lỗi tự thử lại tối đa 4 lượt
      setPct(0);
      const dl = await downloadEverything(p => {
        setPct(p.total ? Math.round(p.done / p.total * 100) : 100);
        setAppStatus(`Đang tải ${p.label} ${p.done}/${p.total} · ${bytes(p.bytesDone)}${p.pass > 1 ? ` · thử lại lượt ${p.pass}` : ""}`);
      }, false);
      setPct(100); setAppStatus("Đang tạo ảnh xem trước cho App…");
      await ensureThumbs();
      await renderTours(); await renderSelectedTour(); await updateStorage();
      // 4) Bảo đảm ứng dụng (Service Worker + mọi tệp giao diện) đã nằm trong bộ nhớ offline
      setAppStatus("Đang kiểm tra bộ nhớ offline của ứng dụng…");
      let swNote = "", swActive = false, sh = { missing: [], total: SHELL_URLS.length };
      try {
        // serviceWorker.ready không bao giờ resolve nếu sw.js chưa đăng ký/cài được -> giới hạn 6 giây để không treo
        const timeout = new Promise(r => setTimeout(() => r(null), 6000));
        let reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
        if (!reg) {
          try { reg = await navigator.serviceWorker.register("./sw.js" + V); swNote = " (Service Worker đang cài đặt)"; }
          catch (e) { swNote = ` (không đăng ký được sw.js: ${e.message})`; }
        }
        swActive = !!(reg && reg.active);
        sh = await ensureShell();
      } catch (e) { swNote = ` (${e && e.message ? e.message : e})`; }
      const pTotal = uniquePanoramas().length, pHave = pTotal - (await panoMissing()).length;
      const lAll = landingList().length, lHave = lAll - (await landingMissing()).todo.length;
      const complete = pHave === pTotal && lHave === lAll && !sh.missing.length;
      let msg;
      if (complete) {
        msg = `Hoàn tất 100%: ${pHave}/${pTotal} ảnh 360° của ${tours.length} tour · ${lHave}/${lAll} ảnh giới thiệu, bóc mái, tiện ích · đủ ${sh.total} tệp giao diện. ` +
          (swActive ? "Ứng dụng đã sẵn sàng chạy hoàn toàn offline." : `Hãy tải lại trang một lần khi còn mạng để kích hoạt chế độ offline${swNote}.`);
      } else {
        const parts = [];
        if (pHave < pTotal) parts.push(`${pTotal - pHave} ảnh 360°`);
        if (lHave < lAll) parts.push(`${lAll - lHave} ảnh giới thiệu`);
        if (sh.missing.length) parts.push(`${sh.missing.length} tệp giao diện (${sh.missing.slice(0, 3).join(", ")}${sh.missing.length > 3 ? "…" : ""})`);
        msg = `CHƯA đủ 100% — còn thiếu ${parts.join(", ")}. Bấm lại để tải tiếp phần còn thiếu.`;
      }
      if (complete && !isStandalone() && !installMsg) installMsg = await installApp();
      setAppStatus(`${msg}${installMsg ? " " + installMsg : ""}`);
      bar.classList.remove("progress-bar-animated");
    } catch (e) {
      setAppStatus(`Tạo App thất bại: ${e.message}`);
    } finally {
      try { await wake?.release?.(); } catch {}
      creatingApp = false;
      btn.disabled = false;
      await refreshAppButton();
    }
  }
  async function updateStorage() {
    const images = await getAll(IMAGE_STORE);
    const lands = await getAll(LANDING_STORE);
    const total = images.reduce((n, x) => n + (x.blob?.size || 0), 0) + lands.reduce((n, x) => n + (x.blob?.size || 0), 0);
    let text = `${images.length} ảnh 360° + ${lands.length} ảnh giới thiệu · ${bytes(total)}`;
    let pct = 0;
    if (navigator.storage?.estimate) {
      try {
        const e = await navigator.storage.estimate();
        text += ` · quota ${bytes(e.quota || 0)} · đã dùng ${bytes(e.usage || 0)}`;
        if (e.quota) pct = Math.min(100, Math.round((e.usage || 0) / e.quota * 100));
      } catch {}
    }
    $("storageText").textContent = text;
    $("storageBar").style.width = `${pct}%`;
    if (navigator.storage?.persist) { try { await navigator.storage.persist(); } catch {} }
  }
  async function prepareCdnCache() {
    const urls = [
      "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
      "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
      "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css",
      "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js"
    ];
    const cache = await caches.open(CDN_CACHE);
    const errors = [];
    for (const url of urls) {
      try {
        const r = await fetch(url, { mode:"cors", cache:"reload" });
        if (!r.ok || r.type === "opaque") throw new Error(`HTTP ${r.status || "opaque"}`);
        await cache.put(url, r.clone());
      } catch (e) { errors.push(`${url}: ${e.message}`); }
    }
    if (errors.length) alert("Chưa cache đủ thư viện CDN. Cần kiểm tra mạng hoặc đóng gói thư viện vào cùng hosting.\n" + errors.join("\n"));
    else alert("Đã tải thư viện CDN để chuẩn bị offline. Hãy bật chế độ máy bay và kiểm tra lại.");
  }
  function updateNetwork() {
    $("netStatus").innerHTML = navigator.onLine ? '<span class="status-dot ok"></span>Online' : '<span class="status-dot"></span>Offline';
  }
  // ====== GIAO DIỆN APP DÀNH CHO KHÁCH HÀNG ======
  const thumbUrls = new Map();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const prettyName = id => String(id).replace(/_/g, " ");
  const tourById = id => tours.find(t => t.id === id) || null;
  const firstSceneId = t => {
    const f = t.config.default?.firstScene;
    return (f && t.config.scenes[f]) ? f : Object.keys(t.config.scenes)[0];
  };
  const haveKeys = async () => new Set((await reqPromise(store(IMAGE_STORE).getAllKeys())).map(String));
  let thumbBusy = false, thumbAgain = false;
  const thumbRemote = pid => `${makeImageUrl(pid)}&w=480&h=300&fit=cover&a=center&output=jpg&q=70`;
  // Ảnh nào dùng được ngay: đã lưu trong máy, hoặc (khi có mạng) tải được qua mạng
  const availKeys = async () => { const s = await haveKeys(); if (navigator.onLine) for (const it of uniquePanoramas()) s.add(it.id); return s; };

  async function thumbUrlFor(panoramaId) {
    const k = imageKey(panoramaId);
    if (thumbUrls.has(k)) return thumbUrls.get(k);
    const rec = await get(THUMB_STORE, k);
    if (!rec?.blob) return navigator.onLine ? thumbRemote(panoramaId) : null; // bản online: xin ảnh nhỏ đã thu nhỏ sẵn, không tải ảnh 360° gốc
    const u = URL.createObjectURL(rec.blob);
    thumbUrls.set(k, u);
    return u;
  }
  async function makeThumbBlob(blob) {
    const W = 480, H = 300;
    let bmp;
    try { bmp = await createImageBitmap(blob); }
    catch {
      bmp = await new Promise((res, rej) => {
        const img = new Image(), u = URL.createObjectURL(blob);
        img.onload = () => { URL.revokeObjectURL(u); res(img); };
        img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("không đọc được ảnh")); };
        img.src = u;
      });
    }
    const w = bmp.width, h = bmp.height;
    const sw = Math.round(w / 3), sh = Math.min(h, Math.round(sw / 1.6));
    const sx = Math.round((w - sw) / 2), sy = Math.round((h - sh) / 2);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    cv.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
    bmp.close?.();
    return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("toBlob")), "image/jpeg", 0.8));
  }
  // Tạo ảnh xem trước (thumbnail) tuần tự để không tốn RAM; ảnh đầu mỗi tour được làm trước.
  async function ensureThumbs(onEach, onStep) {
    if (thumbBusy) { thumbAgain = true; return; }
    thumbBusy = true;
    try {
      const order = [], seen = new Set();
      const push = id => { const k = imageKey(id); if (id && !seen.has(k)) { seen.add(k); order.push(k); } };
      tours.forEach(t => { const f = firstSceneId(t); if (f) push(t.config.scenes[f].panorama); });
      tours.forEach(t => Object.values(t.config.scenes).forEach(s => push(s.panorama)));
      let n = 0;
      for (const k of order) {
        if (await get(THUMB_STORE, k)) continue;
        onStep && onStep();
        const img = await get(IMAGE_STORE, k);
        if (!img?.blob) continue;
        try { await put(THUMB_STORE, { id: k, blob: await makeThumbBlob(img.blob) }); }
        catch (e) { console.warn("thumb", k, e); continue; }
        if (onEach && ++n % 3 === 0) onEach();
      }
      onEach && onEach();
    } finally { thumbBusy = false; }
    if (thumbAgain) { thumbAgain = false; await ensureThumbs(onEach); }
  }
  async function applyThumbs() {
    for (const el of document.querySelectorAll("#tourBox [data-pid]")) {
      if (el.dataset.done) continue;
      const u = await thumbUrlFor(el.dataset.pid);
      if (u) { el.style.backgroundImage = `url("${u}")`; el.classList.remove("ph"); el.dataset.done = "1"; }
    }
  }
  const showToast = (msg, ms) => {
    const el = $("apToast"); if (!el) return;
    el.textContent = msg; el.classList.toggle("show", !!msg);
    clearTimeout(showToast.t);
    if (msg && ms) showToast.t = setTimeout(() => el.classList.remove("show"), ms);
  };

  // ----- Section "Tham quan": nội dung của chương trình (danh sách tour → danh sách cảnh) -----
  // Chạm vào một tour là chạy tour đó ngay (danh sách cảnh đã có sẵn trong khung xem 360°: nút "Danh sách cảnh")
  async function renderTourBox() {
    const box = $("tourBox"); if (!box) return;
    const have = await availKeys();
    box.innerHTML = tours.length ? `<div class="ap-grid">${tours.map(t => {
      const sc = t.config.scenes[firstSceneId(t)];
      const ids = Object.values(t.config.scenes).map(x => imageKey(x.panorama));
      const avail = ids.filter(k => have.has(k)).length;
      return `<button class="ap-card" data-tour="${esc(t.id)}" ${avail ? "" : "disabled"}>
        <div class="ap-thumb ph" data-pid="${esc(sc?.panorama ?? "")}"></div>
        <div class="ap-card-body"><h3>${esc(t.title)}</h3><span>${ids.length} cảnh${avail < ids.length ? ` · ${ids.length - avail} chưa tải` : ""}</span></div>
      </button>`;
    }).join("")}</div>` : '<p class="ap-empty">Chưa có tour nào.</p>';
    applyThumbs();
  }
  // Cảnh mở đầu của tour: cảnh khai báo firstScene nếu đã tải ảnh, nếu chưa thì lấy cảnh đầu tiên đã có ảnh
  async function startSceneId(t) {
    const have = await availKeys(), ok = sid => have.has(imageKey(t.config.scenes[sid].panorama));
    const f = firstSceneId(t);
    return ok(f) ? f : Object.keys(t.config.scenes).find(ok) || null;
  }

  // ----- Modal 360° toàn màn hình. Mở = pushState, nên phím BACK của điện thoại sẽ đóng modal -----
  let modal = null, modalOpen = false, wantOpen = false, pendingViewer = null;
  const cleanUrl = () => location.pathname + location.search;
  const viewerHash = (tid, sid) => `#/t/${encodeURIComponent(tid)}/s/${encodeURIComponent(sid)}`;
  function viewerRoute() {
    const p = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    return p[0] === "t" && p[2] === "s" ? { tour: p[1], scene: p[3] } : null;
  }
  function openViewer(tourId, sceneId) {
    history.pushState({ viewer: 1 }, "", cleanUrl() + viewerHash(tourId, sceneId));
    route();
  }
  function closeViewer() { // nút X
    if (history.state?.viewer) history.back(); // -> popstate -> route() -> hideViewer()
    else { if (viewerRoute()) history.replaceState(null, "", cleanUrl()); hideViewer(); }
  }
  function route() {
    const r = viewerRoute(), t = r && tourById(r.tour);
    if (t && t.config.scenes[r.scene]) { if (!wantOpen) showViewer(t, r.scene); }
    else hideViewer();
  }
  function hideViewer() {
    wantOpen = false;
    if (modal && $("viewerModal").classList.contains("show")) modal.hide();
    else if (!modalOpen) { pendingViewer = null; destroyViewer(); }
  }
  // Bản online: ảnh 360° của tour đang xem chỉ giữ trong phiên (không lưu vào máy), mở tour khác thì bỏ ảnh tour cũ
  const sessionBlobs = new Map();
  async function loadTourOnline(tour, need) {
    const prog = makeProgress(p => SP.bar(p, `Đang tải ${tour.title}… ${p}%`));
    SP.open("Đang tải tour", ""); SP.bar(0, `Đang tải ${tour.title}… 0%`);
    const fr = new Map(need.map(k => [k, 0]));
    const update = () => prog.set([...fr.values()].reduce((a, b) => a + b, 0) / need.length * 100);
    const attempt = async list => {
      let i = 0;
      const w = async () => { while (i < list.length && wantOpen) {
        const k = list[i++];
        try { sessionBlobs.set(k, await fetchImageBlob(makeImageUrl(k), f => { if (f > fr.get(k)) { fr.set(k, f); update(); } })); fr.set(k, 1); update(); } catch {}
      } };
      await Promise.all([w(), w(), w()]);
    };
    for (;;) {
      for (let pass = 1; pass <= 2; pass++) { const left = need.filter(k => !sessionBlobs.has(k)); if (!left.length || !wantOpen) break; await attempt(left); }
      if (!wantOpen) { SP.close(); return false; }
      const left = need.filter(k => !sessionBlobs.has(k));
      if (!left.length) { prog.set(100); await sleep(250); SP.close(); return true; }
      const c = await new Promise(res => SP.problem(`Chưa tải được ${left.length}/${need.length} ảnh của tour. Kiểm tra mạng rồi bấm Thử lại.`, { retry: () => res("retry"), skip: () => res("skip"), skipLabel: "Đóng" }));
      if (c === "skip") { SP.close(); return false; }
      SP.working();
    }
  }
  async function showViewer(tour, sceneId) {
    wantOpen = true;
    destroyViewer();
    const cfg = JSON.parse(JSON.stringify(tour.config));
    const have = await haveKeys();
    const keys = new Set(Object.values(cfg.scenes).map(sc => imageKey(sc.panorama)));
    for (const k of [...sessionBlobs.keys()]) if (!keys.has(k)) sessionBlobs.delete(k);
    const need = [...keys].filter(k => !have.has(k) && !sessionBlobs.has(k));
    if (need.length && navigator.onLine) { // còn ảnh chưa có trong máy: tải cả tour một lần, thanh tiến trình chạy 0→100%
      const ok = await loadTourOnline(tour, need);
      if (!ok) { if (wantOpen) { wantOpen = false; showToast("Chưa tải được tour.", 3000); closeViewer(); } return; }
    }
    const scenes = {};
    for (const [sid, sc] of Object.entries(cfg.scenes)) {
      const k = imageKey(sc.panorama);
      const blob = have.has(k) ? (await get(IMAGE_STORE, k))?.blob : sessionBlobs.get(k);
      if (!blob) continue;
      const u = URL.createObjectURL(blob);
      objectUrls.push(u);
      sc.panorama = u; sc.type = "equirectangular";
      scenes[sid] = sc;
    }
    if (!scenes[sceneId]) { wantOpen = false; showToast("Cảnh này chưa được tải về.", 3000); return closeViewer(); }
    // Bỏ các điểm nóng trỏ tới cảnh chưa có ảnh để tránh lỗi
    for (const sc of Object.values(scenes)) sc.hotSpots = (sc.hotSpots || []).filter(h => h.type !== "scene" || scenes[h.sceneId]);
    if (!wantOpen) { destroyViewer(); return; } // khách đã bấm Back trong lúc đang nạp ảnh
    pendingViewer = { tour, sceneId, scenes, cfg };
    if (modalOpen) createViewer(); else modal.show();
  }
  function createViewer() {
    const p = pendingViewer; if (!p) return;
    viewer = pannellum.viewer("appPanorama", {
      default: { ...(p.cfg.default || {}), firstScene: p.sceneId },
      scenes: p.scenes,
      sceneFadeDuration: 500,
      showZoomCtrl: false,
      showFullscreenCtrl: false
    });
    viewer.on("scenechange", id => {
      history.replaceState(history.state, "", cleanUrl() + viewerHash(p.tour.id, id));
      markCurrentScene(id);
    });
    buildSceneDrawer(p);
  }

  // ----- Danh sách cảnh trong khung xem 360: chạm để nhảy thẳng tới cảnh bất kỳ trong tour -----
  function setDrawer(open) {
    const m = $("viewerModal");
    m.classList.toggle("drawer-open", open);
    $("avDrawer").setAttribute("aria-hidden", String(!open));
    $("avScenes").setAttribute("aria-expanded", String(open));
    if (open) $("avSceneList").querySelector(".on")?.scrollIntoView({ block: "center" });
  }
  function markCurrentScene(id) {
    $("avCurrent").textContent = prettyName(id);
    $("avSceneList").querySelectorAll(".ap-scene").forEach(b => {
      const on = b.dataset.go === id;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
  }
  function buildSceneDrawer(p) {
    $("avTourName").textContent = p.tour.title;
    const ids = Object.keys(p.scenes);
    $("avSceneList").innerHTML = ids.map(sid => `<button type="button" class="ap-scene" data-go="${esc(sid)}"><i class="ph" data-pid="${esc(p.tour.config.scenes[sid].panorama)}"></i><span>${esc(prettyName(sid))}</span></button>`).join("");
    (async () => {
      for (const el of $("avSceneList").querySelectorAll("[data-pid]")) {
        const u = await thumbUrlFor(el.dataset.pid);
        if (u) el.style.backgroundImage = `url("${u}")`;
      }
    })();
    markCurrentScene(viewer?.getScene?.() || p.sceneId);
    setDrawer(false);
  }
  function initSceneDrawer() {
    $("avScenes").addEventListener("click", () => setDrawer(!$("viewerModal").classList.contains("drawer-open")));
    $("avDrawerClose").addEventListener("click", () => setDrawer(false));
    $("avBackdrop").addEventListener("click", () => setDrawer(false));
    $("avSceneList").addEventListener("click", e => {
      const b = e.target.closest("[data-go]"); if (!b || !viewer) return;
      const id = b.dataset.go;
      if (viewer.getScene() !== id) viewer.loadScene(id); // 'scenechange' sẽ cập nhật mục đang chọn + địa chỉ
      setDrawer(false);
    });
  }

  // ----- Trang giới thiệu (hero, menu sticky, các section) -----
  // ===== Dữ liệu ảnh giới thiệu / carousel / bóc mái nằm trong config.js (anh, carousels, bocMai, nguonAnh) =====
  const LANDING = CFG.anh || {};
  const ZOOM_W = SRC.chieuRongPhongTo || 2400;                 // chiều rộng tối đa của ảnh có thể phóng to (khi không giữ kích thước gốc)
  const ALL_ORIGINAL_SIZE = SRC.giuKichThuocGoc !== false;     // true = mọi ảnh tải đúng kích thước gốc
  const ORIGINAL_SIZE = new Set(SRC.giuGoc || []);             // khi ALL_ORIGINAL_SIZE = false: chỉ các khóa này giữ kích thước gốc
  const landingUrl = (k, w, h, hi) => !LANDING[k] ? `https://picsum.photos/seed/${k}/${w}/${h}`
    : (ALL_ORIGINAL_SIZE || ORIGINAL_SIZE.has(k)) ? `${makeImageUrl(LANDING[k])}&q=95&output=webp`
    : `${makeImageUrl(LANDING[k])}&w=${hi ? ZOOM_W : w}&we&q=${hi ? 90 : 80}&output=webp`;

  const CAROUSELS = { ...(CFG.carousels || {}) }; // nội dung các carousel: sửa trong config.js
  function initCarousels() {
    document.querySelectorAll("#appRoot .cx[data-cx]").forEach(box => {
      const cfg = CAROUSELS[box.dataset.cx]; if (!cfg || !cfg.items.length) return;
      box.innerHTML = ""; 
      if (cfg.tieude) { const h = document.createElement("h3"); h.className = "sub"; h.textContent = cfg.tieude; box.appendChild(h); }
      const wrap = document.createElement("div"); wrap.className = "cx-wrap";
      const track = document.createElement("div"); track.className = "cx-track"; track.tabIndex = 0;
      track.setAttribute("aria-label", cfg.tieude || "Carousel");
      const dots = document.createElement("div"); dots.className = "cx-dots";
      cfg.items.forEach((it, i) => {
        const s = document.createElement("article"); s.className = "cx-slide";
        const label = it.ten || `${cfg.alt || "Ảnh"} ${i + 1}`; // carousel chỉ có ảnh: tên đọc cho người khiếm thị lấy từ cfg.alt
        const img = document.createElement("img"); img.className = "photo"; img.alt = label;
        if (it.url) img.dataset.lurl = it.url; else { img.dataset.img = it.key; img.dataset.w = 1000; img.dataset.h = 750; }
        img.loading = i ? "lazy" : "eager";
        img.style.aspectRatio = cfg.ratio || "4 / 3"; if (cfg.fit) img.style.objectFit = cfg.fit; img.dataset.zoom = ""; // cho phép phóng to; giữ đúng tỉ lệ 4:3 khi bọc khung zoom
        const b = document.createElement("div"); b.className = "cx-body";
        if (it.tag) { const t = document.createElement("small"); t.className = "tag"; t.textContent = it.tag; b.appendChild(t); }
        if (it.ten) { const h = document.createElement("h3"); h.textContent = it.ten; b.appendChild(h); }
        if (it.mota) { const p = document.createElement("p"); p.className = "muted"; p.textContent = it.mota; b.appendChild(p); }
        if (b.childNodes.length) s.append(b, img); else s.append(img); // thông tin nằm trên ảnh (không có chữ thì chỉ hiện ảnh)
        track.appendChild(s);
        const d = document.createElement("button"); d.type = "button"; d.className = "cx-dot"; d.setAttribute("aria-label", `Mục ${i + 1}: ${label}`);
        d.addEventListener("click", () => track.scrollTo({ left: s.offsetLeft - track.offsetLeft, behavior: "smooth" }));
        dots.appendChild(d);
      });
      const mk = (cls, dir, label, path) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "cx-nav " + cls; b.setAttribute("aria-label", label);
        b.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
        b.addEventListener("click", () => track.scrollBy({ left: dir * track.clientWidth, behavior: "smooth" }));
        return b;
      };
      wrap.append(track, mk("prev", -1, "Mục trước", "M15 5l-7 7 7 7"), mk("next", 1, "Mục sau", "M9 5l7 7-7 7"));
      box.append(wrap, dots);
      const upd = () => {
        const w = track.firstElementChild.offsetWidth || 1, i = Math.min(cfg.items.length - 1, Math.round(track.scrollLeft / w));
        [...dots.children].forEach((d, k) => d.classList.toggle("on", k === i));
      };
      track.addEventListener("scroll", () => requestAnimationFrame(upd), { passive: true }); upd();
      // Các phần thông tin cao bằng nhau để ảnh các slide thẳng hàng; mũi tên canh giữa theo ảnh (biến --bh)
      const sync = () => {
        if (!track.clientWidth) return;
        const bs = [...track.querySelectorAll(".cx-body")]; bs.forEach(b => { b.style.minHeight = "0"; });
        const m = bs.length ? Math.max(...bs.map(b => b.offsetHeight)) : 0; bs.forEach(b => { b.style.minHeight = m + "px"; });
        box.style.setProperty("--bh", m + "px");
      };
      sync(); window.addEventListener("resize", sync);
      if (window.ResizeObserver) new ResizeObserver(sync).observe(track); // chạy lại khi tab chứa carousel được mở ra
    });
  }

  // ===== Ảnh bóc mái: danh sách nằm trong config.js (bocMai) =====
  const BOC_MAI_CFG = CFG.bocMai || {};
  const BOC_MAI = BOC_MAI_CFG.items || [];
  const bocMaiUrl = (it, i) => it.id ? (ALL_ORIGINAL_SIZE ? `${makeImageUrl(it.id)}&q=95&output=webp` : `${makeImageUrl(it.id)}&w=2400&h=3000&we&q=90&output=webp`) : `https://picsum.photos/seed/bocmai${i + 1}/2000/2500`;
  // Bóc mái thành carousel (giống các mục khác): tiêu đề = tên căn, mô tả = trục căn hộ (phần sau dấu "|")
  // Tách theo tòa: SM2 → bocmai_sm2, SM3 → bocmai_sm3 (nhận biết qua tiền tố "SM2"/"SM3" trong tên căn)
  const bocMaiItems = BOC_MAI.map((it, i) => {
    const [ten, truc] = String(it.ten || "").split("|").map(x => x.trim());
    return { url: bocMaiUrl(it, i), tag: it.tag || "", ten, mota: truc || "" };
  });
  ["sm2", "sm3"].forEach(k => {
    CAROUSELS["bocmai_" + k] = { tieude: BOC_MAI_CFG.tieude || "", ratio: BOC_MAI_CFG.ratio || "4 / 5", items: bocMaiItems.filter(it => it.ten.toLowerCase().startsWith(k)) };
  });

  // ===== Phóng to ảnh trong khung: chạm để phóng to/thu nhỏ, kéo để di chuyển, 2 ngón để zoom =====
  function zoomify(img) {
    if (img.parentElement?.classList.contains("zm")) return;
    const wrap = document.createElement("div"); wrap.className = "zm";
    wrap.style.aspectRatio = img.style.aspectRatio || "16 / 10"; img.style.aspectRatio = "";
    img.className.split(/\s+/).filter(c => /^m[bt]-\d$/.test(c)).forEach(c => { wrap.classList.add(c); img.classList.remove(c); });
    img.parentNode.insertBefore(wrap, img); wrap.appendChild(img);
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "zm-btn"; btn.textContent = "🔍 Chạm để phóng to"; wrap.appendChild(btn);
    // Vòng quay "đang tải" cho tới khi ảnh hiện ra (kể cả khi chưa được gán src vì chưa cuộn tới)
    const spin = document.createElement("div"); spin.className = "zm-spin"; spin.setAttribute("role", "status"); spin.setAttribute("aria-label", "Đang tải ảnh");
    spin.innerHTML = "<i></i><i></i><i></i>"; wrap.appendChild(spin);
    let errs = 0;
    const loaded = () => img.complete && img.naturalWidth > 0 && !!img.getAttribute("src");
    const sync = () => wrap.classList.toggle("loading", !loaded());
    img.addEventListener("load", sync);
    img.addEventListener("error", () => { errs++; setTimeout(() => { if (img._retry && errs < 2) return; wrap.classList.remove("loading"); wrap.classList.add("failed"); }, 0); }); // lỗi lần 1 sẽ được thử lại 1 lần; lỗi hẳn thì dừng quay
    new MutationObserver(() => { wrap.classList.remove("failed"); sync(); }).observe(img, { attributes: true, attributeFilter: ["src"] });
    sync();
    let s = 1, tx = 0, ty = 0; const pts = new Map(); let moved = 0, t0 = 0, pinch = 0;
    // Mức phóng khi chạm: nếu ảnh gốc lớn hơn 2,5 lần ảnh đang hiển thị thì phóng tới đúng kích thước gốc (1 điểm ảnh gốc = 1 điểm ảnh CSS), ngược lại phóng 2,5 lần.
    const BASE = 2.5;
    const target = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight, w = wrap.clientWidth, h = wrap.clientHeight;
      if (!nw || !nh || !w || !h) return BASE;
      const orig = 1 / (img.style.objectFit === "contain" ? Math.min(w / nw, h / nh) : Math.max(w / nw, h / nh)); // tỉ lệ ảnh đang hiển thị so với ảnh gốc: cover = max, contain = min
      return orig > BASE ? orig : BASE;
    };
    const maxScale = () => Math.max(5, target());
    const clamp = () => { const w = wrap.clientWidth, h = wrap.clientHeight; tx = Math.min(0, Math.max(w * (1 - s), tx)); ty = Math.min(0, Math.max(h * (1 - s), ty)); };
    const apply = () => { clamp(); img.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; wrap.classList.toggle("zoomed", s > 1.01); btn.textContent = s > 1.01 ? "✕ Thu nhỏ" : "🔍 Chạm để phóng to"; };
    const zoomAt = (x, y, ns) => { ns = Math.min(maxScale(), Math.max(1, ns)); tx = x - (x - tx) * ns / s; ty = y - (y - ty) * ns / s; s = ns; if (s <= 1.01) { s = 1; tx = ty = 0; } apply(); };
    const local = e => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    btn.addEventListener("click", e => { e.stopPropagation(); if (s > 1.01) { s = 1; tx = ty = 0; apply(); } else zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, target()); });
    btn.addEventListener("pointerdown", e => e.stopPropagation());
    wrap.addEventListener("pointerdown", e => {
      if (e.target === btn) return;
      wrap.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); moved = 0; t0 = Date.now();
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
    });
    wrap.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId), cur = local(e); pts.set(e.pointerId, cur);
      moved += Math.abs(cur[0] - prev[0]) + Math.abs(cur[1] - prev[1]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, s * d / pinch); pinch = d;
      } else if (s > 1.01) { tx += cur[0] - prev[0]; ty += cur[1] - prev[1]; apply(); }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      const was = pts.size; pts.delete(e.pointerId); pinch = 0;
      if (e.type === "pointerup" && was === 1 && moved < 8 && Date.now() - t0 < 400) {
        const [x, y] = local(e); if (s > 1.01) { s = 1; tx = ty = 0; apply(); } else zoomAt(x, y, target());
      }
    };
    wrap.addEventListener("pointerup", up); wrap.addEventListener("pointercancel", up);
    wrap.addEventListener("wheel", e => { if (s > 1.01 || e.ctrlKey) { e.preventDefault(); const [x, y] = local(e); zoomAt(x, y, s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); } }, { passive: false });
  }
  // Mọi ảnh nội dung (class "photo") đều phóng to được; ảnh nền parallax là CSS nên không bị ảnh hưởng. Ảnh nào cần phóng to mà không có class "photo" thì thêm data-zoom.
  function initZoom() { document.querySelectorAll("#appRoot img.photo, #appRoot img[data-zoom]").forEach(zoomify); }

  // ===== Ảnh trang giới thiệu + bóc mái: tải về IndexedDB để chạy offline hoàn toàn =====
  const noSurveyMode = () => document.documentElement.classList.contains("no-survey");
  const landingElUrl = el => { const isImg = el.tagName === "IMG"; return landingUrl(el.dataset.img === "hero" && noSurveyMode() ? "hero_tuvan" : el.dataset.img, +el.dataset.w || (isImg ? 1200 : 1000), +el.dataset.h || (isImg ? 750 : 1600), isImg); };
  function landingList() {
    const seen = new Set();
    document.querySelectorAll("#appRoot [data-img]").forEach(el => seen.add(landingElUrl(el)));
    seen.add(landingUrl("hero_tuvan", 1000, 1600, false)); seen.add(landingUrl("hero", 1000, 1600, false)); // cả hai ảnh hero để chạy được ở hai chế độ
    BOC_MAI.forEach((it, i) => seen.add(bocMaiUrl(it, i)));
    Object.values(CAROUSELS).forEach(c => c.items.forEach(it => seen.add(it.url || landingUrl(it.key, 1000, 750, true)))); // ảnh carousel (đúng cỡ initCarousels dùng)
    return [...seen];
  }
  const landingBlobUrls = new Map();
  async function landingLocalUrl(url) {
    if (landingBlobUrls.has(url)) return landingBlobUrls.get(url);
    const rec = await get(LANDING_STORE, url);
    if (!rec?.blob) return null;
    const u = URL.createObjectURL(rec.blob); landingBlobUrls.set(url, u); return u;
  }
  // Bản online: ảnh của một mục (section) chỉ được nạp khi mục đó tới gần màn hình. Bản offline: nạp hết từ bộ nhớ máy.
  const lazyDone = new Set();
  let heroHold = true; // giữ ảnh hero lại cho tới khi màn hình chờ tải xong (để chỉ tải một lần)
  const unitOf = el => el.closest("section") || el;
  function initLazyLanding(sc) {
    const units = new Set([...document.querySelectorAll("#appRoot [data-img], #appRoot img[data-lurl]")].map(unitOf));
    if (!("IntersectionObserver" in window)) { units.forEach(u => lazyDone.add(u)); applyLanding(); return; }
    const io = new IntersectionObserver(es => {
      let any = false;
      es.forEach(e => { if (e.isIntersecting) { lazyDone.add(e.target); io.unobserve(e.target); any = true; } });
      if (any) applyLanding();
    }, { root: sc, rootMargin: "100% 0px 100% 0px" });
    units.forEach(u => io.observe(u));
  }
  async function applyLanding() {
    const els = [...document.querySelectorAll("#appRoot [data-img]"), ...document.querySelectorAll("#appRoot img[data-lurl]")];
    const eager = isOfflineReady();
    for (const el of els) {
      if (heroHold && el.dataset.img === "hero") continue;
      if (!eager && !lazyDone.has(unitOf(el))) continue;
      const url = el.dataset.img === "hero" ? landingElUrl(el) : (el.dataset.lurl || (el.dataset.lurl = landingElUrl(el))); // hero đổi ảnh theo chế độ
      const src = (await landingLocalUrl(url)) || (navigator.onLine ? url : "");
      if (!src || el.dataset.lsrc === src) continue;
      el.dataset.lsrc = src;
      if (el.tagName === "IMG") {
        el.src = src;
        // Ảnh từ mạng (wsrv.nl/Google Drive) lỗi: thử lại đúng 1 lần với địa chỉ có mã riêng, để bỏ qua kết quả lỗi đã bị lưu tạm ở trình duyệt/máy chủ ảnh
        if (/^https?:/.test(src) && !el._retry) el.addEventListener("error", () => {
          if (el._retry) { console.warn("Không tải được ảnh:", src); return; }
          el._retry = true; el.src = src + (src.includes("?") ? "&" : "?") + "r=" + Date.now();
        });
      } else el.style.setProperty("--bg", `url("${src}")`);
    }
  }
  async function fetchLandingWithRetry(url, tries = 3, onFrac) {
    let lastErr;
    for (let k = 1; k <= tries; k++) {
      try {
        const blob = await fetchImageBlob(url, onFrac);
        await put(LANDING_STORE, { id: url, blob, size: blob.size, downloadedAt: Date.now() });
        return blob.size;
      } catch (e) { lastErr = e; if (k < tries) await new Promise(res => setTimeout(res, 800 * k)); }
    }
    throw lastErr;
  }
  async function landingMissing() {
    const all = landingList(), todo = [];
    for (const u of all) if (!(await get(LANDING_STORE, u))?.blob) todo.push(u);
    return { all, todo };
  }
  async function downloadLanding(onTick) {
    const { all, todo } = await landingMissing(), failed = [];
    let done = 0, bytesDone = 0, next = 0;
    const tick = () => onTick && onTick({ done, total: todo.length, bytesDone, failed });
    tick();
    const worker = async () => {
      while (next < todo.length) {
        const u = todo[next++];
        try { bytesDone += await fetchLandingWithRetry(u); }
        catch (e) { failed.push(`ảnh giới thiệu: ${e.message}`); }
        done++; tick();
      }
    };
    await Promise.all([worker(), worker()]);
    try { // dọn ảnh cũ không còn được dùng (ví dụ vừa đổi ID Drive)
      const keep = new Set(all);
      for (const k of await reqPromise(store(LANDING_STORE).getAllKeys())) if (!keep.has(k)) { await del(LANDING_STORE, k); landingBlobUrls.delete(k); }
    } catch {}
    await applyLanding();
    return { total: todo.length, failed };
  }

  function initLanding() {
    initCarousels();
    initZoom();
    initLazyLanding($("scroller"));
    const sc = $("scroller"), menu = $("menu");
    const mTog = $("menuToggle"), mLbl = $("menuLabel");
    const setMenu = on => {
      // Đầu trang menu nằm ở đáy màn hình → danh sách xổ lên trên; khi đã dính đầu khung thì xổ xuống dưới như cũ
      if (on) menu.classList.toggle("up", menu.getBoundingClientRect().top - sc.getBoundingClientRect().top > sc.clientHeight / 2);
      menu.classList.toggle("open", on); mTog.setAttribute("aria-expanded", on ? "true" : "false"); };
    // Nhấn giữ nút menu 3 giây = bật/tắt chế độ khảo sát (chỉ Admin biết)
    let lpT = 0, lpFired = false;
    mTog.addEventListener("pointerdown", () => { lpFired = false; clearTimeout(lpT); lpT = setTimeout(() => {
      lpFired = true; setMenu(false);
      const html = document.documentElement, noSurvey = !html.classList.contains("no-survey");
      html.classList.toggle("no-survey", noSurvey);
      try { localStorage.setItem(lsKey("ap_survey"), noSurvey ? "0" : "1"); } catch {}
      navigator.vibrate?.(80); showToast(noSurvey ? "Chế độ giới thiệu dự án (không khảo sát)" : "Chế độ có khảo sát", 2500);
      applyLanding(); requestAnimationFrame(() => { sc.scrollTo({ top: 0 }); curSec(); });
    }, 3000); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => mTog.addEventListener(ev, () => clearTimeout(lpT)));
    mTog.addEventListener("contextmenu", e => e.preventDefault());
    mTog.addEventListener("click", () => { if (lpFired) { lpFired = false; return; } setMenu(!menu.classList.contains("open")); });
    sc.addEventListener("pointerdown", e => { if (!e.target.closest("#menu")) setMenu(false); }, { passive: true }); // chạm ra ngoài thì thu menu lại
    addEventListener("keydown", e => { if (e.key === "Escape") setMenu(false); });
    menu.addEventListener("click", e => {
      const a = e.target.closest("a[href^='#']"); if (!a) return;
      e.preventDefault(); // không đổi hash, tránh lẫn với lịch sử của modal 360°
      setMenu(false);
      const t = $(a.getAttribute("href").slice(1)); if (!t) return;
      if (t.hasAttribute("data-fold")) { // Bàn giao / Chính sách: bấm để hiện, bấm lần nữa để ẩn
        const show = t.hidden;
        t.hidden = !show; a.classList.toggle("fold-open", show);
        document.querySelectorAll(`[data-fold-with="${t.id}"]`).forEach(x => { x.hidden = !show; });
        requestAnimationFrame(() => { if (show) t.scrollIntoView({ behavior: "smooth", block: "start" }); curSec(); });
        return;
      }
      t.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    // Tên mục đang xem hiện trên thanh menu (tự tính theo vị trí cuộn)
    const secs = [...menu.querySelectorAll("a[href^='#']")].map(l => ({ l, el: $(l.getAttribute("href").slice(1)) })).filter(x => x.el);
    let raf = 0;
    const curSec = () => {
      raf = 0; const y = sc.scrollTop + sc.clientHeight * .3, base = sc.getBoundingClientRect().top; let cur = null;
      for (const x of secs) { if (x.el.hidden || !x.el.getClientRects().length) continue; if (x.el.getBoundingClientRect().top - base + sc.scrollTop <= y) cur = x; }
      mLbl.textContent = cur ? cur.l.textContent : "Menu";
      secs.forEach(x => x.l.classList.toggle("active", x === cur));
    };
    sc.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(curSec); }, { passive: true }); curSec();
    $("appVersion").textContent = `Phiên bản ${APP_VERSION}`;
    initStart(); initAutoFullscreen(); initTools(); initSurvey(); initLeadForm();
    window.addEventListener("online", flushLeads);
    flushLeads();
  }

  // ----- Nút Bắt đầu: vào toàn màn hình (nếu trình duyệt cho phép) rồi kéo section đầu tiên lên -----
  function enterFullscreen() {
    const d = document.documentElement;
    if (document.fullscreenElement || !d.requestFullscreen) return;
    d.requestFullscreen({ navigationUI: "hide" }).then(() => screen.orientation?.lock?.("portrait").catch(() => {})).catch(() => {});
  }
  // Trên điện thoại/máy tính bảng: nếu đang không ở chế độ toàn màn hình thì chạm lần nào cũng chuyển sang toàn màn hình
  // (trình duyệt chỉ cho phép khi có thao tác của người dùng; thoát toàn màn hình rồi thì lần chạm kế tiếp sẽ vào lại)
  function initAutoFullscreen() {
    const mobile = () => matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
    document.addEventListener("pointerup", e => {
      if (!mobile() || isStandalone() || document.fullscreenElement || e.target.closest?.("#btnStart")) return; // nút Bắt đầu tự xử lý
      enterFullscreen();
    }, { passive: true });
  }
  function initStart() {
    $("btnStart").addEventListener("click", () => {
      const go = () => $(document.documentElement.classList.contains("no-survey") ? "tong-quan" : "khao-sat").scrollIntoView({ behavior: "smooth", block: "start" });
      const wasFull = !!document.fullscreenElement;
      enterFullscreen(); go();
      // Vào toàn màn hình làm khung đổi kích thước và có thể ngắt lần cuộn đầu: cuộn lại một lần sau khi khung ổn định
      if (!wasFull) {
        const again = () => setTimeout(go, 200);
        document.addEventListener("fullscreenchange", again, { once: true });
        setTimeout(() => document.removeEventListener("fullscreenchange", again), 2000);
      }
    });
  }

  // ----- Cỡ chữ (tăng/giảm/khôi phục) + nút về đầu trang -----
  function initTools() {
    const FS = [0.85, 1, 1.15, 1.3, 1.5, 1.7];
    const DEF = 3; // mặc định 130%
    let i = DEF;
    try { const k = FS.indexOf(+localStorage.getItem(lsKey("fs2"))); if (k >= 0) i = k; } catch {}
    const apply = n => {
      i = Math.max(0, Math.min(FS.length - 1, n));
      document.documentElement.style.setProperty("--fs", FS[i]);
      $("fsReset").textContent = Math.round(FS[i] * 100) + "%";
      $("fsDown").disabled = i === 0; $("fsUp").disabled = i === FS.length - 1;
      try { localStorage.setItem(lsKey("fs2"), FS[i]); } catch {}
      window.dispatchEvent(new Event("resize")); // để carousel tính lại chiều cao phần thông tin
    };
    $("fsDown").addEventListener("click", () => apply(i - 1));
    $("fsUp").addEventListener("click", () => apply(i + 1));
    // Nhấn giữ nút "100%" 5 giây = tạo/cập nhật bản offline (chỉ Admin biết). Nhấn thường = khôi phục cỡ chữ
    let lpT = 0, lpFired = false; const fr = $("fsReset");
    fr.addEventListener("pointerdown", () => { lpFired = false; clearTimeout(lpT); lpT = setTimeout(() => { lpFired = true; navigator.vibrate?.(80); startOfflineFromUser(); }, 5000); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => fr.addEventListener(ev, () => clearTimeout(lpT)));
    fr.addEventListener("contextmenu", e => e.preventDefault());
    fr.addEventListener("click", () => { if (lpFired) { lpFired = false; return; } apply(DEF); });
    apply(i);
    const sc = $("scroller"), top = $("toTop"); let tick = false;
    sc.addEventListener("scroll", () => {
      if (tick) return; tick = true;
      requestAnimationFrame(() => { tick = false; top.classList.toggle("show", sc.scrollTop > sc.clientHeight * 0.6); });
    }, { passive: true });
    top.addEventListener("click", () => sc.scrollTo({ top: 0, behavior: "smooth" }));
  }

  // ----- Đăng ký tư vấn: nhiều số điện thoại, Zalo, gửi về Google Sheet (có hàng đợi khi mất mạng) -----
  const normPhone = v => String(v).replace(/[\s.\-()]/g, "").replace(/^\+?84/, "0");
  const validPhone = v => /^0\d{9,10}$/.test(normPhone(v));
  const leadQueue = {
    get() { try { return JSON.parse(localStorage.getItem(lsKey("leadQueue")) || "[]"); } catch { return []; } },
    set(a) { try { localStorage.setItem(lsKey("leadQueue"), JSON.stringify(a)); } catch {} }
  };
  async function postLead(p) {
    const opt = { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(p) };
    let r;
    try { r = await fetch(LEAD_ENDPOINT, opt); }
    catch { await fetch(LEAD_ENDPOINT, { ...opt, mode: "no-cors" }); return; } // CORS chặn đọc phản hồi nhưng yêu cầu đã tới; trùng lặp được lọc theo id bên Google
    const j = await r.json().catch(() => null);
    if (j && j.ok === false) throw new Error(j.error || "server");
  }
  let flushing = false;
  async function flushLeads() {
    const sent = new Set();
    if (flushing || !navigator.onLine || !LEAD_ENDPOINT) return sent;
    flushing = true;
    try {
      const left = [];
      for (const p of leadQueue.get()) { try { await postLead(p); sent.add(p.id); } catch { left.push(p); } }
      leadQueue.set(left);
    } finally { flushing = false; }
    return sent;
  }
  // ===== Khảo sát khách hàng (2 section trước Tổng quan). Câu trả lời lưu trong bộ nhớ và gửi kèm khi khách bấm "Gửi đăng ký" =====
  const svState = { rank: [] };
  function initSurvey() {
    const src = $("svSource"), other = $("svOther"), sec2 = $("khao-sat-2"), imp = $("svImpress"), rank = $("svRank");
    if (!src || !sec2 || !imp || !rank) return;
    const srcIn = [...src.querySelectorAll("input")];
    const none = srcIn.find(i => i.hasAttribute("data-none")), otherCb = srcIn.find(i => i.hasAttribute("data-other"));
    const impIn = [...imp.querySelectorAll("input")];
    const skin = i => { const l = i.closest(".sv-opt"); l.classList.toggle("on", i.checked); l.classList.toggle("off", i.disabled); };
    const sync = () => {
      const noneOn = none.checked, anyOther = srcIn.some(i => i !== none && i.checked);
      srcIn.forEach(i => { i.disabled = i === none ? anyOther : noneOn; skin(i); });
      other.classList.toggle("d-none", !otherCb.checked);
      if (!otherCb.checked) other.value = "";
      sec2.hidden = noneOn; // chưa biết dự án -> ẩn phần khảo sát "đã biết"
      if (noneOn) { impIn.forEach(i => { i.checked = false; skin(i); }); svState.rank = []; paintRank(); }
    };
    src.addEventListener("change", e => { sync(); if (e.target === otherCb && otherCb.checked) other.focus(); });
    imp.addEventListener("change", () => impIn.forEach(skin));
    const items = () => [...rank.querySelectorAll(".sv-rk")];
    const initialOrder = items().map(x => x.dataset.v);
    function paintRank() {
      const touched = svState.rank.length > 0;
      rank.classList.toggle("touched", touched);
      items().forEach((b, k) => {
        b.querySelector(".n").textContent = String(k + 1);
        if (touched) b.dataset.rk = String(k + 1); else b.removeAttribute("data-rk");
      });
    }
    const commit = () => { svState.rank = items().map(x => x.dataset.v); paintRank(); };
    // Kéo thả: giữ biểu tượng ⠿ bên phải rồi kéo lên/xuống; hoặc dùng phím ↑ ↓ khi đang chọn một mục
    rank.addEventListener("pointerdown", e => {
      const g = e.target.closest(".grip"); if (!g) return;
      const it = g.closest(".sv-rk"); e.preventDefault(); // nghe sự kiện trên document vì mục bị chuyển chỗ trong DOM sẽ mất pointer capture
      const grab = e.clientY - it.getBoundingClientRect().top; let moved = false;
      it.classList.add("drag");
      const follow = y => { it.style.transform = ""; it.style.transform = `translateY(${y - grab - it.getBoundingClientRect().top}px)`; };
      const move = ev => {
        moved = true;
        const sibs = items().filter(x => x !== it);
        const mid = ev.clientY - grab + it.offsetHeight / 2; // tâm của mục đang kéo
        let before = null;
        for (const x of sibs) { const b = x.getBoundingClientRect(); if (mid < b.top + b.height / 2) { before = x; break; } }
        if (before !== it.nextElementSibling) { it.style.transform = ""; rank.insertBefore(it, before); }
        follow(ev.clientY); paintRank();
      };
      const end = () => {
        document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", end); document.removeEventListener("pointercancel", end);
        it.classList.remove("drag"); it.style.transform = ""; if (moved) commit();
      };
      document.addEventListener("pointermove", move); document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
    });
    rank.addEventListener("keydown", e => {
      const it = e.target.closest(".sv-rk"); if (!it || it !== e.target || !/^Arrow(Up|Down)$/.test(e.key)) return;
      e.preventDefault();
      if (e.key === "ArrowUp" && it.previousElementSibling) rank.insertBefore(it, it.previousElementSibling);
      else if (e.key === "ArrowDown" && it.nextElementSibling) rank.insertBefore(it.nextElementSibling, it);
      else return;
      it.focus(); commit();
    });
    const restoreOrder = () => { initialOrder.forEach(v => rank.appendChild(items().find(x => x.dataset.v === v))); svState.rank = []; paintRank(); };
    $("svRankReset")?.addEventListener("click", restoreOrder);
    window.__svReset = () => { srcIn.forEach(i => { i.checked = false; i.disabled = false; }); impIn.forEach(i => { i.checked = false; }); other.value = ""; sync(); impIn.forEach(skin); restoreOrder(); };
    window.__svGet = () => {
      if (document.documentElement.classList.contains("no-survey")) return { khaoSatNguon: "", khaoSatAnTuong: "", khaoSatUuTien: "" };
      const noneOn = none.checked;
      const nguon = srcIn.filter(i => i.checked).map(i => i === otherCb ? (other.value.trim() ? `Khác: ${other.value.trim()}` : "Khác") : i.value);
      return {
        khaoSatNguon: nguon.join("; "),
        khaoSatAnTuong: noneOn ? "" : impIn.filter(i => i.checked).map(i => i.value).join("; "),
        khaoSatUuTien: noneOn || !svState.rank.length ? "" : svState.rank.map((v, k) => `${k + 1}) ${v}`).join("; ")
      };
    };
    sync(); paintRank();
  }

  function initLeadForm() {
    const f = $("lead"), list = $("phoneList"), msg = $("leadMsg");
    $("addPhone").addEventListener("click", () => {
      if (list.children.length >= 4) return;
      const row = document.createElement("div"); row.className = "phone-row";
      row.innerHTML = '<input class="form-control" name="phone" type="tel" inputmode="tel" placeholder="Số điện thoại khác" autocomplete="tel"><label class="zalo-chk"><input type="checkbox" name="zaloChk"><span>Zalo</span></label><button type="button" class="rm-phone" aria-label="Xoá số này">×</button>';
      list.appendChild(row); row.querySelector("input").focus();
      $("addPhone").classList.toggle("d-none", list.children.length >= 4);
    });
    list.addEventListener("click", e => { const b = e.target.closest(".rm-phone"); if (b) { b.parentElement.remove(); $("addPhone").classList.remove("d-none"); } });
    f.addEventListener("input", e => e.target.setCustomValidity?.(""));
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const inputs = [...list.querySelectorAll("input[name=phone]")];
      inputs.forEach(i => { i.setCustomValidity(i.value.trim() && !validPhone(i.value) ? "Số điện thoại chưa đúng" : ""); });
      if (!f.checkValidity()) { f.reportValidity(); return; }
      const fd = new FormData(f), phones = inputs.map(i => normPhone(i.value)).filter(Boolean);
      // Số nào được tick "Zalo" (bỏ qua dòng để trống). "zalo" giữ lại số đầu tiên để tương thích Code.gs bản cũ.
      const zalos = inputs.filter(i => i.value.trim() && i.closest(".phone-row").querySelector("[name=zaloChk]").checked).map(i => normPhone(i.value));
      const lead = {
        token: LEAD_TOKEN, id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: new Date().toISOString(),
        name: String(fd.get("name") || "").trim(), phones, zalos, zalo: zalos[0] || "",
        email: String(fd.get("email") || "").trim(), interest: fd.get("interest") || "", note: String(fd.get("note") || "").trim(),
        website: fd.get("website") || "", source: location.origin + location.pathname, ua: navigator.userAgent.slice(0, 150),
        project: CFG.tenDuAn || CFG.tenApp || "", appVersion: APP_VERSION,
        ...(window.__svGet ? window.__svGet() : {})
      };
      leadQueue.set([...leadQueue.get(), lead].slice(-20)); // lưu trước, gửi sau: không mất dữ liệu khi rớt mạng
      $("leadBtn").disabled = true; msg.textContent = "Đang gửi…";
      const sent = await flushLeads();
      if (sent.has(lead.id)) {
        msg.textContent = "Đã gửi thông tin. Chúng tôi sẽ liên hệ sớm.";
        f.reset(); [...list.children].slice(1).forEach(r => r.remove()); $("addPhone").classList.remove("d-none"); window.__svReset?.();
      } else msg.textContent = "Chưa gửi được (mất mạng hoặc chưa cấu hình). Thông tin đã được lưu và sẽ tự gửi lại khi có kết nối.";
      $("leadBtn").disabled = false;
    });
  }

  async function bootstrapContent(progress) {
    // Đồng bộ danh sách tour + tải ảnh còn thiếu + tạo ảnh xem trước. Trả về số ảnh lỗi.
    await syncTours();
    const res = await downloadAllImages(progress);
    return res;
  }
  async function initAppMode() {
    document.documentElement.classList.add("app-mode");
    SP.bind();
    tours = (await getAll(TOUR_STORE));
    sortTours();
    initLanding();
    const modalEl = $("viewerModal");
    modal = new bootstrap.Modal(modalEl, { backdrop: "static", keyboard: false });
    modalEl.addEventListener("shown.bs.modal", () => { modalOpen = true; if (!wantOpen) return modal.hide(); createViewer(); });
    modalEl.addEventListener("hidden.bs.modal", () => { modalOpen = false; setDrawer(false); pendingViewer = null; destroyViewer(); $("appPanorama").innerHTML = ""; });
    $("avClose").addEventListener("click", closeViewer);
    initSceneDrawer();
    addEventListener("keydown", e => { if (e.key !== "Escape" || !wantOpen) return; if ($("viewerModal").classList.contains("drawer-open")) setDrawer(false); else closeViewer(); });
    window.addEventListener("popstate", route);
    $("tourBox").addEventListener("click", async e => {
      const card = e.target.closest("[data-tour]");
      if (!card || card.disabled || wantOpen || modalOpen) return; // bỏ qua khi đang mở (chống chạm đúp)
      const t = tourById(card.dataset.tour); if (!t) return;
      const sid = await startSceneId(t);
      if (!sid) return showToast("Tour này chưa được tải về.", 3000);
      openViewer(t.id, sid);
    });

    const refresh = () => applyThumbs();
    const ready = isOfflineReady() || await legacyOffline();
    if (ready) { // Bản offline đã có: vào thẳng, cập nhật phần còn thiếu ngầm (thanh tiến trình gộp một lần duy nhất)
      heroHold = false; applyLanding();
      renderTourBox(); route(); ensureThumbs(refresh);
      if (navigator.onLine) {
        await runOfflineBuild("silent");
        try { await ensureThumbs(refresh); await renderTourBox(); } catch {}
      }
      return;
    }
    unregisterSW(); // bản online không dùng Service Worker (tránh tự lưu ảnh ngầm)
    await onlineStart();
  }

  // ===== Màn hình chờ + thanh tiến trình theo lộ trình =====
  // Mỗi thanh tiến trình chỉ chạy 0→100% đúng một lần: tổng khối lượng việc được tính trước, mỗi việc có trọng số riêng,
  // thanh không bao giờ lùi và không chạy lại khi chuyển giai đoạn hay thử lại.
  const SP = (() => {
    let h = {};
    return {
      bind() { $("splashRetry").onclick = () => h.retry && h.retry(); $("splashSkip").onclick = () => h.skip && h.skip(); },
      open(title, text) { const e = $("appSplash"); e.classList.remove("d-none"); e.querySelector("h2").textContent = title; this.working(); $("splashText").textContent = text || ""; $("splashBar").classList.remove("indet"); },
      bar(pct, text) { $("splashBar").style.width = pct + "%"; if (text != null) $("splashText").textContent = text; },
      problem(text, o) { $("splashText").textContent = text; $("splashRetry").classList.remove("d-none"); const sk = $("splashSkip"); sk.classList.toggle("d-none", !o.skip); if (o.skipLabel) sk.textContent = o.skipLabel; h = { retry: o.retry, skip: o.skip }; },
      working() { $("splashRetry").classList.add("d-none"); $("splashSkip").classList.add("d-none"); },
      close() { $("appSplash").classList.add("d-none"); }
    };
  })();
  function makeProgress(render) {
    let shown = 0;
    return { set(p) { shown = Math.max(shown, Math.min(100, Math.round(p))); render(shown); return shown; } };
  }
  const weightedPct = list => { const tot = list.reduce((s, t) => s + t.w, 0) || 1; return list.reduce((s, t) => s + t.w * t.p, 0) / tot * 100; };
  const taskRep = (t, update) => f => { if (f > t.p) { t.p = f; update(); } };
  async function runPool(list, conc, update) {
    let i = 0, streak = 0; // nhiều mục liên tiếp lỗi = mạng đang hỏng: dừng lượt này sớm, khỏi bắt khách chờ lâu
    const worker = async () => { while (i < list.length && streak < 6) { const t = list[i++]; try { await t.run(taskRep(t, update)); t.p = 1; t.ok = true; streak = 0; update(); } catch (e) { t.err = e; streak++; } } };
    await Promise.all(Array.from({ length: conc }, worker));
  }
  const preloadImage = url => new Promise(res => { const i = new Image(); i.onload = i.onerror = () => res(); i.src = url; });
  function unregisterSW() { try { navigator.serviceWorker?.getRegistrations?.().then(rs => rs.forEach(r => r.unregister())).catch(() => {}); } catch {} }

  // ===== Bản ONLINE: lúc mở app chỉ tải phần thiết yếu (danh sách tour, ảnh hero, ảnh nhỏ của tour) =====
  async function prefetchHero(el, rep) {
    const url = landingElUrl(el);
    if (landingBlobUrls.has(url) || await landingLocalUrl(url)) { rep(1); return; }
    let last;
    for (let k = 1; k <= 3; k++) {
      try { const blob = await fetchImageBlob(url, rep); landingBlobUrls.set(url, URL.createObjectURL(blob)); return; }
      catch (e) { last = e; await sleep(800 * k); }
    }
    throw last;
  }
  async function onlineStart() {
    const heroEl = document.querySelector("#appRoot .hero[data-img]"), DISC = 15;
    const prog = makeProgress(p => SP.bar(p, `Đang tải… ${p}%`));
    let items = null, update = () => {};
    SP.open("Đang tải", "Đang kết nối…"); SP.bar(0, "Đang tải… 0%");
    const attempt = async () => {
      if (!navigator.onLine) throw new Error("offline");
      if (!items) { // 0–15%: danh sách tour · 15–100%: ảnh hero (trọng số lớn) + ảnh nhỏ từng tour
        await syncTours((i, n) => prog.set(DISC * i / Math.max(n, 1)));
        prog.set(DISC);
        items = [{ w: 6, p: 0, run: rep => prefetchHero(heroEl, rep) }];
        for (const t of tours) { const sc = t.config.scenes[firstSceneId(t)]; if (sc?.panorama) items.push({ w: 1, p: 0, run: () => preloadImage(thumbRemote(sc.panorama)) }); }
        update = () => prog.set(DISC + (100 - DISC) * weightedPct(items) / 100);
      }
      for (let pass = 1; pass <= 2; pass++) { const todo = items.filter(t => !t.ok); if (!todo.length) break; await runPool(todo, 3, update); }
      return items.every(t => t.ok);
    };
    const done = () => { heroHold = false; applyLanding(); SP.close(); renderTourBox(); route(); };
    for (;;) {
      let ok = false, msg = "";
      try { ok = await attempt(); if (!ok) msg = "Chưa tải xong một số nội dung."; }
      catch (e) { msg = navigator.onLine ? `Chưa tải được nội dung (${e.message}).` : "Cần kết nối Internet để tải nội dung."; }
      if (ok) { prog.set(100); await sleep(300); return done(); }
      const c = await new Promise(res => SP.problem(msg + " Vui lòng kiểm tra mạng rồi bấm Thử lại.", { retry: () => res("retry"), skip: tours.length ? () => res("skip") : null, skipLabel: "Tiếp tục" }));
      if (c === "skip") return done();
      SP.working();
    }
  }

  // ===== Bản OFFLINE: chỉ tạo khi nhấn giữ nút cỡ chữ 5 giây (hoặc tự cập nhật phần thiếu nếu đã có bản offline) =====
  async function legacyOffline() { // máy đã có đủ dữ liệu từ bản cũ → coi như đã có bản offline
    try {
      if (!tours.length || (await panoMissing()).length || (await landingMissing()).todo.length) return false;
      setOfflineReady(true); return true;
    } catch { return false; }
  }
  const shellNeeded = async () => {
    try { if (localStorage.getItem(SHELL_STAMP) === REV && await (await caches.open(SHELL_CACHE)).match("./index.html")) return false; } catch {}
    return true;
  };
  function startOfflineFromUser() {
    if (offlineBusy) return;
    if (!navigator.onLine) { showToast("Cần kết nối Internet để tạo bản offline.", 3000); return; }
    const msg = isOfflineReady() ? "Cập nhật bản offline?\nChỉ tải phần mới hoặc còn thiếu." : "Tải toàn bộ ảnh và dữ liệu để dùng không cần Internet?\nNên dùng Wi-Fi vì dung lượng khá lớn.";
    if (confirm(msg)) runOfflineBuild("manual");
  }
  let offlineBusy = false;
  // mode: "manual" = màn hình chờ (có 6% đầu cho bước đồng bộ danh sách tour) · "silent" = cập nhật ngầm, chỉ hiện thanh nhỏ khi thật sự có gì để tải
  async function runOfflineBuild(mode) {
    if (offlineBusy) return;
    offlineBusy = true;
    const manual = mode === "manual", DISC = manual ? 6 : 0;
    const prog = makeProgress(p => { if (manual) SP.bar(p, `Đang tải… ${p}%`); else showToast(`Đang tải… ${p}%`); });
    let tasks = null, all = [], thumbTask = null, thumbN = 0, update = () => {};
    if (manual) { SP.open("Tạo bản offline", "Đang chuẩn bị…"); SP.bar(0, "Đang tải… 0%"); }
    const go = async () => {
      let wake = null;
      try { wake = await navigator.wakeLock?.request?.("screen"); } catch {}
      try {
        if (!tasks) { // lập kế hoạch một lần: biết trước toàn bộ việc phải làm để tính đúng % cho cả lộ trình
          try { await navigator.storage?.persist?.(); } catch {}
          if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js" + V).catch(() => {});
          if (!navigator.onLine) throw new Error("không có Internet");
          await syncTours(manual ? (i, n) => prog.set(DISC * i / Math.max(n, 1)) : undefined);
          prog.set(DISC);
          const t = [];
          if (await shellNeeded()) t.push({ w: 3, p: 0, run: async rep => { const sh = await ensureShell(); if (sh.missing.length) console.warn("Thiếu tệp offline:", sh.missing); try { localStorage.setItem(SHELL_STAMP, REV); } catch {} rep(1); } });
          for (const it of await panoMissing()) t.push({ w: 4, p: 0, run: rep => fetchPanoramaWithRetry(it, 3, rep) });
          for (const u of (await landingMissing()).todo) t.push({ w: 1, p: 0, run: rep => fetchLandingWithRetry(u, 3, rep) });
          for (const it of uniquePanoramas()) if (!(await get(THUMB_STORE, it.id))) thumbN++;
          thumbTask = thumbN ? { w: 0.4 * thumbN, p: 0 } : null;
          all = thumbTask ? [...t, thumbTask] : t;
          update = () => prog.set(DISC + (100 - DISC) * weightedPct(all) / 100);
          tasks = t;
          if (!all.length) return { complete: true };
          update();
        }
        for (let pass = 1; pass <= 3; pass++) {
          const todo = tasks.filter(x => !x.ok);
          if (!todo.length) break;
          await runPool(todo, 3, update);
          if (tasks.every(x => x.ok) || !navigator.onLine || pass === 3) break;
          await sleep(1500 * pass);
        }
        const left = tasks.filter(x => !x.ok).length;
        if (left) return { left };
        if (thumbTask && !thumbTask.ok) { // dựng ảnh nhỏ: cũng nằm trong cùng thanh tiến trình
          let n = 0; const rep = taskRep(thumbTask, update);
          await ensureThumbs(null, () => rep(Math.min(0.99, ++n / thumbN)));
          thumbTask.p = 1; thumbTask.ok = true; update();
        }
        try { const keep = new Set(landingList()); for (const k of await reqPromise(store(LANDING_STORE).getAllKeys())) if (!keep.has(k)) { await del(LANDING_STORE, k); landingBlobUrls.delete(k); } } catch {}
        const complete = !(await panoMissing()).length && !(await landingMissing()).todo.length && !!(await (await caches.open(SHELL_CACHE)).match("./index.html"));
        return complete ? { complete: true } : { left: 1 };
      } finally { try { await wake?.release?.(); } catch {} }
    };
    try {
      for (;;) {
        let r;
        try { r = await go(); } catch (e) { console.warn("offline", e); r = { error: e }; }
        if (r.complete) {
          setOfflineReady(true);
          if (manual) {
            prog.set(100); SP.bar(100, "Hoàn tất! Ứng dụng đã sẵn sàng chạy offline."); await sleep(1500); SP.close();
            heroHold = false; await applyLanding(); await renderTourBox(); showToast("Đã tạo xong bản offline.", 3000);
          } else showToast("");
          return;
        }
        if (!manual) { showToast(""); return; } // cập nhật ngầm không thành: lần mở sau sẽ tự tải tiếp
        const msg = r.error ? (navigator.onLine ? `Chưa tải được (${r.error.message}).` : "Mất kết nối Internet.") : `Còn ${r.left} mục chưa tải xong.`;
        const c = await new Promise(res => SP.problem(msg + " Kiểm tra mạng rồi bấm Thử lại.", { retry: () => res("retry"), skip: () => res("skip"), skipLabel: "Để sau" }));
        if (c === "skip") { SP.close(); return; }
        SP.working();
      }
    } finally { offlineBusy = false; }
  }

  async function init() {
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      // Trang khách: chỉ đăng ký Service Worker khi đã có bản offline (hoặc lúc tạo bản offline). Trang cài đặt (?admin=1) như cũ.
      if (!appMode || isOfflineReady()) { try { await navigator.serviceWorker.register("./sw.js" + V); } catch (e) { console.warn(e); } }
    }
    if (typeof bootstrap === "undefined" || typeof pannellum === "undefined") {
      throw new Error("Thiếu thư viện " + [typeof bootstrap === "undefined" ? "Bootstrap" : "", typeof pannellum === "undefined" ? "Pannellum" : ""].filter(Boolean).join(" + ") + " (không tải được từ vendor/ lẫn CDN). Kiểm tra thư mục vendor/ trên host hoặc kết nối mạng.");
    }
    try { // màu thanh trạng thái/trình duyệt lấy theo theme.css (--ink-rgb cho App, --brand cho trang cài đặt)
      const cs = getComputedStyle(document.documentElement), hex = t => "#" + t.trim().split(/\s+/).map(n => (+n).toString(16).padStart(2, "0")).join("");
      const c = appMode ? hex(cs.getPropertyValue("--ink-rgb")) : cs.getPropertyValue("--brand").trim();
      if (c) document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", c));
    } catch {}
    db = await openDB();
    if (appMode) return initAppMode();
    await loadLocalTours();
    await refreshAppButton();
    updateNetwork();
    $("viewerMessage").textContent += ` (app ${APP_VERSION})`;
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    $("syncTours").addEventListener("click", async () => {
      try { await syncTours(); } catch(e) { setStatus(`Đồng bộ thất bại: ${e.message}`); }
    });
    $("createApp").addEventListener("click", createApp);
    $("downloadTour").addEventListener("click", downloadTour);
    $("openTour").addEventListener("click", openTour);
    $("deleteTour").addEventListener("click", deleteTourImages);
    $("sceneSearch").addEventListener("input", renderScenes);
    $("refreshStorage").addEventListener("click", updateStorage);
    $("backToTour").addEventListener("click", () => {
      destroyViewer();
      $("panorama").innerHTML = "";
      $("viewerMessage").textContent = `Chọn tour, tải ảnh rồi mở tour để xem. (app ${APP_VERSION})`;
      $("backToTour").disabled = true;
    });
    // Try syncing tour manifest on first online load; local IndexedDB remains available offline.
    if (navigator.onLine) {
      try { await syncTours(); } catch(e) { setStatus(`Chưa đồng bộ được tour: ${e.message}`); }
      await refreshAppButton();
    }
  }
  init().catch(e => {
    console.error(e);
    const hint = location.protocol === "file:" ? " Hãy mở bằng HTTPS, không dùng file://." : "";
    alert("Không khởi tạo được ứng dụng: " + (e && e.message ? e.message : e) + hint);
  });
})();