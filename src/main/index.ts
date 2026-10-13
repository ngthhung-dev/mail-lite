import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, shell } from 'electron'
import { execFile } from 'node:child_process'
import type { MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Engine } from './engine.ts'
import { copyData, defaultDataDir, hasData, isInside, planTarget, resolveDataDir, writeConfig } from './datadir.ts'
import { ENGINE_METHODS } from '../shared/api.ts'
import type { AppEvent, OutgoingAttachment } from '../shared/types.ts'
import { APP_NAME, APP_TAGLINE } from '../shared/types.ts'

// tên hiển thị (menu, thông báo, thư mục dữ liệu) — đặt trước khi dùng app.getPath
app.setName(APP_NAME)

/** số build, gắn lúc build (xem electron.vite.config.ts) */
declare const __BUILD__: string

const ICON_FILE = path.join(__dirname, '../../resources/icon.png')
/**
 * Windows lấy tên + biểu tượng hiện trên thông báo ("toast") từ mã ứng dụng này. Không đặt thì thông báo
 * hiện là "Electron". Đặt trước khi tạo cửa sổ để thanh tác vụ cũng gom đúng nhóm.
 */
const AUMID = APP_NAME
if (process.platform === 'win32') app.setAppUserModelId(AUMID)

/** Đăng ký tên hiển thị + biểu tượng cho mã ứng dụng (cấp người dùng, không cần quyền quản trị). */
function registerWindowsIdentity(userData: string): void {
  if (process.platform !== 'win32') return
  try {
    // Windows cần một tệp ảnh thật trên đĩa, không đọc được tệp nằm trong gói app.asar
    const icon = path.join(userData, 'icon.png')
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(icon, fs.readFileSync(ICON_FILE))
    const key = `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`
    const add = (name: string, value: string): void => {
      execFile('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true }, () => undefined)
    }
    add('DisplayName', APP_NAME)
    add('IconUri', icon)
  } catch {
    /* không đăng ký được thì thông báo vẫn hiện đúng tên nhờ AUMID, chỉ thiếu biểu tượng */
  }
}

const userData = app.getPath('userData')
let { dir: dataDir, custom: customDataDir } = resolveDataDir(userData, process.env.MAILLITE_DATA_DIR)

let win: BrowserWindow | null = null
let quitting = false
let engine: Engine

function secure(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}
/** Trên Linux không có keyring, Electron dùng khoá cố định ("basic_text") — không coi là an toàn. */
function strongStorage(): boolean {
  if (!secure()) return false
  if (process.platform !== 'linux') return true
  try {
    return safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    return false
  }
}
// Mật khẩu được mã hoá bằng kho khoá của hệ điều hành (DPAPI / Keychain / libsecret).
function encrypt(plain: string): string {
  if (secure()) return 'ss:' + safeStorage.encryptString(plain).toString('base64')
  return 'b64:' + Buffer.from(plain, 'utf8').toString('base64')
}
function decrypt(cipher: string): string {
  if (cipher.startsWith('ss:')) return safeStorage.decryptString(Buffer.from(cipher.slice(3), 'base64'))
  if (cipher.startsWith('b64:')) return Buffer.from(cipher.slice(4), 'base64').toString('utf8')
  throw new Error('Định dạng bí mật không hợp lệ')
}

function safeOpen(url: string): void {
  if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
}

function emit(e: AppEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('event', e)
  if (e.type === 'new-mail' && Notification.isSupported()) {
    const n = new Notification({
      icon: ICON_FILE,
      title: e.count > 1 ? `${e.count} thư mới` : `Thư mới từ ${e.from}`,
      body: e.subject || '(Không có tiêu đề)'
    })
    n.on('click', () => {
      win?.show()
      win?.focus()
    })
    n.show()
  }
  if (e.type === 'reminder' && Notification.isSupported()) {
    new Notification({
      icon: ICON_FILE,
      title: `Nhắc lịch: ${e.event.title}`,
      body: `${new Date(e.event.start).toLocaleString('vi-VN')}${e.event.location ? ' · ' + e.event.location : ''}`
    }).show()
  }
  if (e.type === 'mail-changed' || e.type === 'new-mail') {
    try {
      app.setBadgeCount(engine.unreadCount())
    } catch {
      /* nền tảng không hỗ trợ huy hiệu */
    }
  }
}

const shellApi: Record<string, (...a: any[]) => unknown> = {
  async pickAttachments(): Promise<OutgoingAttachment[]> {
    const r = await dialog.showOpenDialog(win!, { title: 'Đính kèm tệp', properties: ['openFile', 'multiSelections'] })
    return r.filePaths.map((p) => ({ path: p, filename: path.basename(p), size: fs.statSync(p).size }))
  },
  async pickMergeFile(): Promise<string | null> {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Chọn danh sách người nhận',
      properties: ['openFile'],
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xlsm', 'csv'] }]
    })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  },
  async saveTextFile(defaultName: string, content: string): Promise<string | null> {
    const r = await dialog.showSaveDialog(win!, { defaultPath: path.join(app.getPath('documents'), path.basename(defaultName)) })
    if (r.canceled || !r.filePath) return null
    // BOM để Excel mở CSV tiếng Việt không lỗi font
    fs.writeFileSync(r.filePath, '\uFEFF' + content, 'utf8')
    return r.filePath
  },
  async openAttachment(id: number): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maillite-'))
    const file = await engine.saveAttachment(id, path.join(dir, engine.attachmentName(id)))
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  },
  async saveAttachmentAs(id: number): Promise<string | null> {
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('downloads'), engine.attachmentName(id))
    })
    if (r.canceled || !r.filePath) return null
    return engine.saveAttachment(id, r.filePath)
  },
  async saveAllAttachments(messageId: number): Promise<number> {
    const r = await dialog.showOpenDialog(win!, { title: 'Chọn thư mục lưu', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return 0
    return engine.saveAllAttachments(messageId, r.filePaths[0])
  },
  async exportEmlAs(messageId: number): Promise<string | null> {
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('documents'), `thu-${messageId}.eml`),
      filters: [{ name: 'Thư điện tử', extensions: ['eml'] }]
    })
    if (r.canceled || !r.filePath) return null
    await engine.exportEml(messageId, r.filePath)
    return r.filePath
  },
  async exportMboxAs(folderId: number): Promise<number | null> {
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('documents'), `thu-muc-${folderId}.mbox`),
      filters: [{ name: 'Mbox', extensions: ['mbox'] }]
    })
    if (r.canceled || !r.filePath) return null
    return engine.exportMbox(folderId, r.filePath)
  },
  openExternal(url: string): void {
    safeOpen(url)
  },
  /** Mở tệp hướng dẫn sử dụng (PDF đi kèm ứng dụng) bằng trình đọc PDF của máy. */
  async openGuide(): Promise<void> {
    // tệp nằm trong app.asar → chép ra thư mục tạm để trình đọc PDF ngoài mở được
    const src = path.join(__dirname, '../../docs/Mail-Lite-Huong-dan-su-dung.pdf')
    const dest = path.join(app.getPath('temp'), 'Mail-Lite-Huong-dan-su-dung.pdf')
    fs.writeFileSync(dest, fs.readFileSync(src))
    const err = await shell.openPath(dest)
    if (err) throw new Error('Không mở được tệp hướng dẫn: ' + err)
  },
  async openDataDir(): Promise<void> {
    await shell.openPath(dataDir)
  },
  async changeDataDir(): Promise<boolean> {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Chọn nơi lưu dữ liệu Mail Lite',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return false
    return switchDataDir(planTarget(r.filePaths[0]))
  },
  async resetDataDir(): Promise<boolean> {
    const target = defaultDataDir(userData)
    return switchDataDir({ target, existing: hasData(target) })
  },
  appInfo() {
    return {
      version: app.getVersion(),
      build: __BUILD__,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      dataDir,
      defaultDataDir: defaultDataDir(userData),
      customDataDir,
      secureStorage: strongStorage(),
      platform: process.platform
    }
  }
}

