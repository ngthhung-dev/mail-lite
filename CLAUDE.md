# Quy ước dự án Mail Lite (đọc trước khi làm việc)

Người dùng: ngthhung — trả lời bằng tiếng Việt, ngắn gọn, đủ ý.

## Thông tin tác giả
- Mọi nơi ghi tác giả: **ngthhung**; mô tả sản phẩm: **Mail Lite by ngthhung**; bản quyền: **Copyright © <năm> ngthhung**.
- Tệp .exe (Setup và Mail Lite.exe): File description = "Mail Lite by ngthhung", Copyright = "Copyright © <năm> ngthhung", Company = ngthhung (xem `electron-builder.config.cjs`, `build/after-sign.cjs`).
- Email **ngthhung.dev@gmail.com** và điện thoại **0968 799 365** chỉ hiện TRONG ỨNG DỤNG (Trợ giúp → Giới thiệu) và tài liệu hướng dẫn PDF.
- **KHÔNG ghi email / số điện thoại trên trang Release GitHub** (`.github/release-notes.md`).

## Build & phát hành (GitHub Actions, repo ngthhung-dev/mail-lite)
- Phiên bản tự tăng mỗi lần chạy workflow "Build bản cài", tính từ tag gần nhất: 1.0.1 → … → 1.0.99 → 1.1.0 → … → 1.99.99 → 2.0.0 (không còn số build). Có thể tự nhập phiên bản khi chạy. Workflow truyền phiên bản qua `APP_VERSION` để gắn vào ứng dụng và tên tệp; `package.json` giữ 1.0.0 cho lúc chạy thử trên máy.
- Tag `v<phiên bản>`, tiêu đề `Mail Lite <phiên bản>`.
- Tệp: `Mail-Lite-<pb>-Setup.exe`, `…-macOS-AppleSilicon.pkg`, `…-macOS-Intel.pkg`, `mail-lite_<pb>_amd64.deb`.
- Mỗi lần build tạo một Release mới (Latest). "Dọn Release cũ" chỉ chạy khi người dùng yêu cầu: xoá Release/tag cũ, Artifacts, lịch sử chạy; giữ Release mới nhất.
- Sửa nội dung trang Release không cần build lại: sửa `.github/release-notes.md` rồi chạy workflow "Cập nhật ghi chú Release".
- Reset phiên bản: chạy "Dọn Release cũ" với `xoa_tat_ca=true` (hết tag thì bản kế tiếp là 1.0.1), hoặc nhập phiên bản khi chạy build.
- Bộ cài Windows giao diện tiếng Việt (`nsis.installerLanguages: vi_VN`, bản dịch bổ sung ở `build/nsis-vi.cjs`).
- Commit bằng tác giả Claude <noreply@anthropic.com>.

## Kiểm thử trước khi build
- `npm run typecheck`, `npm test` (lõi), `npm run build && node test/e2e.cjs` (cần `node --experimental-strip-types test/demo-server.ts` chạy song song, dưới xvfb).
- Tài liệu: `docs/huong-dan-su-dung.html` → `node docs/build-pdf.cjs && python3 docs/pdf-outline.py docs/Mail-Lite-Huong-dan-su-dung.pdf`.
