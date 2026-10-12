import { DatabaseSync } from 'node:sqlite'
import type {
  Account,
  AccountInput,
  Address,
  AppSettings,
  CalendarEvent,
  Contact,
  Folder,
  ListQuery,
  MessageSummary,
  Rule,
  SpecialUse
} from '../shared/types.ts'
import { DEFAULT_SETTINGS } from '../shared/types.ts'

type Row = Record<string, any>

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'imap',
  auth_type TEXT NOT NULL DEFAULT 'password',
  imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL DEFAULT 1,
  smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL, smtp_secure INTEGER NOT NULL DEFAULT 1,
  username TEXT NOT NULL,
  secret TEXT NOT NULL DEFAULT '',
  signature_html TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#0f6cbd',
  sync_days INTEGER NOT NULL DEFAULT 90,
  last_sync INTEGER,
  last_error TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  delimiter TEXT NOT NULL DEFAULT '/',
  special_use TEXT,
  selectable INTEGER NOT NULL DEFAULT 1,
  uidvalidity TEXT,
  last_sync INTEGER,
  UNIQUE(account_id, path)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  in_reply_to TEXT NOT NULL DEFAULT '',
  refs TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  from_addr TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  reply_to_json TEXT NOT NULL DEFAULT '[]',
  date INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  seen INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  answered INTEGER NOT NULL DEFAULT 0,
  draft INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_fetched INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  UNIQUE(folder_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_msg_folder_date ON messages(folder_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_msg_folder_seen ON messages(folder_id, seen);
CREATE INDEX IF NOT EXISTS idx_msg_body ON messages(folder_id, body_fetched);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  content_id TEXT NOT NULL DEFAULT '',
  inline INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_att_msg ON attachments(message_id);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  subject, sender, recipients, body, tokenize = "unicode61 remove_diacritics 2"
);

CREATE TABLE IF NOT EXISTS pending_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  auto INTEGER NOT NULL DEFAULT 0,
  freq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  reminder_min INTEGER,
  color TEXT NOT NULL DEFAULT '#0f6cbd',
  notified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  match TEXT NOT NULL DEFAULT 'all',
  conditions TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

const SUMMARY_COLS = `m.id, m.account_id, m.folder_id, m.uid, m.subject, m.from_name, m.from_addr, m.to_json,
  m.date, m.size, m.seen, m.flagged, m.answered, m.draft, m.has_attachments, m.snippet, m.category, m.pinned,
  m.thread_key,
  (SELECT COUNT(DISTINCT CASE WHEN t.message_id <> '' THEN t.message_id ELSE 'id:' || t.id END) FROM messages t
    WHERE m.thread_key <> '' AND t.account_id = m.account_id AND t.thread_key = m.thread_key
      AND t.folder_id NOT IN (SELECT id FROM folders WHERE special_use IN ('trash','junk','drafts'))) AS thread_count`

function parseAddrs(json: string): Address[] {
  try {
    return JSON.parse(json) as Address[]
  } catch {
    return []
  }
}

export function rowToSummary(r: Row): MessageSummary {
  return {
    id: r.id,
    accountId: r.account_id,
    folderId: r.folder_id,
    uid: r.uid,
    subject: r.subject,
    from: { name: r.from_name, address: r.from_addr },
    to: parseAddrs(r.to_json),
    date: r.date,
    size: r.size,
    seen: !!r.seen,
    flagged: !!r.flagged,
    answered: !!r.answered,
    draft: !!r.draft,
    hasAttachments: !!r.has_attachments,
    snippet: r.snippet,
    category: r.category ?? null,
    pinned: !!r.pinned,
    threadKey: r.thread_key ?? '',
    threadCount: r.thread_count ?? 1
  }
}

export function threadKey(refs: string, inReplyTo: string, messageId: string): string {
  return refs.trim().split(/\s+/)[0] || inReplyTo.trim() || messageId.trim()
}

function rowToAccount(r: Row): Account {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    displayName: r.display_name,
    provider: r.provider,
    authType: r.auth_type,
    imapHost: r.imap_host,
    imapPort: r.imap_port,
    imapSecure: !!r.imap_secure,
    smtpHost: r.smtp_host,
    smtpPort: r.smtp_port,
    smtpSecure: !!r.smtp_secure,
    username: r.username,
    signatureHtml: r.signature_html,
    color: r.color,
    syncDays: r.sync_days,
    lastSync: r.last_sync ?? null,
    lastError: r.last_error ?? null
  }
}

/** "đ" là chữ cái riêng nên FTS không tự bỏ dấu được — quy về "d" để gõ "hoa don" vẫn ra "hoá đơn". */
const vn = (s: string): string => s.replace(/đ/g, 'd').replace(/Đ/g, 'D')

/** Bỏ dấu + chữ thường: "Trần Thị Mai" → "tran thi mai". */
export function fold(s: string): string {
  return vn(s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).toLowerCase()
}

