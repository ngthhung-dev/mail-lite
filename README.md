# Mail Lite

*Mail Lite by ngthhung*

Ứng dụng duyệt mail trên máy tính (Windows / macOS / Linux): thêm nhiều tài khoản (Gmail, Microsoft 365, mail công ty IMAP/SMTP), đồng bộ thư về máy để đọc offline, quản lý và trả lời thư với giao diện kiểu Outlook classic.

Công nghệ: Electron + React + TypeScript, lưu trữ SQLite (có sẵn trong Node, không cần biên dịch module native).

## Chạy thử

Cần Node.js 22 trở lên.

```bash
npm install
npm run dev        # chạy ở chế độ phát triển
```

Đóng gói bản cài đặt (chạy trên đúng hệ điều hành muốn đóng gói):

```bash
npm run dist:win     # Windows  → release/*.exe
npm run dist:mac     # macOS    → release/*.dmg
npm run dist:linux   # Linux    → release/*.AppImage, *.deb
```

Bản đóng gói chưa ký số, nên Windows SmartScreen / macOS Gatekeeper sẽ cảnh báo ở lần mở đầu. Biểu tượng nằm trong `resources/`; đóng gói bản Windows trên chính máy Windows thì tệp `.exe` cũng mang biểu tượng và tên Mail Lite.

### Build tự động trên GitHub

Tab **Actions → Build bản cài → Run workflow** (`.github/workflows/build.yml`): build trên máy chủ GitHub rồi tự phát hành lên trang **Releases**, theo quy ước:

| | Mẫu |
|---|---|
| Tag | `v1.0.0-build4` |
| Tiêu đề | `Mail Lite 1.0.0 (build 4)` |
| Windows | `Mail-Lite-1.0.0-build4-Setup.exe` |
| macOS chip Apple / Intel | `Mail-Lite-1.0.0-build4-macOS-AppleSilicon.pkg` / `…-macOS-Intel.pkg` |
| Linux | `mail-lite_1.0.0-build4_amd64.deb` |

Số build = số thứ tự lần chạy workflow (tự tăng); phiên bản lấy từ `package.json`. Nội dung trang Release ở `.github/release-notes.md`.

### Thử không cần tài khoản thật

```bash
node --experimental-strip-types test/demo-server.ts   # máy chủ IMAP/SMTP giả lập có sẵn thư mẫu
npm run dev
```

Thêm tài khoản: email `testuser@example.com`, mật khẩu `testpass`, mở "Cấu hình máy chủ thủ công" → IMAP `127.0.0.1` cổng `11143` STARTTLS, SMTP `127.0.0.1` cổng `11025` STARTTLS, tên đăng nhập `testuser`.

## Hướng dẫn sử dụng

Tài liệu cho người dùng cuối (có ảnh minh hoạ): `docs/Mail-Lite-Huong-dan-su-dung.pdf`, nguồn ở `docs/huong-dan-su-dung.html`.
Chụp lại ảnh và xuất lại PDF sau khi đổi giao diện:

```bash
node --experimental-strip-types test/demo-server.ts   # cửa sổ khác
npm run build && node docs/shots.cjs && node docs/build-pdf.cjs && python3 docs/pdf-outline.py docs/Mail-Lite-Huong-dan-su-dung.pdf
```

## Thêm tài khoản thật

| Loại | Cách đăng nhập |
|---|---|
| Mail công ty (cPanel, Zimbra, Zoho, hosting…) | Email + mật khẩu. App tự đoán máy chủ theo tên miền và bản ghi MX; nếu sai thì nhập tay IMAP/SMTP do IT cung cấp. |
| Gmail / Google Workspace | Nhanh nhất: bật xác minh 2 bước → tạo **Mật khẩu ứng dụng** → đăng nhập bằng mật khẩu đó. Hoặc đăng nhập Google (OAuth) sau khi khai báo Client ID trong Cài đặt → Đăng nhập OAuth. |
| Microsoft 365 / Outlook.com | Microsoft đã tắt đăng nhập bằng mật khẩu thường → bắt buộc OAuth: đăng ký ứng dụng trên Entra, dán Client ID vào Cài đặt → Đăng nhập OAuth (có hướng dẫn từng bước trong app). |
| Yahoo, iCloud | Email + mật khẩu ứng dụng. |

