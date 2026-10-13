// Sao lưu / khôi phục toàn bộ dữ liệu Mail Lite vào MỘT tệp (.mlbackup = tar nén gzip).
// Không phụ thuộc Electron để kiểm thử được bằng Node thường.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import * as tar from 'tar'
import { DB_FILE } from './datadir.ts'

export const BACKUP_EXT = 'mlbackup'
const MANIFEST = 'mail-lite-backup.json'
const SNAPSHOT = 'mail-lite-backup.db'

export interface BackupManifest {
  app: 'Mail Lite'
  format: 1
  version: string
  build: string
  createdAt: number
  platform: string
  accounts: string[]
  files: number
  bytes: number
}

/** Tệp không đưa vào bản sao lưu: CSDL đang mở (thay bằng bản chụp nhất quán) và tệp tạm của SQLite. */
const SKIP = new Set([DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`, `${DB_FILE}-journal`, MANIFEST, SNAPSHOT])

async function walk(dir: string, rel = ''): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  for (const e of await fsp.readdir(path.join(dir, rel), { withFileTypes: true })) {
    if (!rel && SKIP.has(e.name)) continue
    const r = path.join(rel, e.name)
    if (e.isDirectory()) {
      const c = await walk(dir, r)
      files += c.files
      bytes += c.bytes
    } else if (e.isFile()) {
      files++
      bytes += (await fsp.stat(path.join(dir, r))).size
    }
  }
  return { files, bytes }
}

/**
 * Tạo tệp sao lưu từ thư mục dữ liệu đang dùng.
 * snapshotDb(đường dẫn) phải ghi ra một bản chụp nhất quán của CSDL (VACUUM INTO) — chạy được khi app đang mở.
 */
export async function createBackup(
  dataDir: string,
  outFile: string,
  info: Omit<BackupManifest, 'app' | 'format' | 'createdAt' | 'files' | 'bytes'>,
  snapshotDb: (file: string) => void
): Promise<BackupManifest> {
  const snap = path.join(dataDir, SNAPSHOT)
  const man = path.join(dataDir, MANIFEST)
  const tmpOut = `${outFile}.dang-ghi`
  try {
    fs.rmSync(snap, { force: true })
    snapshotDb(snap)
    const c = await walk(dataDir)
    const manifest: BackupManifest = {
      app: 'Mail Lite',
      format: 1,
      createdAt: Date.now(),
      ...info,
      files: c.files + 1,
      bytes: c.bytes + fs.statSync(snap).size
    }
    fs.writeFileSync(man, JSON.stringify(manifest, null, 2))
    const entries = fs.readdirSync(dataDir).filter((n) => !SKIP.has(n))
    await tar.c({ gzip: { level: 6 }, file: tmpOut, cwd: dataDir, portable: true }, [MANIFEST, SNAPSHOT, ...entries])
    fs.renameSync(tmpOut, outFile) // chỉ thay tệp đích khi đã ghi xong trọn vẹn
    return manifest
  } finally {
    fs.rmSync(snap, { force: true })
    fs.rmSync(man, { force: true })
    fs.rmSync(tmpOut, { force: true })
  }
}

/** Đọc phần mô tả của tệp sao lưu (để hỏi xác nhận trước khi khôi phục). Báo lỗi nếu không phải tệp sao lưu Mail Lite. */
export async function readBackupInfo(file: string): Promise<BackupManifest> {
  let text = ''
  await tar.t({
    file,
    filter: (p) => p.replace(/^\.\//, '') === MANIFEST,
    onReadEntry: (e) => {
      e.on('data', (d: Buffer) => (text += d.toString('utf8')))
    }
  })
  let m: BackupManifest
  try {
    m = JSON.parse(text)
  } catch {
    throw new Error('Tệp này không phải bản sao lưu của Mail Lite.')
  }
  if (m.app !== 'Mail Lite' || m.format !== 1) throw new Error('Tệp này không phải bản sao lưu của Mail Lite.')
  return m
}

/**
 * Khôi phục: giải nén ra thư mục tạm cạnh thư mục dữ liệu, kiểm tra đủ CSDL, rồi mới tráo vào.
 * Dữ liệu hiện tại được giữ lại ở "<thư mục dữ liệu>.truoc-khoi-phuc" (ghi đè bản giữ lại của lần trước).
 * Phải gọi khi CSDL đã đóng (engine đã dừng).
 */
export async function restoreBackup(file: string, dataDir: string): Promise<{ keptOld: string | null }> {
  await readBackupInfo(file)
  const base = path.resolve(dataDir)
  const tmp = `${base}.dang-khoi-phuc`
  const old = `${base}.truoc-khoi-phuc`
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  try {
    // node-tar mặc định bỏ đường dẫn tuyệt đối và "..", không cho tệp lạ ghi ra ngoài thư mục đích
    await tar.x({ file, cwd: tmp, strict: true })
    const snap = path.join(tmp, SNAPSHOT)
    if (!fs.existsSync(snap)) throw new Error('Bản sao lưu bị thiếu cơ sở dữ liệu.')
    fs.renameSync(snap, path.join(tmp, DB_FILE))
    fs.rmSync(path.join(tmp, MANIFEST), { force: true })
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true })
    throw e
  }
  let keptOld: string | null = null
  if (fs.existsSync(base)) {
    fs.rmSync(old, { recursive: true, force: true })
    fs.renameSync(base, old)
    keptOld = old
  }
  fs.renameSync(tmp, base)
  return { keptOld }
}

export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `Mail-Lite-sao-luu-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${BACKUP_EXT}`
}
