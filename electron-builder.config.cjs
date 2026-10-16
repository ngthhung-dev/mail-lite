// Cấu hình đóng gói (electron-builder).
const config = {
  "appId": "app.maillite.desktop",
  "productName": "Mail Lite",
  "files": [
    "out/**/*",
    "resources/**/*",
    "docs/Mail-Lite-Huong-dan-su-dung.pdf",
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
    "maintainer": "ngthhung <ngthhung.dev@gmail.com>",
    "vendor": "ngthhung <ngthhung.dev@gmail.com>",
    "synopsis": "Mail Lite by ngthhung",
    "artifactName": "Mail-Lite-${version}-${arch}.${ext}"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "shortcutName": "Mail Lite",
    "artifactName": "Mail-Lite-Setup-${version}.${ext}",
    "installerLanguages": [
      "vi_VN"
    ],
    "language": "1066"
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

// Bộ cài Windows hiển thị tiếng Việt (bổ sung bản dịch còn thiếu của electron-builder)
require('./build/nsis-vi.cjs').patchNsisVietnamese()

// Không phát hành/tự cập nhật qua máy chủ nào → không tạo tệp mô tả bản cập nhật
config.publish = null

// Thông tin tác giả gắn vào bộ cài và tệp chạy (Windows: Details → Copyright / Company; macOS: Info.plist; Linux: .deb)
config.copyright = `Copyright © ${new Date().getFullYear()} ngthhung`
// tệp chạy Mail Lite.exe cũng ghi "Mail Lite by ngthhung" ở mục File description
config.afterSign = 'build/after-sign.cjs'

// Khi build trên GitHub, workflow tính phiên bản kế tiếp (1.0.1, 1.0.2…) và truyền qua APP_VERSION:
// gắn vào ứng dụng (thay cho package.json) và tên tệp
//   Mail-Lite-1.0.1-Setup.exe · Mail-Lite-1.0.1-macOS-AppleSilicon.pkg
//   Mail-Lite-1.0.1-macOS-Intel.pkg · mail-lite_1.0.1_amd64.deb
if (process.env.APP_VERSION) {
  const v = process.env.APP_VERSION
  config.extraMetadata = { ...(config.extraMetadata || {}), version: v }
  config.nsis.artifactName = `Mail-Lite-${v}-Setup.\${ext}`
  config.mac.artifactName = `Mail-Lite-${v}-macOS-${process.env.MAC_LABEL || '${arch}'}.\${ext}`
  config.deb = { artifactName: `mail-lite_${v}_amd64.deb` }
}

// macOS: chưa có chứng chỉ Apple → ký ad-hoc để máy chip Apple chạy được (không báo "damaged")
config.mac.identity = process.env.CSC_NAME || '-'
// ký ad-hoc + hardened runtime sẽ chặn thư viện Electron đã ký sẵn → tắt khi không có chứng chỉ thật
if (!process.env.CSC_NAME) config.mac.hardenedRuntime = false

module.exports = config
