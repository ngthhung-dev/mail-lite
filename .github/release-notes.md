## Mail Lite 1.0.0

Ứng dụng đọc và gửi thư trên máy tính, giao diện kiểu Outlook classic — *Mail Lite by ngthhung*.

### Chọn tệp tải về

| Máy | Tệp |
|---|---|
| Windows 10/11 | `Mail-Lite-Setup-1.0.0.exe` (bản cài) — hoặc tệp `…-win.zip` chạy không cần cài |
| macOS chip Apple (M1 trở lên) | `Mail-Lite-1.0.0-mac-arm64.dmg` |
| macOS chip Intel | `Mail-Lite-1.0.0-mac-x64.dmg` |
| Linux Mint / Ubuntu | `Mail-Lite-1.0.0-amd64.deb` — hoặc `.AppImage` |
| Hướng dẫn sử dụng | `Mail-Lite-Huong-dan-su-dung.pdf` |

### Lưu ý khi cài
- **Windows:** nếu hiện "Windows protected your PC", bấm **More info → Run anyway** (ứng dụng chưa ký số).
- **macOS:** kéo Mail Lite vào Applications, rồi mở Terminal chạy `xattr -cr "/Applications/Mail Lite.app"`. Máy chip Apple nếu báo "damaged" thì chạy thêm `codesign --force --deep --sign - "/Applications/Mail Lite.app"`.
- **Linux:** `sudo apt install ./Mail-Lite-1.0.0-amd64.deb`
- Cài đè lên bản cũ không mất thư và tài khoản.