## Tính năng

- **Nhiều tài khoản**, hộp thư gộp "Tất cả hộp thư đến", thư chưa đọc, thư gắn cờ.
- **Đồng bộ offline**: tiêu đề + nội dung + tệp .eml gốc lưu về máy; mất mạng vẫn đọc, tìm, và thao tác (thao tác được xếp hàng, tự đẩy lên khi có mạng). Chọn phạm vi 30 ngày / 3 tháng / 1 năm / toàn bộ.
- **Thư mới tức thời** qua IMAP IDLE, cộng với Gửi/Nhận định kỳ; thông báo hệ thống.
- **Soạn / Trả lời / Trả lời tất cả / Chuyển tiếp**: đính kèm, Cc/Bcc, chữ ký theo tài khoản, mức quan trọng, yêu cầu báo đã đọc, lưu nháp, gợi ý người nhận.
- **Định dạng nội dung** (dùng chung cho soạn thư, mẫu Trộn thư và chữ ký): phông chữ, cỡ chữ theo pt, kiểu đoạn (tiêu đề 1–3, trích dẫn, chữ đều), đậm/nghiêng/gạch chân/gạch ngang, chỉ số trên/dưới, màu chữ, tô sáng, danh sách chấm/số, thụt lề, căn trái/giữa/phải/đều, liên kết (`Ctrl+K`), chèn ảnh vào nội dung và đổi cỡ ảnh, bảng (thêm/xoá dòng cột, `Tab` sang ô kế), đường kẻ ngang, hoàn tác/làm lại, xoá định dạng. Nút trên thanh công cụ sáng theo định dạng tại con trỏ. Thư gửi đi kèm phông mặc định Segoe UI 11pt để người nhận thấy giống lúc soạn.
- **Quản lý**: đã đọc/chưa đọc, gắn cờ, phân loại màu, chuyển thư mục (kể cả kéo-thả), lưu trữ, thư rác, xoá; tạo/đổi tên/xoá thư mục; dọn thùng rác.
- **Trộn thư (gửi hàng loạt từ Excel)**: chọn tệp `.xlsx`/`.csv`, soạn mẫu có trường `{{Tên cột}}`, xem trước từng người, gửi thử cho mình, rồi gửi mỗi người một thư riêng — có tệp đính kèm riêng theo từng dòng, giãn cách giữa các thư, dừng giữa chừng, gửi lại dòng lỗi và xuất báo cáo. Xem mục "Trộn thư" bên dưới.
- **Hoàn tác gửi**: thư được giữ lại 10 giây (chỉnh 5–60 giây hoặc tắt trong Cài đặt → Chung) trước khi gửi thật; trong lúc đó bấm **Hoàn tác** để lấy lại thư gửi nhầm. Thư đã rời máy thì không thu hồi được — đây là giới hạn của email nói chung (tính năng Recall của Outlook chỉ hoạt động trong cùng một hệ thống Exchange).
- **Gom theo hội thoại** (bật/tắt ở thẻ Xem): thư gốc và các thư trả lời gom thành một dòng có số đếm; mở ra thấy cả chuỗi, kể cả thư mình đã gửi nằm ở Thư đã gửi. Thao tác (xoá, chuyển, đánh dấu) vẫn áp dụng cho từng thư đang chọn, không phải cả cuộc.
- **Nút nhanh trên từng dòng** khi rê chuột: đã đọc/chưa đọc, ghim, gắn cờ; thư có tệp đính kèm hiện biểu tượng kẹp giấy.
- **Ghim hội thoại**: ghim một thư là ghim cả chuỗi trả lời của nó lên đầu danh sách; thư trả lời mới về tự ghim theo. Ghim chỉ lưu trên máy.
- **Xoá nhanh cả thư mục**: nút "Xoá tất cả…" — Hộp thư đến và thư mục thường chuyển hết vào Thùng rác, Thư rác/Thùng rác xoá vĩnh viễn; áp dụng cho toàn bộ thư trên máy chủ, kể cả thư cũ chưa đồng bộ về máy.
- **Kéo đổi kích thước** cây thư mục, danh sách thư và ngăn đọc — cả chiều rộng (ngăn đọc bên phải) lẫn chiều cao (ngăn đọc bên dưới); nhấp đúp vào thanh kéo để về mặc định; kích thước được ghi nhớ.
- **Cửa sổ đọc thư**: nhấp đúp vào thư (hoặc Enter) để mở thư trong cửa sổ riêng, phóng to được — tiện nhất khi tắt ngăn đọc. Khi ngăn đọc tắt, chỉ chọn thư thì chưa tính là đã đọc.
- **Đổi nơi lưu dữ liệu** (Cài đặt → Dữ liệu): chép toàn bộ thư, tài khoản, cài đặt sang thư mục/ổ đĩa khác rồi khởi động lại.
- **Tìm kiếm**: ô tìm nằm ngay trên danh sách thư (`Ctrl+E`), tìm toàn văn (SQLite FTS5), gõ không dấu vẫn ra tiếng Việt có dấu. **Tìm kiếm nâng cao** (nút bên phải ô tìm): phạm vi (thư mục hiện tại, tất cả thư, hộp thư đến, đã gắn cờ, đã gửi, nháp, thư rác, thùng rác, tất cả kể cả rác, đã đọc, chưa đọc), người gửi, đến, Cc, chủ đề, có các từ, không có từ, khoảng ngày, kích thước, trạng thái đọc, có tệp đính kèm, đã gắn cờ. Tìm nhanh chỉ tìm trong thẻ đang chọn (Tất cả / Chưa đọc / Có cờ / Có tệp). Tìm trên thư đã đồng bộ về máy.
- **Quy tắc** tự xử lý thư đến (chuyển thư mục, chuyển tiếp tới địa chỉ khác, đánh dấu, phân loại, xoá).
- **Lịch** (tháng, nhắc việc) và **Danh bạ** (tự thu thập người nhận) lưu trên máy.
- **Xuất dữ liệu**: từng thư ra .eml, cả thư mục ra .mbox.
- Giao diện sáng/tối, ngăn đọc phải/dưới/tắt, phím tắt kiểu Outlook.

