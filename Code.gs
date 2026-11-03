/**
 * =====================================================================
 * CODE.GS — NHẬN ĐĂNG KÝ TƯ VẤN TỪ WEBSITE
 *   1) Ghi mỗi đăng ký thành 1 dòng trong Google Sheet
 *   2) Gửi email HTML báo cho anh (có nút Gọi / Zalo / Mở Sheet)
 *
 * CÁCH CÀI (làm 1 lần, khoảng 5 phút):
 *   B1. Tạo một Google Sheet mới (đặt tên tuỳ ý, ví dụ "Khách đăng ký").
 *   B2. Trong Sheet: menu Tiện ích mở rộng > Apps Script. Xoá code mẫu, dán toàn bộ file này vào.
 *   B3. Sửa khối CONFIG bên dưới (TOKEN và EMAIL_NHAN là hai chỗ bắt buộc). Bấm biểu tượng đĩa để Lưu.
 *   B4. Chọn hàm  testThuCong  ở thanh trên rồi bấm Chạy. Lần đầu Google hỏi quyền: chọn tài khoản > Nâng cao > Đi tới (không an toàn) > Cho phép.
 *       Kết quả đúng: Sheet có thêm 1 dòng thử + hộp thư của anh nhận 1 email "[TEST] ...".
 *   B5. Triển khai: Triển khai > Tùy chọn triển khai mới > loại "Ứng dụng web":
 *         - Thực thi với tư cách: Tôi
 *         - Người có quyền truy cập: Bất kỳ ai
 *       Bấm Triển khai, sao chép "URL ứng dụng web" (kết thúc bằng /exec).
 *   B6. Mở config.js trên website, dán URL đó vào  guiDangKy.url  và dán cùng TOKEN vào  guiDangKy.token. Đổi phienBan rồi đưa file lên host.
 *
 * KHI SỬA CODE SAU NÀY: Triển khai > Quản lý bản triển khai > biểu tượng bút chì > Phiên bản: "Phiên bản mới" > Triển khai.
 *   (Làm đúng cách này thì URL /exec giữ nguyên, không phải sửa lại config.js.)
 *
 * DÙNG CHUNG CHO NHIỀU WEBSITE: mỗi website điền  tenDuAn  riêng trong config.js, cột "Dự án" trong Sheet và tiêu đề email sẽ ghi tên đó.
 *   Có thể dùng chung 1 TOKEN, hoặc cho mỗi website 1 token riêng (điền nhiều token trong TOKEN, cách nhau dấu phẩy trong dạng mảng).
 *
 * LƯU Ý BẢO MẬT: TOKEN nằm trong file config.js nên ai xem mã nguồn website cũng thấy được; nó chỉ để chặn các lượt gửi bậy thông thường,
 *   không phải khoá bảo mật tuyệt đối. Dữ liệu khách chỉ được GHI vào Sheet, website không đọc lại được dữ liệu nào.
 * =====================================================================
 */

const CONFIG = {
  // Chuỗi bí mật, PHẢI TRÙNG với guiDangKy.token trong config.js. Nhiều website khác token: ["token-web-1", "token-web-2"]
  TOKEN: "DOI-CHUOI-BI-MAT-NAY",

  // Email nhận thông báo. Nhiều email: "a@gmail.com, b@gmail.com"
  EMAIL_NHAN: "email-cua-anh@gmail.com",
  EMAIL_CC: "",                       // (không bắt buộc) email nhận bản sao

  GUI_EMAIL: true,                    // false = chỉ ghi Sheet, không gửi email
  TEN_SHEET: "Đăng ký",               // tên tab trong Google Sheet (chưa có thì tự tạo)
  SHEET_ID: "",                       // để trống nếu code này tạo từ trong Google Sheet (cách B2). Chỉ điền ID khi dùng script độc lập
  TEN_NGUOI_GUI: "Website đăng ký tư vấn", // tên hiển thị của người gửi email
  MAU_CHU_DAO: "#82560f",             // màu nhấn của email (nên cùng tông với màu nhấn của website)
  MUI_GIO: "Asia/Ho_Chi_Minh"
};