/** Chuyển nơi lưu dữ liệu: dừng đồng bộ → chép (hoặc dùng dữ liệu có sẵn ở đích) → ghi cấu hình → khởi động lại. */
async function switchDataDir(plan: { target: string; existing: boolean }): Promise<boolean> {
  const { target, existing } = plan
  if (path.resolve(target) === path.resolve(dataDir)) throw new Error('Đây chính là thư mục dữ liệu hiện tại.')
  if (isInside(target, dataDir)) throw new Error('Không thể chọn thư mục nằm bên trong thư mục dữ liệu hiện tại.')
  const ask = await dialog.showMessageBox(win!, {
    type: 'question',
    buttons: [existing ? 'Dùng dữ liệu có sẵn ở đó' : 'Chuyển dữ liệu', 'Huỷ'],
    defaultId: 0,
    cancelId: 1,
    title: 'Đổi nơi lưu dữ liệu',
    message: existing ? 'Thư mục này đã có dữ liệu Mail Lite' : 'Chuyển toàn bộ dữ liệu sang vị trí mới?',
    detail: existing
      ? `${target}\n\nMail Lite sẽ dùng dữ liệu đang có ở đó (không chép đè) và khởi động lại. Dữ liệu ở vị trí hiện tại được giữ nguyên.`
      : `${target}\n\nThư, tài khoản và cài đặt sẽ được chép sang đó, rồi Mail Lite khởi động lại. Thư đang chờ gửi sẽ được gửi nốt trước khi chuyển.`
  })
  if (ask.response !== 0) return false

  const old = dataDir
  quitting = true // từ đây engine đã dừng, không để before-quit dừng lần nữa
  await engine.stop()
  try {
    if (!existing) await copyData(old, target)
    writeConfig(userData, path.resolve(target) === path.resolve(defaultDataDir(userData)) ? {} : { dataDir: target })
  } catch (e: any) {
    await dialog.showMessageBox(win!, {
      type: 'error',
      title: 'Không chuyển được dữ liệu',
      message: 'Không chuyển được dữ liệu',
      detail: `${e?.message ?? e}\n\nMail Lite sẽ khởi động lại và tiếp tục dùng vị trí cũ:\n${old}`
    })
    app.relaunch()
    app.exit(0)
    return false
  }
  if (!existing) {
    const del = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Giữ lại bản cũ', 'Xoá bản cũ'],
      defaultId: 0,
      cancelId: 0,
      title: 'Đã chuyển xong',
      message: 'Đã chép xong dữ liệu sang vị trí mới',
      detail: `Bản cũ vẫn còn ở:\n${old}\n\nXoá bản cũ để giải phóng dung lượng?`
    })
    if (del.response === 1) fs.rmSync(old, { recursive: true, force: true })
  }
  app.relaunch()
  app.exit(0)
  return true
}

