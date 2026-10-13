// Sau khi electron-builder ghi thông tin phiên bản vào Mail Lite.exe: đổi "File description" thành
// "Mail Lite by ngthhung" (mặc định electron-builder chỉ ghi tên sản phẩm) — giống bộ cài Setup.exe.
const fs = require('node:fs')
const path = require('node:path')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'win32') return
  const { NtExecutable, NtExecutableResource, Resource } = require('resedit')
  const file = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const exe = NtExecutable.from(fs.readFileSync(file))
  const res = NtExecutableResource.from(exe)
  const vi = Resource.VersionInfo.fromEntries(res.entries)[0]
  if (!vi) return
  for (const lang of vi.getAllLanguagesForStringValues()) {
    vi.setStringValues(lang, { FileDescription: context.packager.appInfo.description })
  }
  vi.outputToResourceEntries(res.entries)
  res.outputResource(exe)
  fs.writeFileSync(file, Buffer.from(exe.generate()))
}