// Thứ tự các cột trong Sheet. Đừng đổi tên cột "ID" và "Email thông báo" (code dùng để chống trùng và ghi trạng thái gửi mail).
const CAC_COT = [
  "Thời gian nhận", "Giờ đăng ký (máy khách)", "Dự án", "Họ tên", "Điện thoại", "Điện thoại khác", "Zalo", "Email", "Quan tâm", "Ghi chú",
  "Khảo sát: Nguồn biết đến", "Khảo sát: Ấn tượng", "Khảo sát: Ưu tiên", "Trang gửi", "Thiết bị", "Phiên bản App", "Email thông báo", "ID"
];

/* ----------------------------- Điểm nhận dữ liệu ----------------------------- */

// Mở thẳng địa chỉ /exec bằng trình duyệt sẽ thấy dòng này = đã triển khai đúng
function doGet() {
  return phanHoi_({ ok: true, service: "lead-collector", time: new Date().toISOString() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000); // nhiều khách gửi cùng lúc thì xếp hàng, không ghi đè nhau
    let d;
    try { d = JSON.parse((e && e.postData && e.postData.contents) || ""); }
    catch (_) { return phanHoi_({ ok: true, skipped: "không đọc được dữ liệu" }); }

    const tokens = [].concat(CONFIG.TOKEN);
    if (!d || tokens.indexOf(d.token) < 0) return phanHoi_({ ok: false, error: "sai token" }); // để website báo "chưa gửi được" -> anh biết mà sửa
    if (d.website) return phanHoi_({ ok: true });  // ô bẫy chống robot: giả vờ thành công

    const lead = chuanHoa_(d);
    if (!lead.ten || !lead.dienThoai) return phanHoi_({ ok: true, skipped: "thiếu họ tên hoặc điện thoại" });

    const sheet = laySheet_();
    if (daCoId_(sheet, lead.id)) return phanHoi_({ ok: true, duplicate: true }); // website gửi lại do rớt mạng

    const hang = ghiSheet_(sheet, lead);

    let trangThai = "Không gửi (đã tắt)";
    if (CONFIG.GUI_EMAIL) {
      try { guiEmail_(lead, sheet.getParent().getUrl() + "#gid=" + sheet.getSheetId()); trangThai = "Đã gửi " + dinhDang_(new Date(), "HH:mm dd/MM"); }
      catch (err) { trangThai = "LỖI gửi mail: " + String(err).slice(0, 150); console.error(err); }
    }
    sheet.getRange(hang, CAC_COT.indexOf("Email thông báo") + 1).setValue(trangThai);

    return phanHoi_({ ok: true });
  } catch (err) {
    console.error(err);
    return phanHoi_({ ok: false, error: String(err).slice(0, 200) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function phanHoi_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ----------------------------- Xử lý dữ liệu ----------------------------- */

function zaloDanhSach_(d, ds) {
  if (Array.isArray(d.zalos)) return d.zalos.map(x => soDienThoai_(x)).filter(Boolean).slice(0, 4);
  const mot = soDienThoai_(d.zalo) || ds[0] || "";
  return mot ? [mot] : [];
}

function chuanHoa_(d) {
  const ds = [].concat(d.phones || []).map(x => soDienThoai_(x)).filter(Boolean);
  return {
    id: lamSach_(d.id, 80) || Utilities.getUuid(),
    gioMayKhach: lamSach_(d.createdAt, 40),
    duAn: lamSach_(d.project, 120) || "(chưa đặt tên dự án)",
    ten: lamSach_(d.name, 120),
    dienThoai: ds[0] || "",
    dienThoaiKhac: ds.slice(1, 4).join(", "),
    zalo: zaloDanhSach_(d, ds).join(", "), // các số được khách tick "Zalo" (bản app cũ chỉ gửi 1 số trong d.zalo)
    email: emailHopLe_(d.email) ? lamSach_(d.email, 120) : "",
    quanTam: lamSach_(d.interest, 120),
    ghiChu: lamSach_(d.note, 1000),
    svNguon: lamSach_(d.khaoSatNguon, 500),
    svAnTuong: lamSach_(d.khaoSatAnTuong, 500),
    svUuTien: lamSach_(d.khaoSatUuTien, 500),
    nguon: lamSach_(d.source, 200),
    thietBi: lamSach_(d.ua, 150),
    phienBan: lamSach_(d.appVersion, 40)
  };
}

function lamSach_(v, toiDa) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, toiDa || 200);
}
function soDienThoai_(v) {
  const s = String(v == null ? "" : v).replace(/[\s.\-()]/g, "").replace(/^\+?84/, "0");
  return /^0\d{9,10}$/.test(s) ? s : "";
}
function emailHopLe_(v) { return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(String(v || "").trim()); }
function dinhDang_(date, mau) { return Utilities.formatDate(date, CONFIG.MUI_GIO, mau); }

// Chặn "công thức" độc hại: ô bắt đầu bằng = + - sẽ được lưu như chữ thường
function antoanO_(v) { const s = String(v == null ? "" : v); return /^[=+\-]/.test(s) ? "'" + s : s; }

/* ----------------------------- Google Sheet ----------------------------- */

function laySheet_() {
  const ss = CONFIG.SHEET_ID ? SpreadsheetApp.openById(CONFIG.SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Không tìm thấy Google Sheet. Hãy tạo script từ trong Sheet (Tiện ích mở rộng > Apps Script) hoặc điền SHEET_ID.");
  let sh = ss.getSheetByName(CONFIG.TEN_SHEET);
  if (!sh) { // Sheet mới tinh chỉ có 1 tab trống: đổi tên tab đó, khỏi để dư tab trống
    const ds = ss.getSheets();
    sh = (ds.length === 1 && ds[0].getLastRow() === 0) ? ds[0].setName(CONFIG.TEN_SHEET) : ss.insertSheet(CONFIG.TEN_SHEET);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, CAC_COT.length).setValues([CAC_COT]).setFontWeight("bold").setBackground("#f1eadc").setVerticalAlignment("middle");
    sh.setFrozenRows(1);
    [0, 1].forEach(i => sh.setColumnWidth(i + 1, 150));
    sh.setColumnWidth(CAC_COT.indexOf("Họ tên") + 1, 170);
    sh.setColumnWidth(CAC_COT.indexOf("Ghi chú") + 1, 260);
  }
  return sh;
}

function daCoId_(sheet, id) {
  const cuoi = sheet.getLastRow();
  if (cuoi < 2) return false;
  const tu = Math.max(2, cuoi - 299); // chỉ cần soát 300 dòng gần nhất
  const cot = CAC_COT.indexOf("ID") + 1;
  return sheet.getRange(tu, cot, cuoi - tu + 1, 1).getValues().some(r => String(r[0]) === id);
}

function ghiSheet_(sheet, l) {
  const hang = sheet.getLastRow() + 1;
  const giaTri = [
    dinhDang_(new Date(), "dd/MM/yyyy HH:mm:ss"),
    isNaN(new Date(l.gioMayKhach)) ? "" : dinhDang_(new Date(l.gioMayKhach), "dd/MM/yyyy HH:mm:ss"),
    l.duAn, l.ten, l.dienThoai, l.dienThoaiKhac, l.zalo, l.email, l.quanTam, l.ghiChu,
    l.svNguon, l.svAnTuong, l.svUuTien, l.nguon, l.thietBi, l.phienBan, "Đang gửi…", l.id
  ].map(antoanO_);
  const vung = sheet.getRange(hang, 1, 1, CAC_COT.length);
  vung.setNumberFormat("@").setValues([giaTri]); // định dạng chữ: giữ số 0 đầu của số điện thoại
  return hang;
}

/* ----------------------------- Email HTML ----------------------------- */

function guiEmail_(l, linkSheet) {
  const tieuDe = ("[" + l.duAn + "] Khách mới: " + l.ten + " – " + l.dienThoai).replace(/[\r\n]+/g, " ");
  const opt = {
    to: CONFIG.EMAIL_NHAN,
    subject: tieuDe,
    body: emailChu_(l),
    htmlBody: emailHtml_(l, linkSheet),
    name: CONFIG.TEN_NGUOI_GUI
  };
  if (CONFIG.EMAIL_CC) opt.cc = CONFIG.EMAIL_CC;
  if (l.email) opt.replyTo = l.email; // bấm "Trả lời" là trả lời thẳng cho khách
  MailApp.sendEmail(opt);
}

function emailChu_(l) {
  const dong = [
    "KHÁCH MỚI ĐĂNG KÝ TƯ VẤN – " + l.duAn, "",
    "Họ tên: " + l.ten,
    "Điện thoại: " + l.dienThoai + (l.dienThoaiKhac ? " (khác: " + l.dienThoaiKhac + ")" : ""),
    "Zalo: " + (l.zalo || "(không có số Zalo)")
  ];
  if (l.email) dong.push("Email: " + l.email);
  if (l.quanTam) dong.push("Quan tâm: " + l.quanTam);
  if (l.ghiChu) dong.push("Ghi chú: " + l.ghiChu);
  if (l.svNguon) dong.push("Khảo sát – nguồn biết đến: " + l.svNguon);
  if (l.svAnTuong) dong.push("Khảo sát – ấn tượng: " + l.svAnTuong);
  if (l.svUuTien) dong.push("Khảo sát – ưu tiên: " + l.svUuTien);
  dong.push("", "Nhận lúc: " + dinhDang_(new Date(), "HH:mm dd/MM/yyyy"));
  return dong.join("\n");
}

function emailHtml_(l, linkSheet) {
  const mau = CONFIG.MAU_CHU_DAO;
  const h = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const so = s => String(s).replace(/\D/g, "");

  const hang = (nhan, noiDung) =>
    '<tr><td style="padding:11px 16px;width:36%;vertical-align:top;background:#faf7f1;border-bottom:1px solid #ece5d6;color:#6b6358;font-size:13px;">' + h(nhan) + '</td>' +
    '<td style="padding:11px 16px;vertical-align:top;border-bottom:1px solid #ece5d6;color:#211e1a;font-size:15px;line-height:1.5;">' + noiDung + '</td></tr>';
  const nut = (nhan, link, nen, chu) =>
    '<a href="' + h(link) + '" style="display:inline-block;margin:0 6px 8px 0;padding:12px 20px;background:' + nen + ';color:' + chu + ';text-decoration:none;border-radius:6px;font-size:15px;font-weight:bold;">' + nhan + '</a>';
  const danhSach = s => '<ul style="margin:0;padding-left:18px;">' + String(s).split(/;\s*/).filter(Boolean).map(x => '<li>' + h(x) + '</li>').join("") + '</ul>';

  const dsZalo = String(l.zalo || "").split(/,\s*/).filter(Boolean);
  const sdt = '<a href="tel:' + h(so(l.dienThoai)) + '" style="color:' + mau + ';font-weight:bold;font-size:18px;text-decoration:none;">' + h(l.dienThoai) + '</a>' +
    (l.dienThoaiKhac ? '<br><span style="color:#6b6358;font-size:13px;">Số khác: ' + h(l.dienThoaiKhac) + '</span>' : "");

  let bang = hang("Họ tên", '<b style="font-size:17px;">' + h(l.ten) + '</b>') + hang("Điện thoại", sdt) +
    hang("Zalo", dsZalo.length ? dsZalo.map(x => '<a href="https://zalo.me/' + h(so(x)) + '" style="color:' + mau + ';text-decoration:none;">' + h(x) + '</a>').join("<br>") : '<span style="color:#8a8275;">Không có số Zalo</span>');
  if (l.email) bang += hang("Email", '<a href="mailto:' + h(l.email) + '" style="color:' + mau + ';text-decoration:none;">' + h(l.email) + '</a>');
  if (l.quanTam) bang += hang("Quan tâm", h(l.quanTam));
  if (l.ghiChu) bang += hang("Ghi chú", h(l.ghiChu).replace(/\n/g, "<br>"));

  let khaoSat = "";
  if (l.svNguon || l.svAnTuong || l.svUuTien) {
    khaoSat = '<div style="padding:14px 16px 4px;color:' + mau + ';font-size:12px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;">Kết quả khảo sát</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid #ece5d6;">' +
      (l.svNguon ? hang("Biết dự án qua", danhSach(l.svNguon)) : "") +
      (l.svAnTuong ? hang("Ấn tượng nhất", danhSach(l.svAnTuong)) : "") +
      (l.svUuTien ? hang("Thứ tự ưu tiên", danhSach(l.svUuTien)) : "") + '</table>';
  }

  return '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#efeadf;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efeadf;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e3dccb;">' +
    '<tr><td style="background:' + mau + ';padding:20px 24px;">' +
      '<div style="color:#f6ecd6;font-size:12px;letter-spacing:.1em;text-transform:uppercase;">' + h(l.duAn) + '</div>' +
      '<div style="color:#ffffff;font-size:22px;font-weight:bold;margin-top:4px;">Khách mới đăng ký tư vấn</div></td></tr>' +
    '<tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + bang + '</table>' + khaoSat + '</td></tr>' +
    '<tr><td style="padding:20px 24px 12px;">' +
      nut("📞 Gọi ngay", "tel:" + so(l.dienThoai), mau, "#ffffff") +
      dsZalo.map(x => nut("💬 Zalo " + x, "https://zalo.me/" + so(x), "#0068ff", "#ffffff")).join("") +
      nut("📊 Mở Google Sheet", linkSheet, "#efeadf", "#211e1a") + '</td></tr>' +
    '<tr><td style="padding:12px 24px 22px;color:#8a8275;font-size:12px;line-height:1.6;border-top:1px solid #ece5d6;">' +
      'Nhận lúc ' + h(dinhDang_(new Date(), "HH:mm 'ngày' dd/MM/yyyy")) +
      (l.nguon ? ' · Từ ' + h(l.nguon) : "") + (l.phienBan ? ' · App ' + h(l.phienBan) : "") +
      '<br>Bấm "Trả lời" để viết thư cho khách' + (l.email ? "" : " (khách không để lại email nên mục này không dùng được)") + '.' +
    '</td></tr></table></td></tr></table></body></html>';
}

/* ----------------------------- Chạy thử ----------------------------- */

// Chạy hàm này trong trình soạn thảo Apps Script để cấp quyền và thử toàn bộ quy trình (1 dòng Sheet + 1 email "[TEST]")
function testThuCong() {
  const mau = {
    token: [].concat(CONFIG.TOKEN)[0],
    id: "test-" + Utilities.getUuid(),
    createdAt: new Date().toISOString(),
    project: "TEST – " + CONFIG.TEN_NGUOI_GUI,
    name: "Nguyễn Văn Thử",
    phones: ["0912345678", "0987654321"],
    zalos: ["0912345678"],
    zalo: "0912345678",
    email: "",
    interest: "3 phòng ngủ",
    note: "Đây là đăng ký thử để kiểm tra Sheet và email.\nDòng này có thể xoá.",
    khaoSatNguon: "Facebook; Bạn bè giới thiệu",
    khaoSatAnTuong: "Tiện ích nội khu; Vị trí",
    khaoSatUuTien: "1) Giá bán; 2) Pháp lý; 3) Vị trí",
    source: "https://thu-nghiem.example/",
    ua: "Kiểm tra thủ công",
    appVersion: "test"
  };
  const kq = doPost({ postData: { contents: JSON.stringify(mau) } }).getContent();
  console.log(kq);
  if (JSON.parse(kq).ok !== true) throw new Error("Thử không thành công: " + kq);
}
