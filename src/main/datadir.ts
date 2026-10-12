import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

// Vị trí lưu dữ liệu do người dùng chọn được ghi trong config.json ở thư mục cấu hình của ứng dụng
// (thư mục này luôn cố định, nên lần mở sau vẫn tìm ra dữ liệu dù đã chuyển sang ổ khác).

export const DB_FILE = 'maillite.db'

export function configPath(userData: string): string {
  return path.join(userData, 'config.json')
}
export function readConfig(userData: string): { dataDir?: string } {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(userData), 'utf8'))
    return c && typeof c === 'object' ? c : {}
  } catch {
    return {}
  }
}
export function writeConfig(userData: string, cfg: { dataDir?: string }): void {
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(configPath(userData), JSON.stringify(cfg, null, 2))
}

export function defaultDataDir(userData: string): string {
  return path.join(userData, 'data')
}
/** Thứ tự ưu tiên: biến môi trường (dùng khi kiểm thử) → vị trí người dùng chọn → mặc định. */
export function resolveDataDir(userData: string, env?: string): { dir: string; custom: boolean } {
  if (env) return { dir: path.resolve(env), custom: true }
  const c = readConfig(userData).dataDir
  if (c && path.resolve(c) !== path.resolve(defaultDataDir(userData))) return { dir: path.resolve(c), custom: true }
  return { dir: defaultDataDir(userData), custom: false }
}

export function hasData(dir: string): boolean {
  return fs.existsSync(path.join(dir, DB_FILE))
}
export function isEmptyDir(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length === 0
  } catch {
    return true
  }
}
export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Chọn thư mục đích từ thư mục người dùng trỏ tới: thư mục trống hoặc đã có dữ liệu Mail Lite thì dùng luôn,
 * còn thư mục đang chứa thứ khác (vd. D:\) thì tạo thư mục con để không trộn lẫn.
 */
export function planTarget(chosen: string): { target: string; existing: boolean } {
  if (hasData(chosen)) return { target: chosen, existing: true }
  if (isEmptyDir(chosen)) return { target: chosen, existing: false }
  const sub = path.join(chosen, 'Mail Lite Data')
  if (hasData(sub)) return { target: sub, existing: true }
  if (!isEmptyDir(sub)) throw new Error(`Thư mục “${sub}” đã có tệp khác. Hãy chọn một thư mục trống.`)
  return { target: sub, existing: false }
}

async function count(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      const c = await count(p)
      files += c.files
      bytes += c.bytes
    } else if (e.isFile()) {
      files++
      bytes += (await fsp.stat(p)).size
    }
  }
  return { files, bytes }
}

/** Chép toàn bộ dữ liệu sang vị trí mới và đối chiếu số tệp + dung lượng trước khi coi là thành công. */
export async function copyData(from: string, to: string): Promise<{ files: number; bytes: number }> {
  if (isInside(to, from)) throw new Error('Không thể chuyển dữ liệu vào bên trong chính thư mục dữ liệu hiện tại.')
  await fsp.mkdir(to, { recursive: true })
  await fsp.cp(from, to, { recursive: true, force: true })
  const [a, b] = await Promise.all([count(from), count(to)])
  if (b.files < a.files || b.bytes < a.bytes) {
    throw new Error(`Chép dữ liệu chưa đủ (${b.files}/${a.files} tệp). Kiểm tra dung lượng trống của ổ đĩa đích.`)
  }
  return a
}
