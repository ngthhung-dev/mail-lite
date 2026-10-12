import fs from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import type { Account, Address, AppEvent, SpecialUse, SyncStatus } from '../shared/types.ts'
import type { Store, NewMessage } from './store.ts'
import { parseRaw, toParsedBody } from './mime.ts'

export type ImapAuth = { user: string; pass: string } | { user: string; accessToken: string }

export interface SyncContext {
  store: Store
  dataDir: string
  getAuth(accountId: number): Promise<ImapAuth>
  emit(e: AppEvent): void
  /** gọi sau khi thư mới đã tải xong nội dung (để chạy quy tắc + thông báo) */
  onNewMessages(accountId: number, folderId: number, ids: number[], initial: boolean): Promise<void>
}

/** Thư lớn hơn mức này chỉ tải khi người dùng mở. */
export const AUTO_BODY_MAX = 30 * 1024 * 1024
const ENVELOPE_CHUNK = 200
const BODY_CHUNK = 20

const SPECIAL: Record<string, SpecialUse> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Junk': 'junk',
  '\\Archive': 'archive'
}
/** Thư mục ảo của Gmail chứa bản trùng của mọi thư — không đồng bộ để khỏi nhân đôi dữ liệu. */
const SKIP_SPECIAL = new Set(['\\Flagged', '\\Important'])

const ORDER: Record<string, number> = { inbox: 0, sent: 1, drafts: 2, archive: 4, junk: 5, trash: 6 }

export function emlPath(dataDir: string, accountId: number, folderId: number, uid: number): string {
  return path.join(dataDir, 'mail', String(accountId), String(folderId), `${uid}.eml`)
}

function addr(list: { name?: string; address?: string }[] | undefined): Address[] {
  return (list ?? []).filter((a) => a.address).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }))
}