### Trộn thư

Nút **Trộn thư** trên thẻ Trang chủ (hoặc `Ctrl+Shift+M`). Tệp dữ liệu cần dòng đầu là tiêu đề cột, mỗi dòng sau là một người nhận:

| Họ tên | Email | Công ty | Số tiền | Tệp |
|---|---|---|---|---|
| Trần Thị Mai | mai@congty.vn | Công ty A | 15.500.000 | hoa-don\mai.pdf |
| Lê Nam | nam@doitac.vn; ketoan@doitac.vn | Kho vận Nam | 8.200.000 | |

- Trong chủ đề và nội dung, gõ `{{Họ tên}}`, `{{Số tiền}}`… (hoặc bấm tên cột để chèn). Không phân biệt hoa thường.
- Số, ngày, phần trăm hiển thị như trong Excel (15.500.000 · 15/10/2026 · 12,5%); ô công thức lấy kết quả.
- Một ô email có thể chứa nhiều địa chỉ cách nhau bằng `;` — những người đó nhận chung một thư.
- Cột tệp đính kèm (tuỳ chọn): đường dẫn tuyệt đối, hoặc tương đối so với thư mục chứa tệp Excel; nhiều tệp cách nhau bằng `;`.
- Trước khi gửi, app rà cả danh sách: dòng thiếu email (bỏ qua), email sai hoặc thiếu tệp (báo lỗi, không gửi), trường trong mẫu không khớp cột nào (chặn gửi).
- Đợt gửi chạy nền; nếu 5 thư liên tiếp bị máy chủ từ chối thì tự dừng. Tối đa 5.000 dòng mỗi đợt.
- **Gửi tiếp**: đợt gửi được lưu xuống đĩa. Dù bạn bấm Dừng, app tự dừng vì lỗi, hay thoát app / tắt máy giữa chừng, lần sau mở lại sẽ có nhắc ở thanh trạng thái; bấm **Tiếp tục gửi** để gửi đúng các dòng còn lại — người đã nhận không bị gửi trùng. Nếu app bị tắt đột ngột đúng lúc đang gửi một thư, dòng đó được đánh dấu "không rõ" và không tự gửi lại (kiểm tra Thư đã gửi rồi quyết định). Gửi tiếp dùng dữ liệu đã đọc lúc bắt đầu đợt, không đọc lại tệp Excel.
- Lưu ý giới hạn của nhà cung cấp mail (số thư/ngày, số thư/phút) — hãy hỏi IT hoặc xem tài liệu của nhà cung cấp trước khi gửi số lượng lớn. Chưa hỗ trợ tệp `.xls` cũ (lưu lại thành `.xlsx`).