/** Biến chuỗi người dùng gõ thành truy vấn FTS5 an toàn (khớp tiền tố từng từ). */
export function toFtsQuery(input: string): string {
  const tokens = vn(input)
    .split(/\s+/)
    .map((t) => t.replace(/["']/g, '').trim())
    .filter(Boolean)
  return tokens.map((t) => `"${t}"*`).join(' ')
}

/** Truy vấn khớp nguyên cụm: các từ đứng liền nhau đúng thứ tự (từ cuối khớp tiền tố vì có thể đang gõ dở). Rỗng nếu chỉ có một từ. */
export function toFtsPhrase(input: string): string {
  const tokens = vn(input)
    .split(/\s+/)
    .map((t) => t.replace(/["']/g, '').trim())
    .filter(Boolean)
  return tokens.length > 1 ? `"${tokens.join(' ')}" *` : ''
}

export interface NewMessage {
  accountId: number
  folderId: number
  uid: number
  messageId: string
  inReplyTo: string
  refs: string
  subject: string
  from: Address
  to: Address[]
  cc: Address[]
  bcc: Address[]
  replyTo: Address[]
  date: number
  size: number
  seen: boolean
  flagged: boolean
  answered: boolean
  draft: boolean
  hasAttachments: boolean
}

export interface ParsedBody {
  text: string
  html: string
  snippet: string
  refs?: string
  attachments: { idx: number; filename: string; contentType: string; size: number; contentId: string; inline: boolean }[]
}

export interface PendingOp {
  id: number
  accountId: number
  type: 'flags' | 'move' | 'delete'
  payload: any
  attempts: number
}

export class Store {
  db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(SCHEMA)
    this.migrate()
    // so khớp không phân biệt hoa thường và dấu tiếng Việt cho các ô lọc theo người gửi/nhận/chủ đề
    this.db.function('fold', { deterministic: true }, (v: unknown) => fold(v == null ? '' : String(v)))
  }

  /** Nâng cấp cơ sở dữ liệu của bản cũ mà không mất thư đã đồng bộ. */
  private migrate(): void {
    // thứ tự thư mục do người dùng kéo thả (NULL = thứ tự mặc định)
    const fcols = new Set(this.all('PRAGMA table_info(folders)').map((r) => r.name as string))
    if (!fcols.has('sort_order')) this.db.exec('ALTER TABLE folders ADD COLUMN sort_order INTEGER')
    const cols = new Set(this.all('PRAGMA table_info(messages)').map((r) => r.name as string))
    if (!cols.has('pinned')) this.db.exec('ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
    if (!cols.has('thread_key')) {
      this.db.exec("ALTER TABLE messages ADD COLUMN thread_key TEXT NOT NULL DEFAULT ''")
      // khoá hội thoại = thư gốc của chuỗi: id đầu tiên trong References, không có thì In-Reply-To, rồi Message-ID
      this.db.exec(`UPDATE messages SET thread_key = CASE
        WHEN trim(refs) <> '' THEN substr(trim(refs), 1, instr(trim(refs) || ' ', ' ') - 1)
        WHEN in_reply_to <> '' THEN in_reply_to ELSE message_id END`)
    }
    // Sửa dữ liệu của bản trước: ảnh đính kèm bị coi nhầm là "ảnh nhúng" nên không hiện trong danh sách tệp
    if (!this.get("SELECT 1 AS x FROM settings WHERE key = '_fix_inline_1'")) {
      this.db.exec(`
        UPDATE attachments SET inline = 0 WHERE inline = 1 AND (content_id = '' OR NOT EXISTS (
          SELECT 1 FROM messages m WHERE m.id = attachments.message_id AND instr(m.body_html, 'cid:' || attachments.content_id) > 0));
        UPDATE messages SET has_attachments = 1 WHERE has_attachments = 0 AND body_fetched = 1
          AND id IN (SELECT message_id FROM attachments WHERE inline = 0);
        INSERT OR REPLACE INTO settings(key, value) VALUES('_fix_inline_1', '1');`)
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(account_id, thread_key);
      CREATE INDEX IF NOT EXISTS idx_msg_mid ON messages(account_id, message_id);
      CREATE TABLE IF NOT EXISTS pinned_threads (
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        thread_key TEXT NOT NULL,
        PRIMARY KEY (account_id, thread_key)
      );`)
  }

  /**
   * Khoá hội thoại của một thư. Nếu thư chỉ trỏ tới thư liền trước (không có chuỗi References đầy đủ)
   * thì đi theo khoá của thư đó, để cả chuỗi trả lời vẫn về chung một cuộc hội thoại.
   */
  private resolveThreadKey(accountId: number, refs: string, inReplyTo: string, messageId: string): string {
    const base = threadKey(refs, inReplyTo, messageId)
    if (!base || base === messageId.trim()) return base
    const parent = this.get("SELECT thread_key FROM messages WHERE account_id = ? AND message_id = ? AND thread_key <> '' LIMIT 1", accountId, base)
    return (parent?.thread_key as string) || base
  }

  private isPinnedThread(accountId: number, key: string): boolean {
    return !!key && !!this.get('SELECT 1 AS x FROM pinned_threads WHERE account_id = ? AND thread_key = ?', accountId, key)
  }

  /** Ghim / bỏ ghim cả cuộc hội thoại chứa các thư này. Ghim chỉ lưu trên máy. */
  setPinned(ids: number[], value: boolean): void {
    this.tx(() => {
      for (const id of ids) {
        const r = this.get('SELECT account_id, thread_key FROM messages WHERE id = ?', id)
        if (!r) continue
        if (!r.thread_key) {
          this.run('UPDATE messages SET pinned = ? WHERE id = ?', value ? 1 : 0, id)
          continue
        }
        if (value) this.run('INSERT OR IGNORE INTO pinned_threads(account_id, thread_key) VALUES(?, ?)', r.account_id, r.thread_key)
        else this.run('DELETE FROM pinned_threads WHERE account_id = ? AND thread_key = ?', r.account_id, r.thread_key)
        this.run('UPDATE messages SET pinned = ? WHERE account_id = ? AND thread_key = ?', value ? 1 : 0, r.account_id, r.thread_key)
      }
    })
  }

  close(): void {
    this.db.close()
  }

  private all(sql: string, ...params: any[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[]
  }
  private get(sql: string, ...params: any[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined
  }
  private run(sql: string, ...params: any[]) {
    return this.db.prepare(sql).run(...params)
  }
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  // ---------- Cài đặt ----------
  getSettings(): AppSettings {
    const rows = this.all('SELECT key, value FROM settings')
    const out: any = { ...DEFAULT_SETTINGS }
    for (const r of rows) {
      if (String(r.key).startsWith('_')) continue // khoá nội bộ (đánh dấu đã nâng cấp dữ liệu)
      try {
        out[r.key] = JSON.parse(r.value)
      } catch {
        /* bỏ qua giá trị hỏng */
      }
    }
    return out
  }
  setSettings(patch: Partial<AppSettings>): AppSettings {
    for (const [k, v] of Object.entries(patch)) {
      this.run(
        'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        k,
        JSON.stringify(v)
      )
    }
    return this.getSettings()
  }

  // ---------- Tài khoản ----------
  listAccounts(): Account[] {
    return this.all('SELECT * FROM accounts ORDER BY sort, id').map(rowToAccount)
  }
  getAccount(id: number): Account | null {
    const r = this.get('SELECT * FROM accounts WHERE id = ?', id)
    return r ? rowToAccount(r) : null
  }
  getSecret(id: number): string {
    return (this.get('SELECT secret FROM accounts WHERE id = ?', id)?.secret as string) ?? ''
  }
  setSecret(id: number, secret: string): void {
    this.run('UPDATE accounts SET secret = ? WHERE id = ?', secret, id)
  }
  saveAccount(a: AccountInput, secret?: string): Account {
    const vals = [
      a.name,
      a.email,
      a.displayName,
      a.provider,
      a.authType,
      a.imapHost,
      a.imapPort,
      a.imapSecure ? 1 : 0,
      a.smtpHost,
      a.smtpPort,
      a.smtpSecure ? 1 : 0,
      a.username,
      a.signatureHtml ?? '',
      a.color ?? '#0f6cbd',
      a.syncDays ?? 90
    ]
    let id = a.id
    if (id) {
      this.run(
        `UPDATE accounts SET name=?, email=?, display_name=?, provider=?, auth_type=?, imap_host=?, imap_port=?,
         imap_secure=?, smtp_host=?, smtp_port=?, smtp_secure=?, username=?, signature_html=?, color=?, sync_days=?
         WHERE id=?`,
        ...vals,
        id
      )
    } else {
      const r = this.run(
        `INSERT INTO accounts(name, email, display_name, provider, auth_type, imap_host, imap_port, imap_secure,
         smtp_host, smtp_port, smtp_secure, username, signature_html, color, sync_days)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ...vals
      )
      id = Number(r.lastInsertRowid)
      // tài khoản mới xếp cuối danh sách (sau thứ tự người dùng đã kéo thả)
      this.run('UPDATE accounts SET sort = (SELECT COALESCE(MAX(sort), 0) + 1 FROM accounts) WHERE id = ?', id)
    }
    if (secret !== undefined) this.setSecret(id, secret)
    return this.getAccount(id)!
  }
  /** Đặt thứ tự các thư mục cùng cấp theo danh sách id (chỉ lưu trên máy, không đổi gì trên máy chủ). */
  reorderFolders(ids: number[]): void {
    this.tx(() => ids.forEach((id, i) => this.run('UPDATE folders SET sort_order = ? WHERE id = ?', i + 1, id)))
  }
  /** Đặt lại thứ tự hiển thị tài khoản theo danh sách id (kéo thả trên cây thư mục). */
  reorderAccounts(ids: number[]): void {
    this.tx(() => ids.forEach((id, i) => this.run('UPDATE accounts SET sort = ? WHERE id = ?', i + 1, id)))
  }
  folderRows(folderId: number): { id: number; uid: number; account_id: number; folder_id: number }[] {
    return this.all('SELECT id, uid, account_id, folder_id FROM messages WHERE folder_id = ?', folderId) as any
  }
  deleteAccount(id: number): void {
    this.tx(() => {
      this.run('DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE account_id = ?)', id)
      this.run('DELETE FROM accounts WHERE id = ?', id)
    })
  }
  setAccountStatus(id: number, lastSync: number | null, error: string | null): void {
    if (lastSync) this.run('UPDATE accounts SET last_sync = ?, last_error = ? WHERE id = ?', lastSync, error, id)
    else this.run('UPDATE accounts SET last_error = ? WHERE id = ?', error, id)
  }

  // ---------- Thư mục ----------
  listFolders(accountId?: number): Folder[] {
    const rows = this.all(
      `SELECT f.*,
        (SELECT COUNT(*) FROM messages m WHERE m.folder_id = f.id) AS total,
        (SELECT COUNT(*) FROM messages m WHERE m.folder_id = f.id AND m.seen = 0) AS unread
       FROM folders f ${accountId ? 'WHERE f.account_id = ?' : ''} ORDER BY f.account_id, f.path COLLATE NOCASE`,
      ...(accountId ? [accountId] : [])
    )
    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      path: r.path,
      name: r.name,
      delimiter: r.delimiter,
      specialUse: (r.special_use as SpecialUse) ?? null,
      selectable: !!r.selectable,
      sortOrder: r.sort_order ?? null,
      total: r.total,
      unread: r.unread
    }))
  }
  getFolder(id: number): (Folder & { uidvalidity: string | null; lastSync: number | null }) | null {
    const r = this.get('SELECT * FROM folders WHERE id = ?', id)
    if (!r) return null
    return {
      id: r.id,
      accountId: r.account_id,
      path: r.path,
      name: r.name,
      delimiter: r.delimiter,
      specialUse: r.special_use ?? null,
      selectable: !!r.selectable,
      total: 0,
      unread: 0,
      uidvalidity: r.uidvalidity ?? null,
      lastSync: r.last_sync ?? null
    }
  }
  findFolder(accountId: number, opts: { path?: string; specialUse?: SpecialUse }): Folder | null {
    const r = opts.path
      ? this.get('SELECT id FROM folders WHERE account_id = ? AND path = ?', accountId, opts.path)
      : this.get('SELECT id FROM folders WHERE account_id = ? AND special_use = ?', accountId, opts.specialUse ?? '')
    return r ? this.getFolder(r.id) : null
  }
  /** Đồng bộ danh sách thư mục từ server; trả về id các thư mục. */
  upsertFolders(
    accountId: number,
    list: { path: string; name: string; delimiter: string; specialUse: SpecialUse; selectable: boolean }[]
  ): void {
    this.tx(() => {
      const existing = this.all('SELECT id, path FROM folders WHERE account_id = ?', accountId)
      const keep = new Set(list.map((f) => f.path))
      for (const e of existing) {
        if (!keep.has(e.path)) this.deleteFolderLocal(e.id)
      }
      for (const f of list) {
        this.run(
          `INSERT INTO folders(account_id, path, name, delimiter, special_use, selectable) VALUES(?,?,?,?,?,?)
           ON CONFLICT(account_id, path) DO UPDATE SET name = excluded.name, delimiter = excluded.delimiter,
           special_use = excluded.special_use, selectable = excluded.selectable`,
          accountId,
          f.path,
          f.name,
          f.delimiter,
          f.specialUse,
          f.selectable ? 1 : 0
        )
      }
    })
  }
  deleteFolderLocal(folderId: number): void {
    this.run('DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE folder_id = ?)', folderId)
    this.run('DELETE FROM folders WHERE id = ?', folderId)
  }
  setFolderSync(folderId: number, uidvalidity: string, lastSync: number): void {
    this.run('UPDATE folders SET uidvalidity = ?, last_sync = ? WHERE id = ?', uidvalidity, lastSync, folderId)
  }
  clearFolderMessages(folderId: number): void {
    this.tx(() => {
      this.run('DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE folder_id = ?)', folderId)
      this.run('DELETE FROM messages WHERE folder_id = ?', folderId)
    })
  }
  isSelectable(folderId: number): boolean {
    return !!this.get('SELECT selectable FROM folders WHERE id = ?', folderId)?.selectable
  }

  // ---------- Thư ----------
  uidMap(folderId: number): Map<number, { id: number; seen: number; flagged: number; answered: number; draft: number }> {
    const m = new Map()
    for (const r of this.all('SELECT id, uid, seen, flagged, answered, draft FROM messages WHERE folder_id = ?', folderId)) {
      m.set(r.uid, r)
    }
    return m
  }
  insertMessage(m: NewMessage): number {
    const key = this.resolveThreadKey(m.accountId, m.refs, m.inReplyTo, m.messageId)
    const r = this.run(
      `INSERT OR IGNORE INTO messages(account_id, folder_id, uid, message_id, in_reply_to, refs, subject, from_name,
        from_addr, to_json, cc_json, bcc_json, reply_to_json, date, size, seen, flagged, answered, draft, has_attachments,
        thread_key, pinned)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      m.accountId,
      m.folderId,
      m.uid,
      m.messageId,
      m.inReplyTo,
      m.refs,
      m.subject,
      m.from.name,
      m.from.address,
      JSON.stringify(m.to),
      JSON.stringify(m.cc),
      JSON.stringify(m.bcc),
      JSON.stringify(m.replyTo),
      m.date,
      m.size,
      m.seen ? 1 : 0,
      m.flagged ? 1 : 0,
      m.answered ? 1 : 0,
      m.draft ? 1 : 0,
      m.hasAttachments ? 1 : 0,
      key,
      this.isPinnedThread(m.accountId, key) ? 1 : 0
    )
    if (!r.changes) return 0
    const id = Number(r.lastInsertRowid)
    this.run(
      'INSERT INTO messages_fts(rowid, subject, sender, recipients, body) VALUES(?,?,?,?,?)',
      id,
      vn(m.subject),
      vn(`${m.from.name} ${m.from.address}`),
      vn([...m.to, ...m.cc].map((a) => `${a.name} ${a.address}`).join(' ')),
      ''
    )
    return id
  }
  setBody(id: number, b: ParsedBody): void {
    this.tx(() => {
      const hasAtt = b.attachments.some((a) => !a.inline) ? 1 : 0
      this.run(
        `UPDATE messages SET body_text = ?, body_html = ?, snippet = ?, body_fetched = 1, has_attachments = ?,
         refs = CASE WHEN ? <> '' THEN ? ELSE refs END WHERE id = ?`,
        b.text,
        b.html,
        b.snippet,
        hasAtt,
        b.refs ?? '',
        b.refs ?? '',
        id
      )
      if (b.refs) {
        // giờ đã biết chuỗi References → xác định lại thư gốc của hội thoại và thừa hưởng trạng thái ghim
        const row = this.get('SELECT account_id, in_reply_to, message_id, pinned FROM messages WHERE id = ?', id)
        if (row) {
          const key = this.resolveThreadKey(row.account_id, b.refs, row.in_reply_to, row.message_id)
          this.run('UPDATE messages SET thread_key = ?, pinned = ? WHERE id = ?', key, this.isPinnedThread(row.account_id, key) ? 1 : 0, id)
        }
      }
      this.run('DELETE FROM attachments WHERE message_id = ?', id)
      for (const a of b.attachments) {
        this.run(
          'INSERT INTO attachments(message_id, idx, filename, content_type, size, content_id, inline) VALUES(?,?,?,?,?,?,?)',
          id,
          a.idx,
          a.filename,
          a.contentType,
          a.size,
          a.contentId,
          a.inline ? 1 : 0
        )
      }
      this.run('UPDATE messages_fts SET body = ? WHERE rowid = ?', vn(b.text.slice(0, 200000)), id)
    })
  }
  updateFlags(id: number, f: { seen?: boolean; flagged?: boolean; answered?: boolean; draft?: boolean }): void {
    const sets: string[] = []
    const vals: any[] = []
    for (const k of ['seen', 'flagged', 'answered', 'draft'] as const) {
      if (f[k] !== undefined) {
        sets.push(`${k} = ?`)
        vals.push(f[k] ? 1 : 0)
      }
    }
    if (sets.length) this.run(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`, ...vals, id)
  }
  setCategory(ids: number[], category: string | null): void {
    for (const id of ids) this.run('UPDATE messages SET category = ? WHERE id = ?', category, id)
  }
  deleteMessages(ids: number[]): void {
    this.tx(() => {
      for (const id of ids) {
        this.run('DELETE FROM messages_fts WHERE rowid = ?', id)
        this.run('DELETE FROM messages WHERE id = ?', id)
      }
    })
  }
  getMessageRow(id: number): Row | undefined {
    return this.get('SELECT * FROM messages WHERE id = ?', id)
  }
  getAttachments(messageId: number): Row[] {
    return this.all('SELECT * FROM attachments WHERE message_id = ? ORDER BY idx', messageId)
  }
  getAttachment(id: number): Row | undefined {
    return this.get('SELECT * FROM attachments WHERE id = ?', id)
  }
  messagesWithoutBody(folderId: number, maxSize: number, limit: number): { id: number; uid: number }[] {
    return this.all(
      'SELECT id, uid FROM messages WHERE folder_id = ? AND body_fetched = 0 AND size <= ? ORDER BY date DESC LIMIT ?',
      folderId,
      maxSize,
      limit
    ) as any
  }
  countWithoutBody(folderId: number, maxSize: number): number {
    return this.get(
      'SELECT COUNT(*) AS n FROM messages WHERE folder_id = ? AND body_fetched = 0 AND size <= ?',
      folderId,
      maxSize
    )!.n
  }

  /**
   * Tìm nhanh nhiều từ: ưu tiên thư chứa đúng cả cụm (các từ liền nhau). Chỉ khi không thư nào chứa nguyên cụm
   * mới nới ra thành "chứa đủ các từ ở bất kỳ đâu" — tránh kéo theo thư dài tình cờ có đủ các từ rải rác.
   */
  listMessages(q: ListQuery, mode: 'auto' | 'phrase' | 'words' = 'auto'): MessageSummary[] {
    if (mode === 'auto' && q.search && toFtsPhrase(q.search)) {
      const exact = this.listMessages(q, 'phrase')
      return exact.length || q.offset ? exact : this.listMessages(q, 'words')
    }
    const where: string[] = []
    const params: any[] = []
    let join = ''
    /** điều kiện vị trí: thư mục đang mở / phạm vi tìm / tài khoản — tách riêng để mở rộng theo hội thoại */
    const loc: string[] = []
    const locParams: any[] = []
    if (q.search && q.search.trim()) {
      const fts = mode === 'phrase' ? toFtsPhrase(q.search) : toFtsQuery(q.search)
      if (fts) {
        join = 'JOIN messages_fts ON messages_fts.rowid = m.id'
        where.push('messages_fts MATCH ?')
        params.push(fts)
      }
    }
    const a = q.adv
    if (a) {
      // mỗi ô: mọi cụm từ (cách nhau bằng dấu cách) đều phải xuất hiện, không phân biệt dấu/hoa thường
      const contains = (expr: string, value: string | undefined): void => {
        for (const term of fold(value ?? '').split(/\s+/).filter(Boolean)) {
          where.push(`instr(fold(${expr}), ?) > 0`)
          params.push(term)
        }
      }
      contains("m.from_name || ' ' || m.from_addr", a.from)
      contains('m.to_json', a.to)
      contains('m.cc_json', a.cc)
      contains('m.subject', a.subject)
      const not = toFtsQuery(a.without ?? '').split(' ').filter(Boolean)
      if (not.length) {
        where.push('m.id NOT IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)')
        params.push(not.join(' OR '))
      }
      if (a.dateFrom) {
        where.push('m.date >= ?')
        params.push(a.dateFrom)
      }
      if (a.dateTo) {
        where.push('m.date <= ?')
        params.push(a.dateTo)
      }
      if (a.read) where.push(a.read === 'unread' ? 'm.seen = 0' : 'm.seen = 1')
      if (a.hasAttachment) where.push('m.has_attachments = 1')
      if (a.flagged) where.push('m.flagged = 1')
      if (a.sizeMb && a.sizeMb > 0) {
        where.push(a.sizeOp === 'lt' ? 'm.size < ?' : 'm.size > ?')
        params.push(Math.round(a.sizeMb * 1024 * 1024))
      }
    }
    const scope = a?.scope && a.scope !== 'folder' ? a.scope : null
    const NO_JUNK = "m.folder_id NOT IN (SELECT id FROM folders WHERE special_use IN ('trash','junk'))"
    if (scope) {
      // phạm vi tìm kiếm thay cho thư mục đang mở, áp dụng trên mọi tài khoản
      if (scope === 'inbox' || scope === 'sent' || scope === 'drafts' || scope === 'junk' || scope === 'trash') {
        loc.push('m.folder_id IN (SELECT id FROM folders WHERE special_use = ?)')
        locParams.push(scope)
      } else if (scope !== 'everything') {
        loc.push(NO_JUNK)
        if (scope === 'flagged') loc.push('m.flagged = 1')
        if (scope === 'read') loc.push('m.seen = 1')
        if (scope === 'unread') loc.push('m.seen = 0')
      }
    } else if (q.folderId) {
      loc.push('m.folder_id = ?')
      locParams.push(q.folderId)
    } else if (q.virtual === 'all-inbox') {
      loc.push("m.folder_id IN (SELECT id FROM folders WHERE special_use = 'inbox')")
    } else if (q.virtual === 'flagged') {
      loc.push('m.flagged = 1')
    } else if (q.virtual === 'unread') {
      loc.push("m.seen = 0 AND m.folder_id IN (SELECT id FROM folders WHERE special_use IS NULL OR special_use NOT IN ('trash','junk','drafts','sent'))")
    }
    if (q.accountId) {
      loc.push('m.account_id = ?')
      locParams.push(q.accountId)
    }
    if (q.filter === 'unread') where.push('m.seen = 0')
    if (q.filter === 'flagged') where.push('m.flagged = 1')
    if (q.filter === 'attachments') where.push('m.has_attachments = 1')
    if (q.category) {
      where.push('m.category = ?')
      params.push(q.category)
    }
    const order = {
      'date-desc': 'm.date DESC',
      'date-asc': 'm.date ASC',
      from: 'm.from_name COLLATE NOCASE, m.from_addr COLLATE NOCASE, m.date DESC',
      subject: 'm.subject COLLATE NOCASE, m.date DESC',
      size: 'm.size DESC'
    }[q.sort ?? 'date-desc']
    const tail = `ORDER BY m.pinned DESC, ${order} LIMIT ? OFFSET ?`
    const lim = [q.limit ?? 200, q.offset ?? 0]
    const all = [...where, ...loc]
    const main = this.all(
      `SELECT ${SUMMARY_COLS}, m.message_id AS mid FROM messages m ${join} ${all.length ? 'WHERE ' + all.join(' AND ') : ''} ${tail}`,
      ...params,
      ...locParams,
      ...lim
    )
    // Xem theo hội thoại + đang lọc/tìm: thư khớp điều kiện nằm ở thư mục khác (vd. thư mình đã gửi, đã gắn cờ)
    // nhưng thuộc một hội thoại có mặt ở đây cũng được đưa vào, để hội thoại chỉ gồm đúng những thư khớp.
    if (!q.threads || !where.length || !loc.length || q.offset) return main.map(rowToSummary)
    const locM = loc.join(' AND ')
    const locX = locM.replace(/\bm\./g, 'x.')
    const extra = this.all(
      `SELECT ${SUMMARY_COLS}, m.message_id AS mid FROM messages m ${join}
       WHERE ${where.join(' AND ')} AND m.thread_key <> '' AND NOT (${locM})
         AND m.folder_id NOT IN (SELECT id FROM folders WHERE special_use IN ('trash','junk','drafts'))
         AND EXISTS (SELECT 1 FROM messages x WHERE x.account_id = m.account_id AND x.thread_key = m.thread_key AND ${locX})
       ${tail}`,
      ...params,
      ...locParams,
      ...locParams,
      ...lim
    )
    if (!extra.length) return main.map(rowToSummary)
    // một thư có ở hai thư mục (tự gửi cho mình) chỉ lấy một bản, ưu tiên bản ở thư mục đang mở
    const seen = new Set(main.filter((r) => r.mid).map((r) => `${r.account_id}|${r.mid}`))
    for (const r of extra) {
      const k = r.mid ? `${r.account_id}|${r.mid}` : ''
      if (k && seen.has(k)) continue
      if (k) seen.add(k)
      main.push(r)
    }
    const dir = q.sort === 'date-asc' ? 1 : -1
    main.sort((x, y) => y.pinned - x.pinned || dir * (x.date - y.date))
    return main.map(rowToSummary)
  }
  /**
   * Toàn bộ thư của một cuộc hội thoại ở mọi thư mục (kể cả thư mình đã gửi), mới nhất trước.
   * Một thư nằm ở hai thư mục (vd. tự gửi cho mình: Hộp thư đến + Thư đã gửi) chỉ lấy một bản, ưu tiên thư mục đang mở.
   */
  listThread(accountId: number, threadKey: string, preferFolderId?: number): MessageSummary[] {
    if (!threadKey) return []
    const rows = this.all(
      `SELECT ${SUMMARY_COLS}, m.message_id AS mid FROM messages m
       WHERE m.account_id = ? AND m.thread_key = ?
         AND m.folder_id NOT IN (SELECT id FROM folders WHERE special_use IN ('trash','junk','drafts'))
       ORDER BY m.date DESC, m.id DESC`,
      accountId,
      threadKey
    )
    const byMid = new Map<string, Row>()
    for (const r of rows) {
      const k = r.mid || `id:${r.id}`
      const cur = byMid.get(k)
      if (!cur || (preferFolderId && r.folder_id === preferFolderId && cur.folder_id !== preferFolderId)) byMid.set(k, r)
    }
    return [...byMid.values()].sort((a, b) => b.date - a.date).map(rowToSummary)
  }
  getSummary(id: number): MessageSummary | null {
    const r = this.get(`SELECT ${SUMMARY_COLS} FROM messages m WHERE m.id = ?`, id)
    return r ? rowToSummary(r) : null
  }
  unreadInboxCount(): number {
    return this.get(
      "SELECT COUNT(*) AS n FROM messages WHERE seen = 0 AND folder_id IN (SELECT id FROM folders WHERE special_use = 'inbox')"
    )!.n
  }

  // ---------- Hàng đợi thao tác (chạy được cả khi offline) ----------
  enqueueOp(accountId: number, type: PendingOp['type'], payload: any): void {
    this.run(
      'INSERT INTO pending_ops(account_id, type, payload, created_at) VALUES(?,?,?,?)',
      accountId,
      type,
      JSON.stringify(payload),
      Date.now()
    )
  }
  pendingOps(accountId: number): PendingOp[] {
    return this.all('SELECT * FROM pending_ops WHERE account_id = ? ORDER BY id', accountId).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      type: r.type,
      payload: JSON.parse(r.payload),
      attempts: r.attempts
    }))
  }
  removeOp(id: number): void {
    this.run('DELETE FROM pending_ops WHERE id = ?', id)
  }
  bumpOp(id: number): void {
    this.run('UPDATE pending_ops SET attempts = attempts + 1 WHERE id = ?', id)
  }

  // ---------- Danh bạ ----------
  listContacts(search?: string, limit = 500): Contact[] {
    const s = search?.trim()
    const rows = s
      ? this.all(
          `SELECT * FROM contacts WHERE name LIKE ? OR email LIKE ? OR company LIKE ?
           ORDER BY auto, freq DESC, name COLLATE NOCASE LIMIT ?`,
          `%${s}%`,
          `%${s}%`,
          `%${s}%`,
          limit
        )
      : this.all('SELECT * FROM contacts ORDER BY name COLLATE NOCASE, email LIMIT ?', limit)
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      company: r.company,
      phone: r.phone,
      notes: r.notes,
      auto: !!r.auto,
      freq: r.freq
    }))
  }
  saveContact(c: Partial<Contact> & { email: string }): void {
    if (c.id) {
      this.run(
        'UPDATE contacts SET name=?, email=?, company=?, phone=?, notes=?, auto=0 WHERE id=?',
        c.name ?? '',
        c.email,
        c.company ?? '',
        c.phone ?? '',
        c.notes ?? '',
        c.id
      )
    } else {
      this.run(
        `INSERT INTO contacts(name, email, company, phone, notes, auto) VALUES(?,?,?,?,?,0)
         ON CONFLICT(email) DO UPDATE SET name = excluded.name, company = excluded.company,
         phone = excluded.phone, notes = excluded.notes, auto = 0`,
        c.name ?? '',
        c.email,
        c.company ?? '',
        c.phone ?? '',
        c.notes ?? ''
      )
    }
  }
  touchContacts(addrs: Address[]): void {
    for (const a of addrs) {
      if (!a.address) continue
      this.run(
        `INSERT INTO contacts(name, email, auto, freq) VALUES(?, ?, 1, 1)
         ON CONFLICT(email) DO UPDATE SET freq = freq + 1,
         name = CASE WHEN contacts.name = '' THEN excluded.name ELSE contacts.name END`,
        a.name ?? '',
        a.address
      )
    }
  }
  deleteContact(id: number): void {
    this.run('DELETE FROM contacts WHERE id = ?', id)
  }

  // ---------- Lịch ----------
  private rowToEvent(r: Row): CalendarEvent {
    return {
      id: r.id,
      title: r.title,
      location: r.location,
      start: r.start,
      end: r.end,
      allDay: !!r.all_day,
      notes: r.notes,
      reminderMin: r.reminder_min ?? null,
      color: r.color
    }
  }
  listEvents(from: number, to: number): CalendarEvent[] {
    return this.all('SELECT * FROM events WHERE end >= ? AND start <= ? ORDER BY start', from, to).map((r) =>
      this.rowToEvent(r)
    )
  }
  saveEvent(e: Omit<CalendarEvent, 'id'> & { id?: number }): number {
    const vals = [e.title, e.location, e.start, e.end, e.allDay ? 1 : 0, e.notes, e.reminderMin, e.color]
    if (e.id) {
      this.run(
        'UPDATE events SET title=?, location=?, start=?, end=?, all_day=?, notes=?, reminder_min=?, color=?, notified=0 WHERE id=?',
        ...vals,
        e.id
      )
      return e.id
    }
    const r = this.run(
      'INSERT INTO events(title, location, start, end, all_day, notes, reminder_min, color) VALUES(?,?,?,?,?,?,?,?)',
      ...vals
    )
    return Number(r.lastInsertRowid)
  }
  deleteEvent(id: number): void {
    this.run('DELETE FROM events WHERE id = ?', id)
  }
  dueReminders(now: number): CalendarEvent[] {
    const rows = this.all(
      `SELECT * FROM events WHERE notified = 0 AND reminder_min IS NOT NULL
       AND start - reminder_min * 60000 <= ? AND end >= ?`,
      now,
      now
    )
    for (const r of rows) this.run('UPDATE events SET notified = 1 WHERE id = ?', r.id)
    return rows.map((r) => this.rowToEvent(r))
  }

  // ---------- Quy tắc ----------
  listRules(): Rule[] {
    return this.all('SELECT * FROM rules ORDER BY sort, id').map((r) => ({
      id: r.id,
      name: r.name,
      enabled: !!r.enabled,
      accountId: r.account_id ?? null,
      match: r.match,
      conditions: JSON.parse(r.conditions),
      actions: JSON.parse(r.actions),
      sort: r.sort
    }))
  }
  saveRule(r: Omit<Rule, 'id'> & { id?: number }): void {
    const vals = [r.name, r.enabled ? 1 : 0, r.accountId, r.match, JSON.stringify(r.conditions), JSON.stringify(r.actions), r.sort ?? 0]
    if (r.id) {
      this.run('UPDATE rules SET name=?, enabled=?, account_id=?, match=?, conditions=?, actions=?, sort=? WHERE id=?', ...vals, r.id)
    } else {
      this.run('INSERT INTO rules(name, enabled, account_id, match, conditions, actions, sort) VALUES(?,?,?,?,?,?,?)', ...vals)
    }
  }
  deleteRule(id: number): void {
    this.run('DELETE FROM rules WHERE id = ?', id)
  }
}
