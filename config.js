/* =====================================================================
   CONFIG.JS — TẤT CẢ THIẾT LẬP RIÊNG CỦA TỪNG WEBSITE (nhân bản sang dự án khác: chỉ cần sửa file này)
   Cùng với: theme.css (màu & phông), index.html (nội dung chữ), tours/ (tour 360°), icons/ (biểu tượng).
   Các file app.js, app.css, sw.js KHÔNG phải sửa khi nhân bản.
   ===================================================================== */
(function (g) {
g.APP_CONFIG = {

  // ===== 1. NHẬN DIỆN =====
  // Tên App khi lưu/cài vào máy (tên đầy đủ hiện ở danh sách ứng dụng, tên ngắn hiện dưới biểu tượng ở màn hình chính)
  tenApp:  "NgocHoi.net",
  tenNgan: "NgocHoi.net",
  moTa:    "Giới thiệu dự án Greenera Southmark",
  // Tên dự án: hiện trong email thông báo + cột "Dự án" của Google Sheet (để biết khách đăng ký từ website nào)
  tenDuAn: "Greenera Southmark",
  // Mã ngắn KHÔNG DẤU của website. CHỈ cần điền khi nhiều website khác nhau cùng nằm trên MỘT tên miền (ví dụ ten-mien.com/duan1 và ten-mien.com/duan2),
  // để dữ liệu offline của các website không lẫn nhau. Mỗi website một mã khác nhau, ví dụ "duan2". Để "" nếu mỗi website có tên miền riêng.
  maApp:   "",

  // ===== 2. PHIÊN BẢN =====
  // Mỗi lần sửa file và đưa lên host, đổi số này (vd. r34-2026-11-02). Phần trước dấu "-" (r34) được dùng để làm mới bộ nhớ offline trên máy khách.
  phienBan: "r42-2026-11-05",

  // ===== 3. KHẢO SÁT =====
  // Chế độ ban đầu: false = chế độ tư vấn (bỏ khảo sát, giới thiệu dự án luôn); true = có khảo sát trước.
  // (Admin có thể đổi ngay trên thiết bị bằng cách nhấn giữ nút menu 3 giây; lựa chọn đó được nhớ trên thiết bị.)
  khaoSatMacDinh: false,

  // ===== 4. GỬI ĐĂNG KÝ VỀ GOOGLE SHEET + EMAIL (xem file Code.gs và hướng dẫn trong đó) =====
  guiDangKy: {
    url:   "https://script.google.com/macros/s/AKfycbyYKqv5Lgd2CJOpaRC4HruB-LMsHr5-4U1uHHBPHETVbioXbKItnU83n-ackF-EsfF57w/exec",                          // dán địa chỉ Web app của Apps Script (kết thúc bằng /exec) vào đây; để trống = chỉ lưu tạm trên máy khách
    token: "emdoithanhchuoinaycoduockhonga"      // phải TRÙNG với TOKEN trong Code.gs (đặt một chuỗi bất kỳ khó đoán)
  },

  // ===== 5. NGUỒN ẢNH =====
  // Ảnh lấy từ Google Drive (chia sẻ "Bất kỳ ai có đường liên kết") qua dịch vụ trung gian để tải được từ trình duyệt.
  nguonAnh: {
    proxy: "https://wsrv.nl/?url=",
    drive: "https://drive.google.com/uc?export=download&id=",
    // true = TẤT CẢ ảnh giới thiệu/bóc mái/carousel tải đúng kích thước gốc. false = chỉ các khóa trong danh sách giuGoc bên dưới, ảnh khác thu nhỏ cho nhẹ.
    giuKichThuocGoc: true,
    giuGoc: ["vitri", "vt_ngochoi_ga", "vt_ngochoi_cau", "vt_ql1a", "vt_olympic", "tienichmb", "mb_2toa", "mb_lavish", "mb_seren"],
    // Chiều rộng tối đa (px) của ảnh có thể phóng to khi không giữ kích thước gốc
    chieuRongPhongTo: 2400
  },

  // ===== 6. ẢNH TRANG GIỚI THIỆU: khóa -> ID file ảnh trên Google Drive (khóa trùng với data-img trong index.html; để "" thì dùng ảnh tạm) =====
  anh: {
    hero:"1zsayrl8x2asJZumitA1DiVL5Ieh8ZsJb",
    hero_pano:"14CIb81FK60JuFQ3S2dvPlfqn7qUfm5jk", // Chế độ tư vấn: hero là ảnh 360° (Panellum) thay cho ảnh tĩnh hero_tuvan
    tongquan:"1LfYN05MoywpcoqxhNwud-jnh3E4wWzdH",
    chudautu:"1If2ewQGMtygv-Tgh0EtyKwKZr-vWRQL4",
    vitri:"1hPsna__89G9VhOlbWq2vHNyZEYwyIp2R",

    plx1:"1keY8_JsCMitZvkAQH9QfQwKrJo11jlVi",
    plx2:"1keY8_JsCMitZvkAQH9QfQwKrJo11jlVi",
    plx3:"1keY8_JsCMitZvkAQH9QfQwKrJo11jlVi",
    plx4:"1keY8_JsCMitZvkAQH9QfQwKrJo11jlVi",
    plx5:"1keY8_JsCMitZvkAQH9QfQwKrJo11jlVi",
    plx6:"1keY8_JsCMitZvkAQH9QfQwKrJo11jlVi",
    plx7:"1keY8_JsCMitZvkAQH9QfQwKrJo11jlVi",


    // Chứng nhận EDGE cấp độ 1: 6 ảnh của carousel đầu thẻ "Chứng nhận EDGE cấp độ 1"
    edge1:"1nhxVOegAqMLYhrwKCfi53CJZKxXw6Sjo",
    edge2:"1eRacpr2n9DLiyptP6IfbxDhRgKnY7vIl",
    edge3:"1wK6JG3sa0-69kk9-TVOZvHpTGQOQei9k",
    edge4:"1YUPcdfR8vGpaJtegWSp58FcIh22mlxSo",
    edge5:"1m5-51IqafD1fn8ki61x-FPy67bvMTaDb",
    edge6:"1IkLV5MMTg86ifmcfbTp3v0WEjyF4aj7F",

    mb_2toa:"1GUQyOyq2zV8LqBtcOaqjhIQAJ5-xzoSB",      // Bóc mái: mặt bằng tòa Lavish (1600x1200, tỉ lệ 4:3)
    mb_lavish:"1-Z7G-UBe-yCpXym0AzzJbVJ82nKI-JeC",      // Bóc mái: mặt bằng tòa Lavish (1600x1200, tỉ lệ 4:3)
    mb_seren:"1N1nAXuiEW2j7SFkqsqJzzr4wBVDHk5-9",       // Bóc mái: mặt bằng tòa Seren (1600x1200, tỉ lệ 4:3)

    cdt_signature:"1RTnvGz0ueP1P5070dUV_9quAK90UaG3E",
    cdt_leroisoleil:"15vfDikGwDEZoW2nxb-IUXyqOq220sASY",
    cdt_capitale:"1zuzI6-Kjs9TZaVHDpK1L3pIFyNU_Q1-y",
    cdt_eldorado:"17VfZxGnBbuY1Ohw8Mxvic3lYcPjlMTFC",
    cdt_hatinh:"16PTjnhQtHhIFom04NDQWTKMsUVXoA2CC",
    cdt_phuquoc:"1y6CyeeHgJKsXqZfyZgNGa1s8DaKNyGif",
    cdt_greenera:"1e9xCeDtn4yWoXH7AjWjCtxo5yaflWKcn",

    vt_ngochoi_ga:"1Py52k9XFjV6NKWI2IoNIJBmGyaH6VafB",
    vt_ngochoi_cau:"1-n4ACCizaL_rAwI8ON4rVsfWQ4n5ROBD",
    vt_ql1a:"1E88nWjLLcEznwZ7G17YEglxdjTM2BLSw",
    vt_olympic:"1zb1j9-_FJmeLMqct1hYbecpQWify_8Zv",

    tienichmb:"1z7FlnILn7uUItmd2yD94PBNvB4vL3zAH",      // Tiện ích ngoài: tổng mặt bằng tiện ích

    tin_harmonia:"1-5ib5OOTphJC_pDx1YzCu4L8UE_TTYZt",   // Harmonia Oasis
    tin_suoi:"1NphCE-4dlxp1yH75KsReRb3mVHWjEhLm",       // Suối Harmonia
    tin_cau:"1cQ27MhpEoFmEy2IwS1n2zlg38tBecFfa",        // Cầu cảnh quan
    tin_sunset:"1vMBSAAFCRSbO54ukZXNGb00kwJza8vbe",     // Cầu Sunset
    tin_lienhoan:"1q84tlArYgJ43LlxncFUeWpdRSDTW5qe4",   // Sân chơi liên hoàn
    tin_treem:"17l9n0lhnb6yU-xEfOtVRIHqzcqyBZFXq",      // Sân chơi trẻ em
    tin_lala:"18iJvj8u849qLIc0OFqA6Xgr2yaAcs0dB",       // Lala Camping BBQ
  
    tit_beboi:"1_Ind7zax8Ktst5ajRLzM6vZvSvlo5lyA",      // Tiện ích trong: bể bơi bốn mùa
    tit_gym:"1drPsXsFa_6WXGPNq0294wsoLW7kYnk0q",        // Gym, Yoga
    tit_gaming:"1ZPX2gWmL5qFasP4dUvPf9C3koVdOgi_b",     // Gaming Zone, Kid Cafe
    tit_learning:"1aaK6GSKebE6FEywPv4vGxv9Q-1Q6dvEJ",   // Learning Zone
    tit_sanhlavish:"1eXlRspe0i3nTg28BHhw8q1e-GjSlnCP6", // Sảnh Lavish
    tit_sanhseren:"16z7YiCQDjeA0r3NxcAiEfCCraTAnzO3M",  // Sảnh Seren
  },

  // ===== 7. CAROUSEL CÁC MỤC: thêm/bớt/sửa phần tử ở đây, carousel trên website tự sinh theo =====
  //   khóa ngoài cùng (cdt, vitri, ngoai, trong) trùng với data-cx trong index.html
  //   key: tên ảnh (trùng khóa trong "anh" ở trên) · tag: nhãn nhỏ · ten: tiêu đề · mota: giới thiệu ngắn
  carousels: {
      // Carousel chỉ có ảnh (không chữ chú thích). ratio = tỉ lệ khung ảnh ("rộng / cao", vd "3 / 4" cho ảnh đứng, "16 / 9" cho ảnh ngang).
      // fit: "contain" = hiện trọn ảnh, không bị cắt (hợp với giấy chứng nhận); bỏ dòng fit nếu muốn ảnh phủ kín khung như các carousel khác.
      edge: { alt: "Chứng nhận EDGE cấp độ 1", ratio: "4 / 3", fit: "contain", items: [
        { key: "edge1" }, { key: "edge2" }, { key: "edge3" }, { key: "edge4" }, { key: "edge5" }, { key: "edge6" }
      ] },
      cdt: { tieude: "Dự án tiêu biểu", items: [
        { key: "cdt_signature", tag: "Hà Nội", ten: "Hà Nội Signature", mota: "“Versailles giữa lòng Hà Nội” với mái vòm dát vàng, sảnh đá cẩm thạch nguyên khối và nội thất nhập khẩu châu Âu." },
        { key: "cdt_leroisoleil", tag: "Tây Hồ, Hà Nội", ten: "D'. Le Roi Soleil", mota: "Vị trí hiếm có bên Hồ Tây, phong cách kiến trúc Pháp cổ sang trọng, được người nước ngoài và Việt kiều yêu thích." },
        { key: "cdt_capitale", tag: "Trung Hòa, Hà Nội", ten: "D'. Capitale", mota: "Hợp tác cùng Vingroup, tổ hợp căn hộ cao cấp kết hợp trung tâm thương mại Vincom." },
        { key: "cdt_eldorado", tag: "Tây Hồ, Hà Nội", ten: "D'. El Dorado I & II", mota: "Cửa ngõ Hồ Tây, “mảnh đất vàng” cuối cùng với vị trí siêu hiếm và thiết kế sang trọng." },
        { key: "cdt_hatinh", tag: "Hà Tĩnh", ten: "D’ Metropole Hà Tĩnh", mota: "Dự án đầu tiên tại miền Trung, kiến trúc Pháp thanh lịch, không gian sống hiện đại, tiện ích đồng bộ." },
        { key: "cdt_phuquoc", tag: "Phú Quốc", ten: "D’ Thiên Bảo Phú Quốc", mota: "Dự án nghỉ dưỡng cao cấp ven biển đầu tiên của Tân Hoàng Minh tại đảo ngọc, hướng đến resort đẳng cấp quốc tế." },
        { key: "cdt_greenera", tag: "Ngọc Hồi, Hà Nội", ten: "Greenera Southmark", mota: "Dự án đầu tiên của Tân Hoàng Minh tại phía Nam Hà Nội, mang hơi thở sống xanh hiện đại." }
      ] },
      vitri: { tieude: "Kết nối & tiện ích xung quanh", items: [
        { key: "vt_ngochoi_ga", tag: "Ga Ngọc Hồi", ten: "Tổ hợp giao thông lớn nhất miền Bắc", mota: "Đầu mối giao thông trọng điểm quốc gia rộng hơn 250ha, nơi hội tụ của tuyến đường sắt tốc độ cao Bắc - Nam, đường sắt quốc gia và các tuyến Metro đô thị hiện đại." },
        { key: "vt_ngochoi_cau", tag: "Cầu Ngọc Hồi", ten: "Cây cầu kết nối liên vùng chiến lược", mota: "Công trình vượt sông Hồng nằm trên trục Vành đai 3.5, kết nối trực tiếp cửa ngõ phía Nam Hà Nội với Hưng Yên, mở ra không gian giao thương và phát triển bứt phá." },
        { key: "vt_ql1a", tag: "Quốc lộ 1A", ten: "Trục hạ tầng huyết mạch mở rộng", mota: "Tuyến giao thông trọng điểm cửa ngõ Thủ đô được nâng cấp mở rộng lên đến 90m với 16 làn xe, đảm bảo khả năng kết nối nhanh chóng, thông suốt vào trung tâm nội đô." },
        { key: "vt_olympic", tag: "Khu đô thị Olympic", ten: "Sân vận động & Đại đô thị thể thao", mota: "Quần thể đô thị sinh thái quy mô lớn sở hữu Sân vận động tiêu chuẩn quốc tế, tích hợp công viên xanh, hồ điều hòa cùng chuỗi tiện ích thể thao, giải trí đẳng cấp." }
      ]},
      ngoai: { tieude: "Điểm nhấn tiện ích ngoài trời", items: [
        { key: "tin_harmonia", tag: "Cảnh quan trung tâm", ten: "Harmonia Oasis – Ốc đảo trong thành phố", mota: "Giao hòa ánh sáng, gió và nước, điểm nhấn là “Tấm Gương Nước” – biểu tượng của sự tái tạo năng lượng sống." },
        { key: "tin_suoi", tag: "Tiện ích 11", ten: "Suối Harmonia", mota: "Dòng chảy cuộc sống tinh khiết." },
        { key: "tin_cau", tag: "Cảnh quan", ten: "Cầu cảnh quan", mota: "Trải nghiệm sống vươn tầm." },
        { key: "tin_sunset", tag: "Tiện ích 24", ten: "Cầu Sunset", mota: "Nối nhịp thời đại, kết nối tòa Lavish với hai tòa kế cận." },
        { key: "tin_lienhoan", tag: "Tiện ích 22", ten: "Sân chơi liên hoàn", mota: "Khu thể thao sân chơi liên hoàn, kết nối tòa Lavish và hai tòa kế cận." },
        { key: "tin_treem", tag: "Tiện ích 34", ten: "Sân chơi trẻ em", mota: "Thế giới tuổi thơ đầy màu sắc, không gian an toàn để các bé vui đùa và khám phá." },
        { key: "tin_lala", tag: "Tiện ích 20", ten: "Lala Camping BBQ", mota: "Nướng ngoài trời trong không gian xanh mát, gắn kết gia đình và bạn bè." }
      ] },
      trong: { tieude: "Điểm nhấn tiện ích trong nhà", items: [
        { key: "tit_beboi", tag: "Tiện ích 01", ten: "Bể bơi bốn mùa", mota: "Tiêu chuẩn nghỉ dưỡng 5 sao." },
        { key: "tit_gym", tag: "Tiện ích 02 · 05", ten: "Tổ hợp Gym, Aerobic & Yoga", mota: "Tổ hợp Gym, Yoga đạt chuẩn." },
        { key: "tit_gaming", tag: "Tiện ích 03 · 04", ten: "Gaming Zone & Kid Cafe", mota: "Không gian thưởng thức cafe kết hợp khu vui chơi." },
        { key: "tit_learning", tag: "Không gian học tập", ten: "Learning Zone – Sáng tạo & hợp tác", mota: "Thư viện hiện đại, khu tự học yên tĩnh và phòng họp thân thiện." },
        { key: "tit_sanhlavish", tag: "Tòa Lavish", ten: "Sảnh chính – Sang trọng & thời thượng", mota: "Cửa xoay tự động như khách sạn 5–6 sao, kính Low-E khổ lớn, lam nhôm Modern Luxury, 8 thang máy (1,5 căn/thang)." },
        { key: "tit_sanhseren", tag: "Tòa Seren", ten: "Sảnh đón khách – Riêng tư & thanh lịch", mota: "Khoảng đệm yên tĩnh với tông gỗ ấm áp, nội thất tối giản và những mảng xanh điểm xuyết." }
      ] }
  },

  // ===== 8. ẢNH BÓC MÁI: thêm/bớt dòng ở đây, tab và ảnh trên website tự sinh theo =====
  //   ten: "Tên căn | Trục căn hộ" · tag: nhãn nhỏ phía trên · id: ID file ảnh trên Google Drive (để "" thì dùng ảnh tạm)
  bocMai: {
    tieude: "Bóc mái căn hộ",
    ratio:  "4 / 5",
    items: [
      { ten: "SM2-2PN | Trục 09-10-11-12", tag: "Tòa Lavish · SM2", id: "1-Y7v-Y_bNZeRVeUU9cLf2Eubw8KWTKmo" },
      { ten: "SM2-3PN-Dualkey | Trục 01", tag: "Tòa Lavish · SM2", id: "1sjmuJBPgvtEtYqM85u9tktGIUFyp-Mlx" },
      { ten: "SM2-3PN-Sân vườn | Trục 08", tag: "Tòa Lavish · SM2", id: "1NNYo1Qjbq7xnyCEQghqUrTB3-r97mhQq" },
      { ten: "SM2-3PN-Thường | Trục 04-05", tag: "Tòa Lavish · SM2", id: "1hTZhh3EZd8agMpZMn1eu5LMlKTlsfgjr" },
      { ten: "SM2-4PN-Sân vườn | Trục 02-07", tag: "Tòa Lavish · SM2", id: "1fFs6uVMzPsWYjURbYKcOMMY3GhGEWYGH" },
      { ten: "SM2-4PN | Trục 03-06", tag: "Tòa Lavish · SM2", id: "1pA0YWAbO4VKp08irM0WorYtWxNqG5D1U" },
      { ten: "SM3-1PN | Trục 11-06", tag: "Tòa Seren · SM3", id: "1ewzR-TLEccNweGNvUUh-I0JEXx6jfVWt" },
      { ten: "SM3-2PN | Trục 02-03-08-09", tag: "Tòa Seren · SM3", id: "1VFz7Yzd1-iuw3gEKffvfFeFzwJxRJ2fx" },
      { ten: "SM3-2PNSV | Trục 12-05", tag: "Tòa Seren · SM3", id: "1QnexwpGS5mJGI57JmitnaAaR3tW_yLaJ" },
      { ten: "SM3-3PN | Trục 01-04", tag: "Tòa Seren · SM3", id: "1qBTtiKvwEukNucOnfchrF35k_Dq_gxLT" },
      { ten: "SM3-3PN | Trục 10-07", tag: "Tòa Seren · SM3", id: "1JdGez3GrBv7Wof-JAriqgkZDkYe1DMEp" }
    ]
  }
};

// ----- Từ đây trở xuống: không cần sửa -----
if (typeof document === "undefined") return; // Service Worker cũng đọc file này để lấy maApp/phienBan: chỉ cần phần cấu hình ở trên
// Áp dụng chế độ khảo sát ngay từ đầu để không bị nháy giao diện
var on = g.APP_CONFIG.khaoSatMacDinh !== false;
try { var v = localStorage.getItem("ap_survey" + (g.APP_CONFIG.maApp ? "_" + g.APP_CONFIG.maApp : "")); if (v === "1") on = true; else if (v === "0") on = false; } catch (e) {}
document.documentElement.classList.toggle("no-survey", !on);
})(typeof window !== "undefined" ? window : self);