### Phím tắt

`Ctrl+N` thư mới · `Ctrl+R` trả lời · `Ctrl+Shift+R` trả lời tất cả · `Ctrl+F` chuyển tiếp · `Delete` xoá · `Ctrl+Q` / `Ctrl+U` đã đọc / chưa đọc · `Insert` gắn cờ · `Ctrl+Shift+V` chuyển thư mục · `Ctrl+E` tìm · `F9` Gửi/Nhận · `Ctrl+Enter` gửi · `Ctrl+S` lưu nháp · `Ctrl+Shift+M` trộn thư · `Ctrl+1/2/3` Thư / Lịch / Danh bạ.

## Bảo mật

- Mật khẩu và token OAuth được mã hoá bằng kho khoá hệ điều hành (Windows DPAPI, macOS Keychain, Linux Secret Service) qua `safeStorage`.
- Nội dung thư HTML được lọc bằng DOMPurify, hiển thị trong iframe sandbox không chạy script, có CSP riêng; ảnh từ xa bị chặn mặc định (chống theo dõi mở thư).
- Giao diện chạy với `contextIsolation` + `sandbox`, chỉ gọi được danh sách hàm IPC cho phép; liên kết luôn mở bằng trình duyệt hệ thống.

## Chưa có (so với Outlook classic)

- Giao thức Exchange/MAPI/EWS, POP3 — chỉ hỗ trợ IMAP + SMTP.
- Đồng bộ lịch/danh bạ với máy chủ (CalDAV/CardDAV/Exchange), lời mời họp — lịch và danh bạ hiện chỉ lưu cục bộ.
- Tệp PST/OST — dùng .eml/.mbox thay thế.
- In thư, chuyển thư giữa hai tài khoản, hộp thư đi (gửi khi offline).
- Các tính năng soạn thảo của Word trong Outlook: Styles, WordArt/SmartArt, biểu đồ, gộp/tách ô bảng, kéo chuột đổi cỡ ảnh.
- Kiểm tra chính tả, S/MIME/PGP, tự động cập nhật.

## Cấu trúc mã

```
src/main/        tiến trình chính (Node)
  engine.ts      điều phối: tài khoản, gửi thư, trộn thư, quy tắc, xuất dữ liệu
  merge.ts       đọc tệp Excel/CSV cho trộn thư
  imap.ts        đồng bộ IMAP từng tài khoản (imapflow), hàng đợi thao tác
  store.ts       SQLite + chỉ mục tìm kiếm
  oauth.ts       đăng nhập Google/Microsoft (PKCE, cổng loopback)
  presets.ts     nhận diện máy chủ theo tên miền / MX
  index.ts       cửa sổ Electron, IPC, menu, thông báo
src/preload/     cầu nối IPC
src/renderer/    giao diện React
src/shared/      kiểu dữ liệu dùng chung
test/            kiểm thử lõi + kịch bản chạy ứng dụng thật với máy chủ giả lập
```

## Kiểm thử

```bash
npm run typecheck
npm test                 # 42 kiểm thử phần lõi trên máy chủ IMAP/SMTP giả lập
npm run build && node test/e2e.cjs   # chạy app Electron thật (cần máy chủ demo đang chạy)
```