function structureHasAttachment(node: any): boolean {
  if (!node) return false
  if (node.childNodes?.length) return node.childNodes.some(structureHasAttachment)
  const filename = node.dispositionParameters?.filename || node.parameters?.name
  if (node.disposition === 'attachment') return true
  if (filename && !(node.disposition === 'inline' && /^image\//.test(node.type ?? ''))) {
    return !/^text\/(plain|html)$/.test(node.type ?? '') || node.disposition === 'attachment'
  }
  return false
}

export function friendlyError(e: any): string {
  const msg = String(e?.responseText || e?.message || e)
  if (e?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|auth/i.test(msg)) {
    return `Đăng nhập thất bại — kiểm tra tên đăng nhập/mật khẩu (Gmail, Yahoo, iCloud cần mật khẩu ứng dụng). Chi tiết: ${msg}`
  }
  if (e?.code === 'ENOTFOUND') return `Không tìm thấy máy chủ ${e.hostname ?? ''}. Kiểm tra địa chỉ máy chủ hoặc kết nối mạng.`
  if (e?.code === 'ECONNREFUSED') return 'Máy chủ từ chối kết nối. Kiểm tra cổng và chế độ SSL/TLS.'
  if (e?.code === 'ETIMEDOUT' || /timeout/i.test(msg)) return 'Hết thời gian chờ máy chủ. Kiểm tra mạng, cổng hoặc tường lửa.'
  if (/certificate|self.signed/i.test(msg)) return `Chứng chỉ SSL của máy chủ không hợp lệ: ${msg}`
  return msg
}

export class AccountSync {
  private client: ImapFlow | null = null
  private connecting: Promise<ImapFlow> | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private busy = false
  private stopped = false
  private existsTimer: ReturnType<typeof setTimeout> | null = null
  status: SyncStatus
  readonly accountId: number
  private ctx: SyncContext

  constructor(accountId: number, ctx: SyncContext) {
    this.accountId = accountId
    this.ctx = ctx
    this.status = { accountId, state: 'idle', message: '' }
  }

  private get store(): Store {
    return this.ctx.store
  }
  private account(): Account {
    const a = this.store.getAccount(this.accountId)
    if (!a) throw new Error('Tài khoản không còn tồn tại.')
    return a
  }
  private setStatus(state: SyncStatus['state'], message = '', progress?: SyncStatus['progress']): void {
    this.status = { accountId: this.accountId, state, message, progress }
    this.ctx.emit({ type: 'sync-status', status: this.status })
  }

  /** Xếp hàng các tác vụ cấp tài khoản để không chồng chéo nhau. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn)
    this.chain = p.catch(() => undefined)
    return p
  }

  static async verify(a: Pick<Account, 'imapHost' | 'imapPort' | 'imapSecure'>, auth: ImapAuth): Promise<void> {
    const c = new ImapFlow({
      host: a.imapHost,
      port: a.imapPort,
      secure: a.imapSecure,
      auth,
      logger: false,
      connectionTimeout: 20000,
      greetingTimeout: 15000
    })
    c.on('error', () => undefined)
    try {
      await c.connect()
      await c.logout()
    } catch (e) {
      c.close()
      throw new Error(friendlyError(e))
    }
  }

  async ensure(): Promise<ImapFlow> {
    if (this.stopped) throw new Error('Tài khoản đã dừng.')
    if (this.client?.usable) return this.client
    if (this.connecting) return this.connecting
    this.connecting = (async () => {
      const a = this.account()
      const auth = await this.ctx.getAuth(this.accountId)
      const c = new ImapFlow({
        host: a.imapHost,
        port: a.imapPort,
        secure: a.imapSecure,
        auth,
        logger: false,
        connectionTimeout: 30000,
        greetingTimeout: 20000,
        // rảnh 2 giây là vào chế độ IDLE để máy chủ đẩy thư mới ngay
        autoIdleDelay: 2000,
        clientInfo: { name: 'Mail Lite', version: '1.0.0' }
      })
      c.on('error', () => undefined)
      c.on('close', () => {
        if (this.client === c) {
          this.client = null
          if (!this.stopped && this.status.state !== 'error') this.setStatus('offline', 'Mất kết nối')
        }
      })
      c.on('exists', (d: { path: string; count: number; prevCount: number }) => {
        if (this.busy || d.count <= d.prevCount) return
        if (this.existsTimer) clearTimeout(this.existsTimer)
        this.existsTimer = setTimeout(() => {
          const f = this.store.findFolder(this.accountId, { path: d.path })
          if (f) void this.syncFolder(f.id).catch(() => undefined)
        }, 1500)
      })
      await c.connect()
      this.client = c
      return c
    })().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.existsTimer) clearTimeout(this.existsTimer)
    const c = this.client
    this.client = null
    if (c) {
      try {
        await Promise.race([c.logout(), new Promise((r) => setTimeout(r, 3000))])
      } catch {
        /* bỏ qua */
      }
      c.close()
    }
  }

  // ---------- Đồng bộ ----------
  syncAll(): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return
      this.busy = true
      try {
        this.setStatus('connecting', 'Đang kết nối…')
        const client = await this.ensure()
        await this.flushOpsInner(client)
        this.setStatus('syncing', 'Đang lấy danh sách thư mục…')
        await this.syncFolderList(client)
        const folders = this.store
          .listFolders(this.accountId)
          .filter((f) => this.store.isSelectable(f.id))
          .sort((a, b) => (ORDER[a.specialUse ?? ''] ?? 3) - (ORDER[b.specialUse ?? ''] ?? 3))
        // Lượt 1: tiêu đề thư của mọi thư mục (nhanh) — Lượt 2: nội dung đầy đủ để dùng offline
        const pendingNew: { folderId: number; ids: number[]; initial: boolean }[] = []
        for (const f of folders) {
          if (this.stopped) return
          this.setStatus('syncing', `Đang đồng bộ ${f.name}…`)
          try {
            pendingNew.push(await this.syncHeaders(client, f.id))
          } catch (e) {
            if (!client.usable) throw e
          }
        }
        for (const f of folders) {
          if (this.stopped) return
          await this.downloadBodies(client, f.id, f.name)
          const p = pendingNew.find((x) => x.folderId === f.id)
          if (p?.ids.length) await this.ctx.onNewMessages(this.accountId, f.id, p.ids, p.initial)
        }
        await this.flushOpsInner(client)
        await this.selectInbox(client)
        this.store.setAccountStatus(this.accountId, Date.now(), null)
        this.setStatus('idle', 'Đã đồng bộ')
        this.ctx.emit({ type: 'accounts-changed' })
      } catch (e) {
        const msg = friendlyError(e)
        this.store.setAccountStatus(this.accountId, null, msg)
        this.setStatus('error', msg)
        throw new Error(msg)
      } finally {
        this.busy = false
      }
    })
  }

  syncFolder(folderId: number): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return
      this.busy = true
      try {
        const client = await this.ensure()
        await this.flushOpsInner(client)
        const f = this.store.getFolder(folderId)
        if (!f || !f.selectable) return
        this.setStatus('syncing', `Đang đồng bộ ${f.name}…`)
        const res = await this.syncHeaders(client, folderId)
        await this.downloadBodies(client, folderId, f.name)
        if (res.ids.length) await this.ctx.onNewMessages(this.accountId, folderId, res.ids, res.initial)
        await this.flushOpsInner(client)
        await this.selectInbox(client)
        this.setStatus('idle', 'Đã đồng bộ')
      } catch (e) {
        this.setStatus('error', friendlyError(e))
      } finally {
        this.busy = false
      }
    })
  }

  /** Chọn lại Hộp thư đến để máy chủ đẩy thông báo thư mới (IDLE). */
  private async selectInbox(client: ImapFlow): Promise<void> {
    const inbox = this.store.findFolder(this.accountId, { specialUse: 'inbox' })
    if (!inbox || !client.usable) return
    const lock = await client.getMailboxLock(inbox.path)
    lock.release()
  }

  private async syncFolderList(client: ImapFlow): Promise<void> {
    const list = await client.list()
    const out = list
      // Gmail gắn \\Important / \\Flagged ở cờ thư mục; imapflow không phải lúc nào cũng đưa vào specialUse
      .filter((b) => !(b.specialUse && SKIP_SPECIAL.has(b.specialUse)) && ![...SKIP_SPECIAL].some((f) => b.flags?.has(f)))
      .map((b) => ({
        path: b.path,
        name: b.name,
        delimiter: b.delimiter || '/',
        specialUse: (b.path.toUpperCase() === 'INBOX' ? 'inbox' : (SPECIAL[b.specialUse ?? ''] ?? null)) as SpecialUse,
        selectable: !b.flags?.has('\\Noselect') && !b.flags?.has('\\NonExistent'),
        all: b.specialUse === '\\All'
      }))
    // Gmail không có thư mục Lưu trữ riêng: "lưu trữ" = chuyển sang "Tất cả thư".
    // Ghi nhớ đường dẫn đó làm đích lưu trữ nhưng không đồng bộ nội dung (toàn bản trùng).
    const hasArchive = out.some((f) => f.specialUse === 'archive')
    for (const f of out) {
      if (!f.all) continue
      f.selectable = false
      if (!hasArchive) f.specialUse = 'archive'
    }
    // mỗi loại thư mục đặc biệt chỉ giữ một
    const seen = new Set<string>()
    for (const f of out) {
      if (!f.specialUse) continue
      if (seen.has(f.specialUse)) f.specialUse = null
      else seen.add(f.specialUse)
    }
    this.store.upsertFolders(this.accountId, out)
    this.ctx.emit({ type: 'folders-changed', accountId: this.accountId })
  }

  private async syncHeaders(
    client: ImapFlow,
    folderId: number
  ): Promise<{ folderId: number; ids: number[]; initial: boolean }> {
    const store = this.store
    const account = this.account()
    const folder = store.getFolder(folderId)
    if (!folder) return { folderId, ids: [], initial: true }
    const initial = folder.lastSync == null
    const newIds: number[] = []
    const lock = await client.getMailboxLock(folder.path)
    try {
      const mb = client.mailbox
      if (!mb) throw new Error(`Không mở được thư mục ${folder.path}`)
      const validity = String(mb.uidValidity)
      if (folder.uidvalidity && folder.uidvalidity !== validity) {
        store.clearFolderMessages(folderId)
        await fs.rm(path.join(this.ctx.dataDir, 'mail', String(this.accountId), String(folderId)), {
          recursive: true,
          force: true
        })
      }
      const local = store.uidMap(folderId)
      const server = new Map<number, Set<string>>()
      let minUid = 1
      if (mb.exists > 0) {
        if (account.syncDays > 0) {
          const since = new Date(Date.now() - account.syncDays * 86400_000)
          const uids = (await client.search({ since }, { uid: true })) || []
          minUid = uids.length ? uids.reduce((a, b) => (a < b ? a : b)) : mb.uidNext
        }
        if (minUid < mb.uidNext) {
          for await (const m of client.fetch(`${minUid}:*`, { uid: true, flags: true }, { uid: true })) {
            if (m.uid >= minUid) server.set(m.uid, m.flags ?? new Set())
          }
        }
      }

      // Thư đã bị xoá/chuyển đi trên máy chủ
      const removed: number[] = []
      for (const [uid, row] of local) {
        if (uid >= minUid && !server.has(uid)) {
          removed.push(row.id)
          await fs.rm(emlPath(this.ctx.dataDir, this.accountId, folderId, uid), { force: true })
        }
      }
      if (removed.length) store.deleteMessages(removed)

      // Cờ thay đổi + thư mới
      const newUids: number[] = []
      let flagChanges = 0
      store.tx(() => {
        for (const [uid, flags] of server) {
          const row = local.get(uid)
          if (!row) {
            newUids.push(uid)
            continue
          }
          const seen = flags.has('\\Seen') ? 1 : 0
          const flagged = flags.has('\\Flagged') ? 1 : 0
          const answered = flags.has('\\Answered') ? 1 : 0
          if (seen !== row.seen || flagged !== row.flagged || answered !== row.answered) {
            store.updateFlags(row.id, { seen: !!seen, flagged: !!flagged, answered: !!answered })
            flagChanges++
          }
        }
      })
      if (removed.length || flagChanges) this.ctx.emit({ type: 'mail-changed', accountId: this.accountId, folderIds: [folderId] })

      newUids.sort((a, b) => b - a)
      for (let i = 0; i < newUids.length; i += ENVELOPE_CHUNK) {
        if (this.stopped) break
        const chunk = newUids.slice(i, i + ENVELOPE_CHUNK)
        const rows: NewMessage[] = []
        for await (const m of client.fetch(
          chunk.join(','),
          { uid: true, envelope: true, flags: true, bodyStructure: true, size: true, internalDate: true },
          { uid: true }
        )) {
          const env = m.envelope ?? {}
          const flags = m.flags ?? new Set<string>()
          const from = addr(env.from)[0] ?? addr(env.sender)[0] ?? { name: '', address: '' }
          const date = env.date ? new Date(env.date).getTime() : m.internalDate ? new Date(m.internalDate).getTime() : Date.now()
          rows.push({
            accountId: this.accountId,
            folderId,
            uid: m.uid,
            messageId: env.messageId ?? '',
            inReplyTo: env.inReplyTo ?? '',
            refs: '',
            subject: env.subject ?? '',
            from,
            to: addr(env.to),
            cc: addr(env.cc),
            bcc: addr(env.bcc),
            replyTo: addr(env.replyTo),
            date: Number.isFinite(date) ? date : Date.now(),
            size: m.size ?? 0,
            seen: flags.has('\\Seen'),
            flagged: flags.has('\\Flagged'),
            answered: flags.has('\\Answered'),
            draft: flags.has('\\Draft') || folder.specialUse === 'drafts',
            hasAttachments: structureHasAttachment(m.bodyStructure)
          })
        }
        store.tx(() => {
          for (const r of rows) {
            const id = store.insertMessage(r)
            if (id) newIds.push(id)
          }
        })
        this.ctx.emit({ type: 'mail-changed', accountId: this.accountId, folderIds: [folderId] })
        if (newUids.length > ENVELOPE_CHUNK) {
          this.setStatus('syncing', `Đang đồng bộ ${folder.name}…`, {
            done: Math.min(i + ENVELOPE_CHUNK, newUids.length),
            total: newUids.length
          })
        }
      }
      store.setFolderSync(folderId, validity, Date.now())
    } finally {
      lock.release()
    }
    return { folderId, ids: newIds, initial }
  }

  private async saveBody(id: number, folderId: number, uid: number, source: Buffer): Promise<void> {
    const file = emlPath(this.ctx.dataDir, this.accountId, folderId, uid)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, source)
    const mail = await parseRaw(source)
    this.store.setBody(id, toParsedBody(mail))
  }

  private async downloadBodies(client: ImapFlow, folderId: number, name: string): Promise<void> {
    const store = this.store
    const folder = store.getFolder(folderId)
    if (!folder) return
    const total = store.countWithoutBody(folderId, AUTO_BODY_MAX)
    if (!total) return
    let done = 0
    const failed = new Set<number>()
    while (!this.stopped) {
      const batch = store
        .messagesWithoutBody(folderId, AUTO_BODY_MAX, BODY_CHUNK + failed.size)
        .filter((b) => !failed.has(b.id))
        .slice(0, BODY_CHUNK)
      if (!batch.length) break
      // khoá theo từng lô để thao tác của người dùng chen vào được
      const lock = await client.getMailboxLock(folder.path)
      const got = new Set<number>()
      try {
        const byUid = new Map(batch.map((b) => [b.uid, b.id]))
        for await (const m of client.fetch(batch.map((b) => b.uid).join(','), { uid: true, source: true }, { uid: true })) {
          const id = byUid.get(m.uid)
          if (!id || !m.source) continue
          try {
            await this.saveBody(id, folderId, m.uid, m.source)
            got.add(id)
          } catch {
            /* thư hỏng định dạng — bỏ qua, thử lại lần đồng bộ sau */
          }
        }
      } finally {
        lock.release()
      }
      for (const b of batch) if (!got.has(b.id)) failed.add(b.id)
      done += batch.length
      this.setStatus('syncing', `Đang tải nội dung thư ${name}…`, { done: Math.min(done, total), total })
      this.ctx.emit({ type: 'mail-changed', accountId: this.accountId, folderIds: [folderId] })
    }
  }

  /** Tải nội dung một thư ngay (khi người dùng mở thư chưa có sẵn). */
  async fetchBody(messageId: number): Promise<void> {
    const row = this.store.getMessageRow(messageId)
    if (!row) return
    const folder = this.store.getFolder(row.folder_id)
    if (!folder) return
    const client = await this.ensure()
    const lock = await client.getMailboxLock(folder.path)
    try {
      const m = await client.fetchOne(String(row.uid), { uid: true, source: true }, { uid: true })
      if (m && m.source) await this.saveBody(messageId, folder.id, row.uid, m.source)
    } finally {
      lock.release()
    }
  }

  // ---------- Thao tác ----------
  flushOps(): Promise<void> {
    return this.enqueue(async () => {
      try {
        const client = await this.ensure()
        await this.flushOpsInner(client)
      } catch {
        /* offline — giữ trong hàng đợi */
      }
    })
  }

  private async flushOpsInner(client: ImapFlow): Promise<void> {
    for (const op of this.store.pendingOps(this.accountId)) {
      const p = op.payload as { path: string; uids: number[]; all?: boolean; add?: string[]; remove?: string[]; target?: string }
      // all = toàn bộ thư trong thư mục trên máy chủ (kể cả thư chưa đồng bộ về máy)
      const range = p.all ? '1:*' : p.uids.join(',')
      try {
        const lock = await client.getMailboxLock(p.path)
        try {
          if (p.all && !(client.mailbox && client.mailbox.exists > 0)) {
            /* thư mục đã trống */
          } else if (op.type === 'flags') {
            if (p.add?.length) await client.messageFlagsAdd(range, p.add, { uid: true })
            if (p.remove?.length) await client.messageFlagsRemove(range, p.remove, { uid: true })
          } else if (op.type === 'move' && p.target) {
            await client.messageMove(range, p.target, { uid: true })
          } else if (op.type === 'delete') {
            await client.messageDelete(range, { uid: true })
          }
        } finally {
          lock.release()
        }
        this.store.removeOp(op.id)
      } catch (e) {
        if (!client.usable) throw e
        // máy chủ từ chối (thư mục đã mất, thư không còn…) — thử tối đa 3 lần rồi bỏ
        if (op.attempts >= 2) this.store.removeOp(op.id)
        else this.store.bumpOp(op.id)
      }
    }
  }

  async append(folderPath: string, raw: Buffer, flags: string[]): Promise<void> {
    const client = await this.ensure()
    await client.append(folderPath, raw, flags)
  }

  async createFolder(pathParts: string[]): Promise<void> {
    const client = await this.ensure()
    await client.mailboxCreate(pathParts)
    await this.syncFolderList(client)
  }
  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    const client = await this.ensure()
    await client.mailboxRename(oldPath, newPath)
    await this.syncFolderList(client)
  }
  async deleteFolder(folderPath: string): Promise<void> {
    const client = await this.ensure()
    await client.mailboxDelete(folderPath)
    await this.syncFolderList(client)
  }
}
