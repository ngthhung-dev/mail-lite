// Cấu hình đóng gói (electron-builder).
const config = {
  "appId": "app.maillite.desktop",
  "productName": "Mail Lite",
  "files": [
    "out/**/*",
    "resources/**/*",
    "package.json"
  ],
  "directories": {
    "output": "release"
  },
  "win": {
    "target": [
      {
        "target": "nsis",
        "arch": [
          "x64"
        ]
      },
      {
        "target": "zip",
        "arch": [
          "x64"
        ]
      }
    ],
    "icon": "resources/icon.ico"
  },
  "mac": {
    "target": [
      "dmg",
      "zip"
    ],
    "category": "public.app-category.productivity",
    "artifactName": "Mail-Lite-${version}-mac-${arch}.${ext}"
  },
  "linux": {
    "target": [
      "AppImage",
      "deb"
    ],
    "category": "Office",
    "icon": "resources/icon-512.png",
    "executableName": "mail-lite",
    "maintainer": "ngthhung <ngthhung@localhost>",
    "synopsis": "Mail Lite by ngthhung",
    "artifactName": "Mail-Lite-${version}-${arch}.${ext}"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "shortcutName": "Mail Lite",
    "artifactName": "Mail-Lite-Setup-${version}.${ext}"
  },
  "compression": "maximum",
  "electronLanguages": [
    "en-US",
    "vi"
  ],
  "icon": "resources/icon-512.png"
}

// Gắn biểu tượng + tên "Mail Lite" vào tệp .exe cần công cụ chỉ chạy được trên Windows (hoặc Linux có wine).
// Khi đóng gói bản Windows từ Linux không có wine thì bỏ qua bước đó; ứng dụng vẫn tự đặt tên và biểu tượng
// cho cửa sổ, thanh tác vụ và thông báo lúc chạy (xem src/main/index.ts).
config.win.signAndEditExecutable = process.platform === 'win32' || process.env.MAILLITE_EDIT_EXE === '1'

// Không phát hành/tự cập nhật qua máy chủ nào → không tạo tệp mô tả bản cập nhật
config.publish = null

// Gói .deb bắt buộc có trang chủ. Chưa có trang thật nên dùng tên miền dành riêng ".invalid" (không bao giờ trỏ đi đâu);
// khi có trang chủ thật thì sửa ở đây.
config.extraMetadata = { homepage: 'https://maillite.invalid' }

module.exports = config