function buildMenu(): void {
  const send = (action: string) => () => emit({ type: 'menu', action })
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Tệp',
      submenu: [
        { label: 'Thư mới', click: send('new-mail') },
        { label: 'Trộn thư từ Excel…', click: send('merge') },
        { label: 'Thêm tài khoản…', click: send('add-account') },
        { type: 'separator' },
        { label: 'Gửi/Nhận tất cả', click: send('sync') },
        { label: 'Cài đặt…', click: send('settings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Thoát' }
      ]
    },
    { role: 'editMenu', label: 'Sửa' },
    {
      label: 'Xem',
      submenu: [
        { label: 'Thư', click: send('view-mail') },
        { label: 'Lịch', click: send('view-calendar') },
        { label: 'Danh bạ', click: send('view-people') },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Phóng to' },
        { role: 'zoomOut', label: 'Thu nhỏ' },
        { role: 'resetZoom', label: 'Cỡ gốc' },
        { role: 'togglefullscreen', label: 'Toàn màn hình' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Công cụ nhà phát triển' }
      ]
    },
    { role: 'windowMenu', label: 'Cửa sổ' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: APP_TAGLINE,
    // biểu tượng cửa sổ + thanh tác vụ (macOS dùng biểu tượng của gói ứng dụng)
    ...(process.platform === 'darwin' ? {} : { icon: nativeImage.createFromPath(ICON_FILE) }),
    backgroundColor: '#f3f2f1',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // Windows/Linux: ẩn hẳn thanh menu hệ thống (Tệp, Sửa, Xem…) — mọi lệnh đã có trên ribbon và phím tắt.
  // macOS giữ menu trên thanh hệ thống như mọi ứng dụng khác.
  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false)
    win.setAutoHideMenuBar(false)
  }
  win.once('ready-to-show', () => win?.show())
  // Liên kết trong thư luôn mở bằng trình duyệt hệ thống, không điều hướng cửa sổ ứng dụng
  win.webContents.setWindowOpenHandler(({ url }) => {
    safeOpen(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (ev, url) => {
    if (url !== win?.webContents.getURL()) {
      ev.preventDefault()
      safeOpen(url)
    }
  })
  win.webContents.on('will-frame-navigate', (ev) => {
    if (!ev.isMainFrame) {
      ev.preventDefault()
      safeOpen(ev.url)
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.on('closed', () => {
    win = null
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(async () => {
    // Nơi lưu do người dùng chọn không truy cập được (ổ rời chưa cắm, ổ mạng mất…): hỏi thay vì lặng lẽ tạo hộp thư trống
    while (customDataDir && !process.env.MAILLITE_DATA_DIR && !fs.existsSync(dataDir)) {
      const r = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Thử lại', 'Dùng vị trí mặc định', 'Thoát'],
        defaultId: 0,
        cancelId: 2,
        title: 'Mail Lite',
        message: 'Không tìm thấy thư mục dữ liệu',
        detail: `${dataDir}\n\nNếu dữ liệu nằm trên ổ rời hoặc ổ mạng, hãy kết nối lại rồi bấm Thử lại.`
      })
      if (r.response === 2) return app.exit(0)
      if (r.response === 1) {
        writeConfig(userData, {})
        dataDir = defaultDataDir(userData)
        customDataDir = false
      }
    }
    fs.mkdirSync(dataDir, { recursive: true })
    registerWindowsIdentity(userData)
    engine = new Engine({ dataDir, encrypt, decrypt, openExternal: safeOpen, emit })
    const allowed = new Set<string>(ENGINE_METHODS)
    ipcMain.handle('api', async (_e, method: string, args: unknown[]) => {
      if (allowed.has(method)) return await (engine as any)[method](...(args ?? []))
      if (Object.hasOwn(shellApi, method)) return await shellApi[method](...(args ?? []))
      throw new Error(`Hàm không tồn tại: ${method}`)
    })
    buildMenu()
    createWindow()
    engine.start()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (ev) => {
    if (quitting || !engine) return
    ev.preventDefault()
    quitting = true
    void engine.stop().finally(() => app.quit())
  })
}
