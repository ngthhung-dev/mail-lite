// Bổ sung tiếng Việt cho các câu thông báo của bộ cài Windows (NSIS).
// electron-builder chỉ có sẵn bản dịch tiếng Việt cho 1 câu; các câu còn lại sẽ hiện tiếng Anh.
// Tệp này ghi thêm khoá "vi" vào mẫu messages.yml / assistedMessages.yml của electron-builder
// (gọi từ electron-builder.config.cjs trước khi đóng gói; chạy lại nhiều lần vẫn an toàn).
const fs = require('node:fs')
const path = require('node:path')

const VI = {
  'messages.yml': {
    win7Required: 'Cần Windows 7 trở lên',
    x64WinRequired: 'Cần Windows 64-bit',
    appRunning: '${PRODUCT_NAME} đang chạy.\nBấm OK để đóng ứng dụng.\nNếu không đóng được, vui lòng tự đóng ứng dụng.',
    appCannotBeClosed: 'Không thể đóng ${PRODUCT_NAME}.\nVui lòng tự đóng ứng dụng rồi bấm Thử lại để tiếp tục.',
    installing: 'Đang cài đặt, vui lòng chờ...',
    areYouSureToUninstall: 'Bạn có chắc muốn gỡ cài đặt ${PRODUCT_NAME}?',
    decompressionFailed: 'Không giải nén được tệp. Vui lòng chạy lại bộ cài.',
    uninstallFailed: 'Không gỡ được tệp của phiên bản cũ. Vui lòng chạy lại bộ cài.',
    appClosing: 'Đang đóng ${PRODUCT_NAME}...'
  },
  'assistedMessages.yml': {
    chooseInstallationOptions: 'Chọn tuỳ chọn cài đặt',
    chooseUninstallationOptions: 'Chọn tuỳ chọn gỡ cài đặt',
    whichInstallationShouldBeRemoved: 'Bạn muốn gỡ bản cài đặt nào?',
    whoShouldThisApplicationBeInstalledFor: 'Cài ứng dụng này cho ai?',
    selectUserMode: 'Chọn cài cho mọi người dùng trên máy hay chỉ cho riêng bạn',
    whichInstallationRemove: 'Phần mềm này đang được cài cho cả máy (mọi người dùng) và cho riêng người dùng.\\nBạn muốn gỡ bản cài đặt nào?',
    freshInstallForAll: 'Cài mới cho mọi người dùng (sẽ hỏi quyền quản trị).',
    freshInstallForCurrent: 'Cài mới chỉ cho người dùng hiện tại.',
    onlyForMe: 'Chỉ cho &tôi',
    forAll: 'Mọi người dùng máy tính này (&tất cả người dùng)',
    loginWithAdminAccount: 'Bạn cần đăng nhập bằng tài khoản quản trị (Administrator) để tiếp tục...',
    perUserInstallExists: 'Đã có bản cài cho riêng người dùng.',
    perUserInstall: 'Có bản cài cho riêng người dùng.',
    perMachineInstallExists: 'Đã có bản cài cho cả máy.',
    perMachineInstall: 'Có bản cài cho cả máy.',
    reinstallUpgrade: 'Sẽ cài lại / nâng cấp.',
    uninstall: 'Sẽ gỡ cài đặt.'
  }
}

function patchNsisVietnamese() {
  const yaml = require(require.resolve('js-yaml', { paths: [require.resolve('app-builder-lib/package.json')] }))
  const dir = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates', 'nsis')
  for (const [file, strings] of Object.entries(VI)) {
    const p = path.join(dir, file)
    const data = yaml.load(fs.readFileSync(p, 'utf8'))
    let changed = false
    for (const [key, vi] of Object.entries(strings)) {
      if (!data[key]) continue
      if (data[key].vi !== vi) {
        data[key].vi = vi
        changed = true
      }
    }
    if (changed) fs.writeFileSync(p, yaml.dump(data, { lineWidth: -1 }))
  }
}

module.exports = { patchNsisVietnamese }
