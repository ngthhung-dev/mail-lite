# Quy ước dự án Mail Lite (đọc trước khi làm việc)

Người dùng: ngthhung — trả lời bằng tiếng Việt, ngắn gọn, đủ ý.

## Thông tin tác giả
- Mọi nơi ghi tác giả: **ngthhung**; mô tả sản phẩm: **Mail Lite by ngthhung**; bản quyền: **Copyright © <năm> ngthhung**.
- Tệp .exe (Setup và Mail Lite.exe): File description = "Mail Lite by ngthhung", Copyright = "Copyright © <năm> ngthhung", Company = ngthhung (xem `electron-builder.config.cjs`, `build/after-sign.cjs`).
- Email **ngthhung.dev@gmail.com** và điện thoại **0968 799 365** chỉ hiện TRONG ỨNG DỤNG (Trợ giúp → Giới thiệu) và tài liệu hướng dẫn PDF.
- **KHÔNG ghi email / số điện thoại trên trang Release GitHub** (`.github/release-notes.md`).

## Build & phát hành (GitHub Actions, repo ngthhung-dev/mail-lite)
- Phiên bản lấy từ `package.json` (hiện 1.0.0). Số build tự tăng mỗi lần chạy workflow "Build bản cài" (= run_number − `BUILD_BASE`).
- Tag `v<phiên bản>-build<số>`, tiêu đề `Mail Lite <phiên bản> (build <số>)`.
- Tệp: `Mail-Lite-<pb>-build<n>-Setup.exe`, `…-macOS-AppleSilicon.pkg`, `…-macOS-Intel.pkg`, `mail-lite_<pb>-build<n>_amd64.deb`.
- Mỗi lần build tạo một Release mới (Latest). "Dọn Release cũ" chỉ chạy khi người dùng yêu cầu: xoá Release/tag cũ, Artifacts, lịch sử chạy; giữ Release mới nhất.
- Sửa nội dung trang Release không cần build lại: sửa `.github/release-notes.md` rồi chạy workflow "Cập nhật ghi chú Release".
- Commit bằng tác giả Claude <noreply@anthropic.com>.

## Kiểm thử trước khi build
- `npm run typecheck`, `npm test` (lõi), `npm run build && node test/e2e.cjs` (cần `node --experimental-strip-types test/demo-server.ts` chạy song song, dưới xvfb).
- Tài liệu: `docs/huong-dan-su-dung.html` → `node docs/build-pdf.cjs && python3 docs/pdf-outline.py docs/Mail-Lite-Huong-dan-su-dung.pdf`.
