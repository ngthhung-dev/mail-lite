import fs from 'node:fs/promises'
import { appendFileSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type {
  Account,
  AccountInput,
  AppEvent,
  AppSettings,
  CalendarEvent,
  Contact,
  Draft,
  Folder,
  ListQuery,
  MergeCheck,
  MergeData,
  MergeIssue,
  MergeJob,
  MergeProgress,
  MergeResult,
  MessageDetail,
  MessageSummary,
  Rule,
  ServerPreset,
  SyncStatus
} from '../shared/types.ts'
import { Store, rowToSummary } from './store.ts'
import { AccountSync, emlPath, friendlyError } from './imap.ts'
import type { ImapAuth } from './imap.ts'
import { inlineCids, parseRaw } from './mime.ts'
import { discover } from './presets.ts'
import { authorize, refresh } from './oauth.ts'
import type { OAuthTokens } from './oauth.ts'
import { ruleMatches } from './rules.ts'
import { readMergeFile } from './merge.ts'
import { createBackup } from './backup.ts'
import type { BackupManifest } from './backup.ts'
import { isEmail, renderTemplate, rowRecord, splitAddresses, templateFields, fieldKey } from '../shared/merge.ts'

export interface EngineOptions {
  dataDir: string
  /** mã hoá bí mật bằng kho khoá của hệ điều hành */
  encrypt(plain: string): string
  decrypt(cipher: string): string
  openExternal(url: string): void | Promise<void>
  emit(e: AppEvent): void
}

interface Secret {
  password?: string
  tokens?: OAuthTokens
}

function parseList(s: string): string[] {
  return s
    .split(/[;,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Tên tệp do người gửi đặt — bỏ đường dẫn và ký tự không hợp lệ trên Windows. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const clean = base.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim()
  if (!clean || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean)) return 'tep-dinh-kem' + (path.extname(clean) || '')
  return clean.slice(0, 180)
}

/**
 * Bọc nội dung trong phông/cỡ chữ mặc định của khung soạn, để người nhận thấy giống lúc soạn
 * (nếu không, nhiều trình đọc thư sẽ hiện Times New Roman).
 */
const BASE_FONT_MARK = 'data-ml-body'
export function withBaseFont(html: string): string {
  if (html.includes(BASE_FONT_MARK)) return html
  return `<div ${BASE_FONT_MARK}="1" style="font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:11pt;color:#201f1e">${html}</div>`
}

export class Engine {
  store: Store
  private opts: EngineOptions
  private syncs = new Map<number, AccountSync>()
  private timer: ReturnType<typeof setInterval> | null = null
  private reminderTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: EngineOptions) {
    this.opts = opts
    this.store = new Store(path.join(opts.dataDir, 'maillite.db'))
    this.mergeLoad()
  }

  // ---------- Vòng đời ----------
  start(): void {
    for (const a of this.store.listAccounts()) void this.syncAccount(a.id).catch(() => undefined)
    this.schedule()
    this.reminderTimer = setInterval(() => {
      for (const ev of this.store.dueReminders(Date.now())) this.opts.emit({ type: 'reminder', event: ev })
    }, 30_000)
  }
  private schedule(): void {
    if (this.timer) clearInterval(this.timer)
    const min = Math.max(1, this.store.getSettings().syncIntervalMin || 5)
    this.timer = setInterval(() => void this.syncAllAccounts(), min * 60_000)
  }
  private stopping = false
  async stop(): Promise<void> {
    // thư đang trong thời gian chờ "hoàn tác" phải được gửi nốt trước khi thoát, không được mất
    await Promise.race([Promise.allSettled([...this.outbox.keys()].map((id) => this.sendNow(id))), new Promise((r) => setTimeout(r, 30000))])
    this.stopping = true
    // đang trộn thư: gửi nốt thư hiện tại rồi dừng, phần còn lại gửi tiếp được ở lần mở sau
    if (this.merge?.running) {
      this.merge.stopped = 'Đợt gửi tạm dừng vì ứng dụng đã thoát.'
      this.mergeCancel()
      await Promise.race([this.mergeTask, new Promise((r) => setTimeout(r, 20000))])
    }
    if (this.timer) clearInterval(this.timer)
    if (this.reminderTimer) clearInterval(this.reminderTimer)
    await Promise.all([...this.syncs.values()].map((s) => s.stop()))
    this.syncs.clear()
    this.store.close()
  }

  private sync(accountId: number): AccountSync {
    let s = this.syncs.get(accountId)
    if (!s) {
      s = new AccountSync(accountId, {
        store: this.store,
        dataDir: this.opts.dataDir,
        getAuth: (id) => this.getAuth(id),
        emit: this.opts.emit,
        onNewMessages: (a, f, ids, initial) => this.onNewMessages(a, f, ids, initial)
      })
      this.syncs.set(accountId, s)
    }
    return s
  }

  // ---------- Bí mật / xác thực ----------
  private readSecret(accountId: number): Secret {
    const raw = this.store.getSecret(accountId)
    if (!raw) return {}
    try {
      return JSON.parse(this.opts.decrypt(raw)) as Secret
    } catch {
      throw new Error('Không giải mã được mật khẩu đã lưu. Hãy nhập lại mật khẩu cho tài khoản này.')
    }
  }
  private writeSecret(accountId: number, s: Secret): void {
    this.store.setSecret(accountId, this.opts.encrypt(JSON.stringify(s)))
  }
  async getAuth(accountId: number): Promise<ImapAuth> {
    const a = this.store.getAccount(accountId)
    if (!a) throw new Error('Không tìm thấy tài khoản.')
    const sec = this.readSecret(accountId)
    if (a.authType === 'oauth') {
      if (!sec.tokens) throw new Error('Tài khoản chưa đăng nhập OAuth.')
      const t = await refresh(a.provider, this.store.getSettings(), sec.tokens)
      if (t !== sec.tokens) this.writeSecret(accountId, { tokens: t })
      return { user: a.username, accessToken: t.accessToken }
    }
    if (!sec.password) throw new Error('Chưa có mật khẩu cho tài khoản này.')
    return { user: a.username, pass: sec.password }
  }

  // ---------- Tài khoản ----------
  listAccounts(): Account[] {
    return this.store.listAccounts()
  }
  discover(email: string): Promise<ServerPreset> {
    return discover(email)
  }
  statuses(): SyncStatus[] {
    return [...this.syncs.values()].map((s) => s.status)
  }

  private async verifySmtp(a: AccountInput, auth: ImapAuth): Promise<void> {
    const t = this.transport(a, auth)
    try {
      await t.verify()
    } catch (e) {
      throw new Error('SMTP (gửi thư): ' + friendlyError(e))
    } finally {
      t.close()
    }
  }

  /** Thêm/sửa tài khoản dùng mật khẩu. Kiểm tra kết nối IMAP + SMTP trước khi lưu. */
  async saveAccount(input: AccountInput): Promise<Account> {
    const existing = input.id ? this.store.getAccount(input.id) : null
    const connChanged =
      !existing ||
      input.password ||
      existing.imapHost !== input.imapHost ||
      existing.imapPort !== input.imapPort ||
      existing.imapSecure !== input.imapSecure ||
      existing.smtpHost !== input.smtpHost ||
      existing.smtpPort !== input.smtpPort ||
      existing.smtpSecure !== input.smtpSecure ||
      existing.username !== input.username
    if (input.authType === 'password' && connChanged) {
      const password = input.password || (existing ? this.readSecret(existing.id).password : '')
      if (!password) throw new Error('Vui lòng nhập mật khẩu.')
      const auth = { user: input.username, pass: password }
      try {
        await AccountSync.verify(input, auth)
      } catch (e: any) {
        throw new Error('IMAP (nhận thư): ' + e.message)
      }
      await this.verifySmtp(input, auth)
    }
    const acc = this.store.saveAccount(input)
    if (input.authType === 'password' && input.password) this.writeSecret(acc.id, { password: input.password })
    if (connChanged) {
      await this.syncs.get(acc.id)?.stop()
      this.syncs.delete(acc.id)
      void this.syncAccount(acc.id).catch(() => undefined)
    }
    this.opts.emit({ type: 'accounts-changed' })
    return acc
  }

  /** Thêm tài khoản Gmail/Microsoft qua đăng nhập trên trình duyệt. */
  async oauthLogin(input: AccountInput): Promise<Account> {
    const tokens = await authorize(input.provider, this.store.getSettings(), input.email, this.opts.openExternal)
    const auth = { user: input.username, accessToken: tokens.accessToken }
    try {
      await AccountSync.verify(input, auth)
    } catch (e: any) {
      throw new Error('IMAP (nhận thư): ' + e.message)
    }
    const acc = this.store.saveAccount({ ...input, authType: 'oauth' })
    this.writeSecret(acc.id, { tokens })
    await this.syncs.get(acc.id)?.stop()
    this.syncs.delete(acc.id)
    void this.syncAccount(acc.id).catch(() => undefined)
    this.opts.emit({ type: 'accounts-changed' })
    return acc
  }

  /** Sao lưu toàn bộ dữ liệu (thư, tài khoản, cài đặt, quy tắc, lịch, danh bạ…) ra một tệp. */
  async backup(outFile: string, info: { version: string; build: string; platform: string }): Promise<BackupManifest> {
    return createBackup(this.opts.dataDir, outFile, { ...info, accounts: this.store.listAccounts().map((a) => a.email) }, (f) => this.store.snapshot(f))
  }

  reorderFolders(ids: number[]): void {
    this.store.reorderFolders(ids)
    const f = ids.length ? this.store.getFolder(ids[0]) : null
    if (f) this.opts.emit({ type: 'folders-changed', accountId: f.accountId })
  }

  reorderAccounts(ids: number[]): void {
    this.store.reorderAccounts(ids)
    this.opts.emit({ type: 'accounts-changed' })
  }

  async removeAccount(id: number): Promise<void> {
    await this.syncs.get(id)?.stop()
    this.syncs.delete(id)
    this.store.deleteAccount(id)
    await fs.rm(path.join(this.opts.dataDir, 'mail', String(id)), { recursive: true, force: true })
    this.opts.emit({ type: 'accounts-changed' })
  }

  syncAccount(id: number): Promise<void> {
    return this.sync(id).syncAll()
  }
  async syncAllAccounts(): Promise<void> {
    await Promise.allSettled(this.store.listAccounts().map((a) => this.syncAccount(a.id)))
  }

  // ---------- Thư mục ----------
  listFolders(): Folder[] {
    return this.store.listFolders()
  }
  async createFolder(accountId: number, parentFolderId: number | null, name: string): Promise<void> {
    name = name.trim()
    if (!name) throw new Error('Tên thư mục trống.')
    const parent = parentFolderId ? this.store.getFolder(parentFolderId) : null
    const parts = parent ? [...parent.path.split(parent.delimiter), name] : [name]
    await this.sync(accountId).createFolder(parts)
  }
  async renameFolder(folderId: number, name: string): Promise<void> {
    const f = this.store.getFolder(folderId)
    if (!f) return
    if (f.specialUse) throw new Error('Không đổi tên được thư mục hệ thống.')
    const parts = f.path.split(f.delimiter)
    parts[parts.length - 1] = name.trim()
    await this.sync(f.accountId).renameFolder(f.path, parts.join(f.delimiter))
    void this.syncAccount(f.accountId).catch(() => undefined)
  }
  async deleteFolder(folderId: number): Promise<void> {
    const f = this.store.getFolder(folderId)
    if (!f) return
    if (f.specialUse) throw new Error('Không xoá được thư mục hệ thống.')
    await this.sync(f.accountId).deleteFolder(f.path)
    await fs.rm(path.join(this.opts.dataDir, 'mail', String(f.accountId), String(folderId)), { recursive: true, force: true })
  }
  /**
   * Xoá nhanh toàn bộ thư trong một thư mục — trên máy chủ, kể cả thư cũ chưa đồng bộ về máy.
   * Thùng rác / Thư rác / Thư nháp: xoá vĩnh viễn. Thư mục khác (Hộp thư đến…): chuyển hết vào Thùng rác.
   */
  async emptyFolder(folderId: number): Promise<'deleted' | 'trashed'> {
    const f = this.store.getFolder(folderId)
    if (!f || !f.selectable) throw new Error('Không tìm thấy thư mục.')
    const trash = this.store.findFolder(f.accountId, { specialUse: 'trash' })
    const permanent = !trash || f.specialUse === 'trash' || f.specialUse === 'junk' || f.specialUse === 'drafts'
    if (permanent) this.store.enqueueOp(f.accountId, 'delete', { path: f.path, uids: [], all: true })
    else this.store.enqueueOp(f.accountId, 'move', { path: f.path, uids: [], all: true, target: trash!.path })
    this.store.clearFolderMessages(folderId)
    await fs.rm(path.join(this.opts.dataDir, 'mail', String(f.accountId), String(folderId)), { recursive: true, force: true })
    this.opts.emit({ type: 'mail-changed', accountId: f.accountId, folderIds: [folderId] })
    const sync = this.sync(f.accountId)
    void sync.flushOps().then(() => {
      if (!permanent && trash) void sync.syncFolder(trash.id).catch(() => undefined)
    })
    return permanent ? 'deleted' : 'trashed'
  }

  setPinned(ids: number[], value: boolean): void {
    this.store.setPinned(ids, value)
    const accounts = new Set<number>()
    for (const id of ids) {
      const r = this.store.getMessageRow(id)
      if (r) accounts.add(r.account_id)
    }
    for (const accountId of accounts) this.opts.emit({ type: 'mail-changed', accountId, folderIds: [] })
  }

  // ---------- Thư ----------
  listMessages(q: ListQuery): MessageSummary[] {
    return this.store.listMessages(q)
  }
  listThread(accountId: number, threadKey: string, preferFolderId?: number): MessageSummary[] {
    return this.store.listThread(accountId, threadKey, preferFolderId)
  }

  private async readEml(row: any): Promise<Buffer | null> {
    const file = emlPath(this.opts.dataDir, row.account_id, row.folder_id, row.uid)
    try {
      return await fs.readFile(file)
    } catch {
      return null
    }
  }

  async getMessage(id: number): Promise<MessageDetail | null> {
    let row = this.store.getMessageRow(id)
    if (!row) return null
    let available = !!row.body_fetched
    if (!available) {
      try {
        await this.sync(row.account_id).fetchBody(id)
        row = this.store.getMessageRow(id)!
        available = !!row.body_fetched
      } catch {
        available = false
      }
    }
    let html: string = row.body_html
    if (/cid:/i.test(html)) {
      const raw = await this.readEml(row)
      if (raw) html = inlineCids(html, await parseRaw(raw))
    }
    const j = (s: string) => {
      try {
        return JSON.parse(s)
      } catch {
        return []
      }
    }
    return {
      ...rowToSummary(row),
      messageId: row.message_id,
      inReplyTo: row.in_reply_to,
      references: row.refs,
      cc: j(row.cc_json),
      bcc: j(row.bcc_json),
      replyTo: j(row.reply_to_json),
      html,
      text: row.body_text,
      attachments: this.store.getAttachments(id).map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type,
        size: a.size,
        inline: !!a.inline
      })),
      bodyAvailable: available
    }
  }

  /** Gom thư theo thư mục để gửi lệnh IMAP theo lô. */
  private group(ids: number[]): Map<number, { folder: NonNullable<ReturnType<Store['getFolder']>>; rows: any[] }> {
    const out = new Map<number, { folder: NonNullable<ReturnType<Store['getFolder']>>; rows: any[] }>()
    for (const id of ids) {
      const row = this.store.getMessageRow(id)
      if (!row) continue
      let g = out.get(row.folder_id)
      if (!g) {
        const folder = this.store.getFolder(row.folder_id)
        if (!folder) continue
        g = { folder, rows: [] }
        out.set(row.folder_id, g)
      }
      g.rows.push(row)
    }
    return out
  }
  private changed(groups: Map<number, { folder: { accountId: number }; rows: any[] }>): void {
    const byAcc = new Map<number, number[]>()
    for (const [fid, g] of groups) byAcc.set(g.folder.accountId, [...(byAcc.get(g.folder.accountId) ?? []), fid])
    for (const [accountId, folderIds] of byAcc) {
      this.opts.emit({ type: 'mail-changed', accountId, folderIds })
      void this.sync(accountId).flushOps()
    }
  }

  setFlag(ids: number[], flag: 'seen' | 'flagged' | 'answered', value: boolean): void {
    const imapFlag = { seen: '\\Seen', flagged: '\\Flagged', answered: '\\Answered' }[flag]
    const groups = this.group(ids)
    for (const g of groups.values()) {
      const rows = g.rows.filter((r) => !!r[flag] !== value)
      if (!rows.length) continue
      this.store.tx(() => rows.forEach((r) => this.store.updateFlags(r.id, { [flag]: value })))
      this.store.enqueueOp(g.folder.accountId, 'flags', {
        path: g.folder.path,
        uids: rows.map((r) => r.uid),
        [value ? 'add' : 'remove']: [imapFlag]
      })
    }
    this.changed(groups)
  }

  setCategory(ids: number[], category: string | null): void {
    this.store.setCategory(ids, category)
    this.changed(this.group(ids))
  }

  private async dropLocal(rows: any[]): Promise<void> {
    this.store.deleteMessages(rows.map((r) => r.id))
    for (const r of rows) {
      await fs.rm(emlPath(this.opts.dataDir, r.account_id, r.folder_id, r.uid), { force: true })
    }
  }

  async moveMessages(ids: number[], targetFolderId: number): Promise<void> {
    const target = this.store.getFolder(targetFolderId)
    if (!target) throw new Error('Không tìm thấy thư mục đích.')
    const groups = this.group(ids)
    for (const [fid, g] of groups) {
      if (g.folder.accountId !== target.accountId) throw new Error('Chưa hỗ trợ chuyển thư giữa hai tài khoản khác nhau.')
      if (fid === targetFolderId) continue
      this.store.enqueueOp(g.folder.accountId, 'move', { path: g.folder.path, uids: g.rows.map((r) => r.uid), target: target.path })
      await this.dropLocal(g.rows)
    }
    this.changed(groups)
    void this.sync(target.accountId)
      .syncFolder(targetFolderId)
      .catch(() => undefined)
  }

  /** Xoá: chuyển vào Thùng rác; nếu đang ở Thùng rác (hoặc permanent) thì xoá hẳn. */
  async deleteMessages(ids: number[], permanent = false): Promise<void> {
    const groups = this.group(ids)
    const syncTrash = new Set<number>()
    for (const g of groups.values()) {
      const trash = this.store.findFolder(g.folder.accountId, { specialUse: 'trash' })
      const hard = permanent || !trash || g.folder.specialUse === 'trash' || g.folder.specialUse === 'drafts'
      const uids = g.rows.map((r) => r.uid)
      if (hard) this.store.enqueueOp(g.folder.accountId, 'delete', { path: g.folder.path, uids })
      else {
        this.store.enqueueOp(g.folder.accountId, 'move', { path: g.folder.path, uids, target: trash!.path })
        syncTrash.add(trash!.id)
      }
      await this.dropLocal(g.rows)
    }
    this.changed(groups)
    for (const fid of syncTrash) {
      const f = this.store.getFolder(fid)
      if (f) void this.sync(f.accountId).syncFolder(fid).catch(() => undefined)
    }
  }

  async moveToSpecial(ids: number[], special: 'archive' | 'junk' | 'inbox'): Promise<void> {
    const groups = this.group(ids)
    for (const g of groups.values()) {
      const target = this.store.findFolder(g.folder.accountId, { specialUse: special })
      if (!target) {
        const label = { archive: 'Lưu trữ', junk: 'Thư rác', inbox: 'Hộp thư đến' }[special]
        throw new Error(`Tài khoản này không có thư mục ${label}. Hãy tạo thư mục rồi dùng lệnh Chuyển tới.`)
      }
      await this.moveMessages(
        g.rows.map((r) => r.id),
        target.id
      )
    }
  }

  // ---------- Đính kèm ----------
  private async attachmentContent(attId: number): Promise<{ filename: string; contentType: string; content: Buffer }> {
    const att = this.store.getAttachment(attId)
    if (!att) throw new Error('Không tìm thấy tệp đính kèm.')
    let row = this.store.getMessageRow(att.message_id)
    if (!row) throw new Error('Thư không còn tồn tại.')
    let raw = await this.readEml(row)
    if (!raw) {
      await this.sync(row.account_id).fetchBody(row.id)
      raw = await this.readEml(row)
    }
    if (!raw) throw new Error('Chưa tải được nội dung thư (đang offline?).')
    const mail = await parseRaw(raw)
    const a = mail.attachments?.[att.idx]
    if (!a) throw new Error('Không đọc được tệp đính kèm.')
    return { filename: att.filename, contentType: att.content_type, content: a.content }
  }
  async saveAttachment(attId: number, dest: string): Promise<string> {
    const a = await this.attachmentContent(attId)
    await fs.writeFile(dest, a.content)
    return dest
  }
  async saveAllAttachments(messageId: number, dir: string): Promise<number> {
    let n = 0
    const used = new Set<string>()
    for (const a of this.store.getAttachments(messageId)) {
      if (a.inline) continue
      let name = safeFileName(a.filename)
      // hai tệp trùng tên → thêm số thứ tự thay vì ghi đè
      for (let i = 2; used.has(name.toLowerCase()); i++) {
        const ext = path.extname(name)
        name = `${path.basename(safeFileName(a.filename), ext)} (${i})${ext}`
      }
      used.add(name.toLowerCase())
      await this.saveAttachment(a.id, path.join(dir, name))
      n++
    }
    return n
  }
  attachmentName(attId: number): string {
    return safeFileName(this.store.getAttachment(attId)?.filename ?? '')
  }

  // ---------- Soạn / gửi ----------
  private transport(a: Pick<Account, 'smtpHost' | 'smtpPort' | 'smtpSecure'>, auth: ImapAuth) {
    return nodemailer.createTransport({
      host: a.smtpHost,
      port: a.smtpPort,
      secure: a.smtpSecure,
      requireTLS: !a.smtpSecure && a.smtpPort === 587,
      auth: 'accessToken' in auth ? { type: 'OAuth2', user: auth.user, accessToken: auth.accessToken } : auth,
      connectionTimeout: 30000
    })
  }

  private async buildMail(d: Draft, account: Account) {
    const to = parseList(d.to)
    const cc = parseList(d.cc)
    const bcc = parseList(d.bcc)
    const attachments = await Promise.all(
      d.attachments.map(async (a) => {
        if (a.fromAttachmentId) {
          const c = await this.attachmentContent(a.fromAttachmentId)
          return { filename: a.filename, content: c.content, contentType: c.contentType }
        }
        return { filename: a.filename, path: a.path! }
      })
    )
    const domain = account.email.split('@')[1] || 'maillite.local'
    const headers: Record<string, string> = { 'X-Mailer': 'Mail Lite' }
    if (d.importance === 'high') Object.assign(headers, { Importance: 'high', 'X-Priority': '1' })
    if (d.importance === 'low') Object.assign(headers, { Importance: 'low', 'X-Priority': '5' })
    if (d.requestReadReceipt) headers['Disposition-Notification-To'] = account.email
    return {
      from: { name: account.displayName || account.name, address: account.email },
      to,
      cc,
      bcc,
      subject: d.subject,
      html: withBaseFont(d.html),
      text: htmlToPlain(d.html),
      attachments,
      attachDataUrls: true,
      inReplyTo: d.inReplyTo || undefined,
      references: d.references || undefined,
      messageId: `<${crypto.randomUUID()}@${domain}>`,
      date: new Date(),
      headers
    }
  }

  private async rawOf(mail: any): Promise<Buffer> {
    const node = new MailComposer(mail).compile()
    ;(node as any).keepBcc = true
    return await node.build()
  }

  /** Gửi một thư qua transport cho trước và chép bản sao vào Thư đã gửi (nếu máy chủ không tự lưu). */
  private async deliver(account: Account, d: Draft, t: ReturnType<Engine['transport']>, extraHeaders?: Record<string, string>) {
    const mail = await this.buildMail(d, account)
    if (extraHeaders) Object.assign(mail.headers, extraHeaders)
    if (!mail.to.length && !mail.cc.length && !mail.bcc.length) throw new Error('Chưa có người nhận.')
    try {
      await t.sendMail(mail)
    } catch (e) {
      throw new Error('Gửi thư thất bại: ' + friendlyError(e))
    }
    // Gmail và Microsoft 365 tự lưu vào Thư đã gửi; máy chủ khác cần chép thủ công
    const autoSaves = /gmail\.com|googlemail\.com|office365\.com|outlook\.com/i.test(account.smtpHost)
    const sent = this.store.findFolder(account.id, { specialUse: 'sent' })
    try {
      if (sent && !autoSaves) await this.sync(account.id).append(sent.path, await this.rawOf(mail), ['\\Seen'])
    } catch {
      /* gửi đã thành công; lỗi chép Sent không nên báo thất bại */
    }
    return { mail, sent }
  }

  async send(d: Draft): Promise<void> {
    const account = this.store.getAccount(d.accountId)
    if (!account) throw new Error('Chưa chọn tài khoản gửi.')
    const t = this.transport(account, await this.getAuth(account.id))
    let res: Awaited<ReturnType<Engine['deliver']>>
    try {
      res = await this.deliver(account, d, t)
    } finally {
      t.close()
    }
    const { mail, sent } = res
    if (d.sourceMessageId && (d.mode === 'reply' || d.mode === 'replyAll')) this.setFlag([d.sourceMessageId], 'answered', true)
    if (d.draftMessageId) await this.deleteMessages([d.draftMessageId], true).catch(() => undefined)
    const toAddr = (s: string) => {
      const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/)
      return m ? { name: m[1].trim(), address: m[2].trim() } : { name: '', address: s.trim() }
    }
    this.store.touchContacts([...mail.to, ...mail.cc, ...mail.bcc].map(toAddr))
    if (sent) void this.sync(account.id).syncFolder(sent.id).catch(() => undefined)
  }

  // ---------- Hoàn tác gửi: giữ thư vài giây trước khi gửi thật ----------
  private outbox = new Map<number, { draft: Draft; timer: ReturnType<typeof setTimeout> }>()
  private outboxSeq = 0

  /** Hẹn gửi sau delaySec giây; trong lúc chờ có thể cancelSend để lấy lại thư. Trả về mã thư chờ. */
  sendLater(d: Draft, delaySec: number): number {
    if (!this.store.getAccount(d.accountId)) throw new Error('Chưa chọn tài khoản gửi.')
    if (![d.to, d.cc, d.bcc].some((x) => parseList(x).length)) throw new Error('Chưa có người nhận.')
    const id = ++this.outboxSeq
    const timer = setTimeout(() => void this.sendNow(id), Math.max(1, delaySec) * 1000)
    this.outbox.set(id, { draft: d, timer })
    return id
  }
  /** Huỷ thư đang chờ gửi và trả lại bản nháp để soạn tiếp. */
  cancelSend(id: number): Draft | null {
    const p = this.outbox.get(id)
    if (!p) return null
    clearTimeout(p.timer)
    this.outbox.delete(id)
    return p.draft
  }
  async sendNow(id: number): Promise<void> {
    const p = this.outbox.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.outbox.delete(id)
    try {
      await this.send(p.draft)
      this.opts.emit({ type: 'send-result', id, ok: true, subject: p.draft.subject })
    } catch (e: any) {
      // người dùng đã rời cửa sổ soạn → trả bản nháp về giao diện để mở lại kèm lỗi
      this.opts.emit({ type: 'send-result', id, ok: false, error: e.message, draft: p.draft, subject: p.draft.subject })
    }
  }

  async saveDraft(d: Draft): Promise<void> {
    const account = this.store.getAccount(d.accountId)
    if (!account) throw new Error('Chưa chọn tài khoản.')
    const drafts = this.store.findFolder(account.id, { specialUse: 'drafts' })
    if (!drafts) throw new Error('Tài khoản này không có thư mục Thư nháp.')
    const mail = await this.buildMail(d, account)
    await this.sync(account.id).append(drafts.path, await this.rawOf(mail), ['\\Draft', '\\Seen'])
    if (d.draftMessageId) await this.deleteMessages([d.draftMessageId], true).catch(() => undefined)
    void this.sync(account.id).syncFolder(drafts.id).catch(() => undefined)
  }

  // ---------- Trộn thư (gửi hàng loạt từ Excel/CSV) ----------
  // Đợt gửi được ghi xuống đĩa (job.json + results.jsonl) để gửi tiếp được sau khi thoát/mở lại ứng dụng.
  private merge: (Omit<MergeProgress, 'remaining' | 'subject'> & { cancel: boolean; wake?: () => void }) | null = null
  private mergeJob: MergeJob | null = null
  private mergeTask: Promise<void> | null = null
  private get mergeDir(): string {
    return path.join(this.opts.dataDir, 'merge')
  }
  private mergeLog(entry: object): void {
    try {
      appendFileSync(path.join(this.mergeDir, 'results.jsonl'), JSON.stringify(entry) + '\n')
    } catch {
      /* không ghi được nhật ký thì vẫn gửi tiếp; chỉ mất khả năng gửi tiếp sau khi thoát */
    }
  }

  /** Nạp lại đợt gửi dở từ lần chạy trước. */
  private mergeLoad(): void {
    try {
      const job = JSON.parse(readFileSync(path.join(this.mergeDir, 'job.json'), 'utf8')) as MergeJob
      let lines: any[] = []
      try {
        lines = readFileSync(path.join(this.mergeDir, 'results.jsonl'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l)
            } catch {
              return null // dòng ghi dở khi mất điện
            }
          })
          .filter(Boolean)
      } catch {
        /* chưa gửi được thư nào */
      }
      const byRow = new Map<number, any>()
      let end: { stopped?: string } | null = null
      for (const l of lines) {
        if (l.end) end = l
        else {
          byRow.delete(l.row) // giữ thứ tự theo lần ghi cuối
          byRow.set(l.row, l)
          end = null
        }
      }
      const results: MergeResult[] = [...byRow.values()].map((l) =>
        l.status === 'sending'
          ? {
              row: l.row,
              to: l.to,
              status: 'failed',
              uncertain: true,
              at: l.at,
              error: 'Ứng dụng thoát đúng lúc đang gửi thư này — không rõ đã gửi hay chưa. Hãy kiểm tra Thư đã gửi trước khi gửi lại.'
            }
          : l
      )
      this.mergeJob = job
      this.merge = {
        running: false,
        accountId: job.accountId,
        total: job.rows.length,
        results,
        cancel: false,
        stopped: end ? end.stopped : 'Đợt gửi bị ngắt giữa chừng vì ứng dụng đã thoát.'
      }
    } catch {
      /* không có đợt gửi nào được lưu */
    }
  }

  /** Chỉ số các dòng còn gửi tiếp được: chưa tới lượt hoặc gửi lỗi (trừ dòng "không rõ"). */
  private mergeRemaining(): number[] {
    if (!this.merge || !this.mergeJob) return []
    const settled = new Set(this.merge.results.filter((r) => r.status !== 'failed' || r.uncertain).map((r) => r.row))
    return this.mergeJob.rowNumbers.map((n, i) => (settled.has(n) ? -1 : i)).filter((i) => i >= 0)
  }

  mergeRead(file: string, sheet?: string): Promise<MergeData> {
    return readMergeFile(file, sheet)
  }

  /** Chuẩn bị thư cho một dòng. Trả về { skip } nếu dòng không có email; ném lỗi nếu dữ liệu sai. */
  private async mergePrepare(job: MergeJob, i: number): Promise<{ draft: Draft; to: string } | { skip: string }> {
    const rec = rowRecord(job.columns, job.rows[i])
    const col = (name?: string): string[] => (name ? splitAddresses(rec.get(fieldKey(name)) ?? '') : [])
    const to = col(job.toColumn)
    if (!to.length) return { skip: 'Không có địa chỉ email' }
    const cc = col(job.ccColumn)
    const bcc = col(job.bccColumn)
    const bad = [...to, ...cc, ...bcc].find((a) => !isEmail(a))
    if (bad) throw new Error(`Địa chỉ email không hợp lệ: ${bad}`)
    const attachments = [...job.attachments]
    if (job.attachColumn) {
      const list = (rec.get(fieldKey(job.attachColumn)) ?? '').split(/[;\n]/).map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean)
      for (const p of list) {
        const full = path.isAbsolute(p) ? p : path.resolve(job.baseDir ?? '.', p)
        let size = 0
        try {
          const st = await fs.stat(full)
          if (!st.isFile()) throw new Error('not a file')
          size = st.size
        } catch {
          throw new Error(`Không tìm thấy tệp đính kèm: ${p}`)
        }
        attachments.push({ path: full, filename: path.basename(full), size })
      }
    }
    const subject = renderTemplate(job.subject, rec, false).trim()
    return {
      to: to.join('; '),
      draft: {
        accountId: job.accountId,
        to: to.join('; '),
        cc: cc.join('; '),
        bcc: bcc.join('; '),
        subject,
        html: renderTemplate(job.html, rec, true),
        attachments,
        mode: 'new',
        importance: job.importance ?? 'normal'
      }
    }
  }

  /** Rà toàn bộ danh sách trước khi gửi: dòng thiếu email, email sai, tệp đính kèm không tồn tại, trường lạ. */
  async mergeCheck(job: MergeJob): Promise<MergeCheck> {
    const issues: MergeIssue[] = []
    let sendable = 0
    for (let i = 0; i < job.rows.length; i++) {
      try {
        const r = await this.mergePrepare(job, i)
        if ('skip' in r) issues.push({ row: job.rowNumbers[i], level: 'skip', message: r.skip })
        else sendable++
      } catch (e: any) {
        issues.push({ row: job.rowNumbers[i], level: 'error', message: e.message })
      }
    }
    const known = new Set(job.columns.map(fieldKey))
    const unknownFields = [...new Set([...templateFields(job.subject), ...templateFields(job.html)])].filter((f) => !known.has(fieldKey(f)))
    return { sendable, issues, unknownFields }
  }

  /** Gửi thử một dòng tới chính địa chỉ của tài khoản gửi để xem thư thật trông thế nào. */
  async mergeTest(job: MergeJob, index: number): Promise<string> {
    const account = this.store.getAccount(job.accountId)
    if (!account) throw new Error('Chưa chọn tài khoản gửi.')
    const r = await this.mergePrepare(job, index)
    if ('skip' in r) throw new Error(`Dòng ${job.rowNumbers[index]}: ${r.skip}`)
    await this.send({ ...r.draft, to: account.email, cc: '', bcc: '', subject: `[GỬI THỬ] ${r.draft.subject}` })
    return account.email
  }

  mergeStatus(): MergeProgress | null {
    if (!this.merge) return null
    const { cancel: _c, wake: _w, ...rest } = this.merge
    return {
      ...rest,
      results: [...rest.results],
      remaining: rest.running ? rest.total - rest.results.length : this.mergeRemaining().length,
      subject: this.mergeJob?.subject ?? ''
    }
  }

  mergeCancel(): void {
    if (!this.merge?.running) return
    this.merge.cancel = true
    this.merge.wake?.()
  }

  /** Bắt đầu gửi nền; tiến độ báo qua sự kiện merge-progress. */
  mergeStart(job: MergeJob): void {
    if (this.merge?.running) throw new Error('Đang có một đợt trộn thư chạy. Hãy chờ xong hoặc dừng nó trước.')
    const account = this.store.getAccount(job.accountId)
    if (!account) throw new Error('Chưa chọn tài khoản gửi.')
    if (!job.rows.length) throw new Error('Không có dòng nào để gửi.')
    if (!job.subject.trim()) throw new Error('Chưa nhập tiêu đề thư.')
    mkdirSync(this.mergeDir, { recursive: true })
    writeFileSync(path.join(this.mergeDir, 'job.json'), JSON.stringify(job))
    writeFileSync(path.join(this.mergeDir, 'results.jsonl'), '')
    this.mergeJob = job
    const state: NonNullable<Engine['merge']> = { running: true, accountId: account.id, total: job.rows.length, results: [], cancel: false }
    this.merge = state
    this.mergeTask = this.mergeRun(job, account, state, job.rows.map((_, i) => i))
  }

  /** Gửi tiếp các dòng còn lại của đợt gần nhất — dùng được cả sau khi thoát và mở lại ứng dụng. */
  mergeResume(opts?: { delayMs?: number }): void {
    const state = this.merge
    const job = this.mergeJob
    if (!state || !job) throw new Error('Không có đợt trộn thư nào để gửi tiếp.')
    if (state.running) throw new Error('Đợt trộn thư đang chạy.')
    const account = this.store.getAccount(job.accountId)
    if (!account) throw new Error('Tài khoản gửi của đợt này đã bị gỡ.')
    const indices = this.mergeRemaining()
    if (!indices.length) throw new Error('Đợt này không còn dòng nào cần gửi.')
    // bỏ kết quả lỗi cũ của các dòng sắp gửi lại, giữ nguyên dòng đã gửi / bỏ qua / không rõ
    const retry = new Set(indices.map((i) => job.rowNumbers[i]))
    state.results = state.results.filter((r) => !retry.has(r.row))
    state.running = true
    state.cancel = false
    state.stopped = undefined
    this.mergeTask = this.mergeRun(opts?.delayMs === undefined ? job : { ...job, delayMs: opts.delayMs }, account, state, indices)
  }

  /** Bỏ hẳn đợt gửi đã lưu (không gửi tiếp nữa). */
  async mergeDiscard(): Promise<void> {
    if (this.merge?.running) throw new Error('Hãy dừng đợt gửi trước.')
    this.merge = null
    this.mergeJob = null
    await fs.rm(this.mergeDir, { recursive: true, force: true })
    this.opts.emit({ type: 'merge-progress', running: false, total: 0, done: 0, remaining: 0 })
  }

  private async mergeRun(job: MergeJob, account: Account, state: NonNullable<Engine['merge']>, indices: number[]): Promise<void> {
    const push = (r: MergeResult): void => {
      state.results.push(r)
      this.mergeLog(r)
      this.opts.emit({ type: 'merge-progress', running: true, total: state.total, done: state.results.length, remaining: state.total - state.results.length, last: r })
    }
    let transport: ReturnType<Engine['transport']> | null = null
    let failStreak = 0
    let sentAny = false
    try {
      for (let n = 0; n < indices.length; n++) {
        const i = indices[n]
        if (state.cancel) {
          state.stopped ??= 'Bạn đã dừng đợt gửi.'
          break
        }
        const row = job.rowNumbers[i]
        let to = ''
        try {
          const r = await this.mergePrepare(job, i)
          if ('skip' in r) {
            push({ row, to: '', status: 'skipped', error: r.skip, at: Date.now() })
            continue
          }
          to = r.to
          // một kết nối SMTP dùng lại cho cả đợt; lấy lại token/kết nối nếu trước đó lỗi
          transport ??= this.transport(account, await this.getAuth(account.id))
          // đánh dấu trước khi gửi: nếu app bị tắt đúng lúc này, lần sau biết dòng này "không rõ" thay vì gửi trùng
          this.mergeLog({ row, to, status: 'sending', at: Date.now() })
          await this.deliver(account, r.draft, transport)
          push({ row, to, status: 'sent', at: Date.now() })
          failStreak = 0
          sentAny = true
        } catch (e: any) {
          push({ row, to, status: 'failed', error: e.message, at: Date.now() })
          const dataError = /không hợp lệ|Không tìm thấy tệp/.test(e.message)
          if (!dataError) {
            failStreak++
            transport?.close()
            transport = null
          }
          // lỗi máy chủ liên tiếp thường là bị giới hạn/chặn — dừng để không làm tình hình tệ hơn
          if (failStreak >= 5) {
            state.stopped = 'Đã dừng vì 5 thư liên tiếp gửi lỗi (có thể máy chủ đang giới hạn số thư). Hãy bấm “Tiếp tục gửi” sau ít phút.'
            break
          }
          continue
        }
        if (n < indices.length - 1 && job.delayMs > 0 && !state.cancel) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, job.delayMs)
            state.wake = () => {
              clearTimeout(timer)
              resolve()
            }
          })
          state.wake = undefined
        }
      }
    } finally {
      transport?.close()
      state.running = false
      this.mergeLog({ end: true, stopped: state.stopped })
      this.opts.emit({
        type: 'merge-progress',
        running: false,
        total: state.total,
        done: state.results.length,
        remaining: this.mergeRemaining().length,
        stopped: state.stopped
      })
      const sent = this.store.findFolder(account.id, { specialUse: 'sent' })
      if (sent && sentAny && !this.stopping) void this.sync(account.id).syncFolder(sent.id).catch(() => undefined)
    }
  }

  // ---------- Quy tắc + thư mới ----------
  private async applyRules(accountId: number, ids: number[], manual = false): Promise<number> {
    const rules = this.store.listRules().filter((r) => r.enabled && (r.accountId == null || r.accountId === accountId))
    if (!rules.length) return 0
    let hits = 0
    for (const id of ids) {
      const row = this.store.getMessageRow(id)
      if (!row) continue
      const subj = {
        from: `${row.from_name} ${row.from_addr}`,
        to: `${row.to_json} ${row.cc_json}`,
        subject: row.subject,
        body: row.body_text,
        hasAttachment: !!row.has_attachments
      }
      for (const rule of rules) {
        if (!ruleMatches(rule, subj)) continue
        hits++
        let gone = false
        for (const act of rule.actions) {
          if (gone) break
          if (act.type === 'markRead') this.setFlag([id], 'seen', true)
          else if (act.type === 'flag') this.setFlag([id], 'flagged', true)
          else if (act.type === 'category') this.store.setCategory([id], act.value)
          else if (act.type === 'forward') {
            // chỉ chuyển tiếp thư mới về; chạy quy tắc thủ công trên cả thư mục thì bỏ qua để không gửi hàng loạt
            if (!manual) await this.forwardByRule(id, act.to).catch(() => undefined)
          } else if (act.type === 'delete') {
            await this.deleteMessages([id])
            gone = true
          } else if (act.type === 'move') {
            const target = this.store.findFolder(accountId, { path: act.folderPath })
            if (target && target.id !== row.folder_id) {
              await this.moveMessages([id], target.id)
              gone = true
            }
          }
        }
        if (gone) break
      }
    }
    return hits
  }

  /** Tự chuyển tiếp một thư theo quy tắc, kèm nguyên tệp đính kèm. */
  private async forwardByRule(id: number, to: string): Promise<void> {
    const m = await this.getMessage(id)
    const account = m && this.store.getAccount(m.accountId)
    if (!m || !account || !m.bodyAvailable) return
    // chống vòng lặp: thư do chính quy tắc chuyển tiếp tạo ra (quay lại hộp thư này) thì không chuyển tiếp nữa
    const raw = await this.readEml({ account_id: m.accountId, folder_id: m.folderId, uid: m.uid })
    if (raw && /^X-MailLite-Auto-Forwarded:/im.test(raw.subarray(0, 16384).toString('latin1'))) return
    const targets = to.split(/[;,]/).map((x) => x.trim()).filter(Boolean)
    if (!targets.length || targets.some((t) => t.toLowerCase() === account.email.toLowerCase())) return
    const esc = (x: string): string => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const addrs = (l: { name: string; address: string }[]): string => l.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join('; ')
    const header =
      `<p style="font-size:13px"><b>Từ:</b> ${esc(addrs([m.from]))}<br><b>Đã gửi:</b> ${esc(new Date(m.date).toLocaleString('vi-VN'))}<br>` +
      `<b>Tới:</b> ${esc(addrs(m.to))}<br>${m.cc.length ? `<b>Cc:</b> ${esc(addrs(m.cc))}<br>` : ''}<b>Chủ đề:</b> ${esc(m.subject)}</p>`
    const body = m.html || `<pre>${esc(m.text)}</pre>`
    const draft: Draft = {
      accountId: account.id,
      to: targets.join('; '),
      cc: '',
      bcc: '',
      subject: /^\s*(fw|fwd)\s*:/i.test(m.subject) ? m.subject : `FW: ${m.subject}`,
      html: `<p><i>Thư được chuyển tiếp tự động theo quy tắc.</i></p><hr>${header}${body}`,
      attachments: m.attachments.filter((a) => !a.inline).map((a) => ({ filename: a.filename, size: a.size, fromAttachmentId: a.id })),
      mode: 'forward'
    }
    const t = this.transport(account, await this.getAuth(account.id))
    try {
      await this.deliver(account, draft, t, { 'X-MailLite-Auto-Forwarded': '1', 'Auto-Submitted': 'auto-forwarded' })
    } finally {
      t.close()
    }
  }

  private async onNewMessages(accountId: number, folderId: number, ids: number[], initial: boolean): Promise<void> {
    const folder = this.store.getFolder(folderId)
    if (!folder || folder.specialUse !== 'inbox' || initial) return
    await this.applyRules(accountId, ids)
    const fresh = ids.map((id) => this.store.getSummary(id)).filter((m): m is MessageSummary => !!m && !m.seen && m.folderId === folderId)
    if (fresh.length && this.store.getSettings().notifications) {
      this.opts.emit({
        type: 'new-mail',
        accountId,
        count: fresh.length,
        subject: fresh[0].subject,
        from: fresh[0].from.name || fresh[0].from.address
      })
    }
  }

  /** Chạy thủ công toàn bộ quy tắc trên một thư mục. */
  async runRules(folderId: number): Promise<number> {
    const f = this.store.getFolder(folderId)
    if (!f) return 0
    const ids = this.store.listMessages({ folderId, limit: 1_000_000 }).map((m) => m.id)
    return this.applyRules(f.accountId, ids, true)
  }
  listRules(): Rule[] {
    return this.store.listRules()
  }
  saveRule(r: Omit<Rule, 'id'> & { id?: number }): void {
    this.store.saveRule(r)
  }
  deleteRule(id: number): void {
    this.store.deleteRule(id)
  }

  // ---------- Xuất dữ liệu ----------
  async exportEml(messageId: number, dest: string): Promise<void> {
    let row = this.store.getMessageRow(messageId)
    if (!row) throw new Error('Không tìm thấy thư.')
    let raw = await this.readEml(row)
    if (!raw) {
      await this.sync(row.account_id).fetchBody(messageId)
      raw = await this.readEml(row)
    }
    if (!raw) throw new Error('Chưa tải được nội dung thư.')
    await fs.writeFile(dest, raw)
  }
  /** Xuất cả thư mục ra tệp .mbox (mở được bằng Thunderbird, Apple Mail…). */
  async exportMbox(folderId: number, dest: string): Promise<number> {
    const f = this.store.getFolder(folderId)
    if (!f) throw new Error('Không tìm thấy thư mục.')
    const out = createWriteStream(dest)
    let n = 0
    for (const m of this.store.listMessages({ folderId, limit: 1_000_000, sort: 'date-asc' })) {
      const raw = await this.readEml({ account_id: m.accountId, folder_id: m.folderId, uid: m.uid })
      if (!raw) continue
      const body = raw.toString('latin1').replace(/\r\n/g, '\n').replace(/^(>*From )/gm, '>$1')
      const head = `From ${m.from.address || 'MAILER-DAEMON'} ${new Date(m.date).toUTCString().replace(/,/g, '')}\n`
      if (!out.write(Buffer.from(head + body + '\n\n', 'latin1'))) await new Promise((r) => out.once('drain', r))
      n++
    }
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject)
      out.end(() => resolve())
    })
    return n
  }

  // ---------- Danh bạ / Lịch / Cài đặt ----------
  listContacts(search?: string, limit?: number): Contact[] {
    return this.store.listContacts(search, limit)
  }
  saveContact(c: Partial<Contact> & { email: string }): void {
    if (!/^[^@\s]+@[^@\s]+$/.test(c.email.trim())) throw new Error('Địa chỉ email không hợp lệ.')
    this.store.saveContact({ ...c, email: c.email.trim() })
  }
  deleteContact(id: number): void {
    this.store.deleteContact(id)
  }
  listEvents(from: number, to: number): CalendarEvent[] {
    return this.store.listEvents(from, to)
  }
  saveEvent(e: Omit<CalendarEvent, 'id'> & { id?: number }): number {
    if (!e.title.trim()) throw new Error('Chưa nhập tiêu đề.')
    if (e.end < e.start) throw new Error('Giờ kết thúc phải sau giờ bắt đầu.')
    return this.store.saveEvent(e)
  }
  deleteEvent(id: number): void {
    this.store.deleteEvent(id)
  }
  getSettings(): AppSettings {
    return this.store.getSettings()
  }
  setSettings(patch: Partial<AppSettings>): AppSettings {
    const s = this.store.setSettings(patch)
    if (patch.syncIntervalMin !== undefined) this.schedule()
    return s
  }
  unreadCount(): number {
    return this.store.unreadInboxCount()
  }
}
