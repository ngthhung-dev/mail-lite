export type Provider = 'imap' | 'gmail' | 'microsoft'
export type AuthType = 'password' | 'oauth'
export type SpecialUse = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | null

export interface Account {
  id: number
  name: string
  email: string
  displayName: string
  provider: Provider
  authType: AuthType
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  signatureHtml: string
  color: string
  syncDays: number // 0 = tất cả
  lastSync: number | null
  lastError: string | null
}

export interface AccountInput {
  id?: number
  name: string
  email: string
  displayName: string
  provider: Provider
  authType: AuthType
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  password?: string
  signatureHtml?: string
  color?: string
  syncDays?: number
}

export interface Folder {
  id: number
  accountId: number
  path: string
  name: string
  delimiter: string
  specialUse: SpecialUse
  /** false = thư mục chỉ để chứa thư mục con, hoặc thư mục ảo không đồng bộ (Gmail "Tất cả thư") */
  selectable: boolean
  /** thứ tự người dùng kéo thả trong cùng cấp; null = thứ tự mặc định */
  sortOrder?: number | null
  total: number
  unread: number
}

export interface Address {
  name: string
  address: string
}

export interface MessageSummary {
  id: number
  accountId: number
  folderId: number
  uid: number
  subject: string
  from: Address
  to: Address[]
  date: number
  size: number
  seen: boolean
  flagged: boolean
  answered: boolean
  draft: boolean
  hasAttachments: boolean
  snippet: string
  category: string | null
  /** thuộc một cuộc hội thoại đã ghim (hiện trên đầu danh sách) */
  pinned: boolean
  /** khoá cuộc hội thoại (thư gốc của chuỗi trả lời); rỗng nếu thư không có Message-ID */
  threadKey: string
  /** số thư trong cuộc hội thoại ở mọi thư mục của tài khoản (trừ Thư rác, Thùng rác, Thư nháp) */
  threadCount: number
}

export interface AttachmentInfo {
  id: number
  filename: string
  contentType: string
  size: number
  inline: boolean
}

export interface MessageDetail extends MessageSummary {
  messageId: string
  inReplyTo: string
  references: string
  cc: Address[]
  bcc: Address[]
  replyTo: Address[]
  html: string // đã thay cid: bằng data:
  text: string
  attachments: AttachmentInfo[]
  bodyAvailable: boolean
}

/**
 * folder = thư mục đang mở · all = tất cả thư (trừ Thư rác, Thùng rác) · everything = kể cả Thư rác và Thùng rác ·
 * inbox/sent/drafts/junk/trash = loại thư mục đó ở mọi tài khoản · flagged/read/unread = theo trạng thái (trừ Thư rác, Thùng rác)
 */
export type SearchScope = 'folder' | 'all' | 'everything' | 'inbox' | 'sent' | 'drafts' | 'junk' | 'trash' | 'flagged' | 'read' | 'unread'

export const SCOPE_LABEL: Record<SearchScope, string> = {
  folder: 'Thư mục hiện tại',
  all: 'Tất cả thư',
  inbox: 'Hộp thư đến',
  flagged: 'Thư đã gắn cờ',
  sent: 'Thư đã gửi',
  drafts: 'Thư nháp',
  junk: 'Thư rác',
  trash: 'Thùng rác',
  everything: 'Thư & Thư rác & Thùng rác',
  read: 'Thư đã đọc',
  unread: 'Thư chưa đọc'
}

/** Bộ lọc tìm kiếm nâng cao (các ô để trống thì không lọc theo ô đó). */
export interface AdvancedSearch {
  /** phạm vi tìm; bỏ trống = thư mục đang mở. Các phạm vi khác áp dụng cho mọi tài khoản. */
  scope?: SearchScope
  from?: string
  to?: string
  cc?: string
  subject?: string
  /** loại các thư có chứa những từ này */
  without?: string
  /** mốc thời gian (ms) đầu ngày bắt đầu / cuối ngày kết thúc */
  dateFrom?: number
  dateTo?: number
  read?: 'unread' | 'read'
  hasAttachment?: boolean
  flagged?: boolean
  sizeOp?: 'gt' | 'lt'
  sizeMb?: number
}

/** Số điều kiện đang bật (không tính phạm vi). */
export function advCount(a: AdvancedSearch | undefined): number {
  if (!a) return 0
  return (
    [a.from, a.to, a.cc, a.subject, a.without].filter((x) => x && x.trim()).length +
    (a.dateFrom || a.dateTo ? 1 : 0) +
    (a.read ? 1 : 0) +
    (a.hasAttachment ? 1 : 0) +
    (a.flagged ? 1 : 0) +
    (a.sizeMb && a.sizeMb > 0 ? 1 : 0)
  )
}

/** Đang có điều kiện tìm nâng cao nào không (tính cả việc chọn phạm vi khác thư mục hiện tại). */
export function advActive(a: AdvancedSearch | undefined): boolean {
  return advCount(a) > 0 || (!!a?.scope && a.scope !== 'folder')
}

export interface ListQuery {
  /** id thư mục, hoặc thư mục ảo */
  folderId?: number
  virtual?: 'all-inbox' | 'flagged' | 'unread'
  search?: string
  adv?: AdvancedSearch
  accountId?: number
  filter?: 'all' | 'unread' | 'flagged' | 'attachments'
  /** đang xem theo hội thoại: khi lọc/tìm, lấy cả thư khớp ở thư mục khác thuộc hội thoại có mặt ở đây */
  threads?: boolean
  category?: string
  sort?: 'date-desc' | 'date-asc' | 'from' | 'subject' | 'size'
  offset?: number
  limit?: number
}

export interface OutgoingAttachment {
  path?: string
  filename: string
  size: number
  /** đính kèm lấy từ thư gốc khi chuyển tiếp */
  fromAttachmentId?: number
}

export interface Draft {
  accountId: number
  to: string
  cc: string
  bcc: string
  subject: string
  html: string
  attachments: OutgoingAttachment[]
  inReplyTo?: string
  references?: string
  /** thư gốc để đánh dấu đã trả lời */
  sourceMessageId?: number
  mode?: 'new' | 'reply' | 'replyAll' | 'forward' | 'draft'
  /** id thư nháp đang sửa (để xoá sau khi gửi) */
  draftMessageId?: number
  importance?: 'high' | 'normal' | 'low'
  requestReadReceipt?: boolean
}

export interface Contact {
  id: number
  name: string
  email: string
  company: string
  phone: string
  notes: string
  auto: boolean
  freq: number
}

export interface CalendarEvent {
  id: number
  title: string
  location: string
  start: number
  end: number
  allDay: boolean
  notes: string
  reminderMin: number | null
  color: string
}

export type RuleField = 'from' | 'to' | 'subject' | 'body' | 'hasAttachment'
export interface RuleCondition {
  field: RuleField
  op: 'contains' | 'notContains' | 'equals' | 'is'
  value: string
}
export type RuleAction =
  | { type: 'move'; folderPath: string }
  | { type: 'markRead' }
  | { type: 'flag' }
  | { type: 'category'; value: string }
  | { type: 'delete' }
  /** tự chuyển tiếp thư mới tới địa chỉ khác (kèm tệp đính kèm) */
  | { type: 'forward'; to: string }

export interface Rule {
  id: number
  name: string
  enabled: boolean
  accountId: number | null
  match: 'all' | 'any'
  conditions: RuleCondition[]
  actions: RuleAction[]
  sort: number
}

export interface AppSettings {
  syncIntervalMin: number
  notifications: boolean
  blockRemoteImages: boolean
  readingPane: 'right' | 'bottom' | 'off'
  markReadOnOpen: boolean
  density: 'compact' | 'normal'
  theme: 'light' | 'dark' | 'system'
  googleClientId: string
  googleClientSecret: string
  microsoftClientId: string
  categories: { name: string; color: string }[]
  /** giữ thư lại N giây trước khi gửi thật để còn kịp bấm Hoàn tác (0 = gửi ngay) */
  undoSendSec: number
  /** gom các thư cùng chuỗi trả lời thành một cuộc hội thoại trong danh sách */
  conversationView: boolean
  /** độ rộng các ngăn do người dùng kéo */
  sideWidth: number
  listWidth: number
  /** chiều cao danh sách khi ngăn đọc nằm dưới (% chiều cao vùng thư) */
  listHeightPct: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  syncIntervalMin: 5,
  notifications: true,
  blockRemoteImages: true,
  readingPane: 'right',
  markReadOnOpen: true,
  density: 'compact',
  theme: 'system',
  googleClientId: '',
  googleClientSecret: '',
  microsoftClientId: '',
  undoSendSec: 10,
  conversationView: true,
  sideWidth: 252,
  listWidth: 390,
  listHeightPct: 44,
  categories: [
    { name: 'Đỏ', color: '#d13438' },
    { name: 'Cam', color: '#ca5010' },
    { name: 'Vàng', color: '#c19c00' },
    { name: 'Xanh lá', color: '#107c10' },
    { name: 'Xanh dương', color: '#0f6cbd' },
    { name: 'Tím', color: '#8764b8' }
  ]
}

export interface SyncStatus {
  accountId: number
  state: 'idle' | 'connecting' | 'syncing' | 'error' | 'offline'
  message: string
  progress?: { done: number; total: number }
}

export interface ServerPreset {
  provider: Provider
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  oauth: boolean
  note?: string
}

export type AppEvent =
  | { type: 'sync-status'; status: SyncStatus }
  | { type: 'mail-changed'; accountId: number; folderIds: number[] }
  | { type: 'folders-changed'; accountId: number }
  | { type: 'accounts-changed' }
  | { type: 'new-mail'; accountId: number; count: number; subject: string; from: string }
  | { type: 'reminder'; event: CalendarEvent }
  | { type: 'menu'; action: string }
  | { type: 'send-result'; id: number; ok: boolean; error?: string; draft?: Draft; subject: string }
  | { type: 'merge-progress'; running: boolean; total: number; done: number; remaining: number; last?: MergeResult; stopped?: string }

// ---------- Trộn thư ----------
export interface MergeData {
  file: string
  /** thư mục chứa tệp dữ liệu — đường dẫn tệp đính kèm tương đối tính từ đây */
  baseDir: string
  sheets: string[]
  sheet: string
  columns: string[]
  rows: string[][]
  /** số dòng trong tệp gốc ứng với từng phần tử của rows (để báo cáo) */
  rowNumbers: number[]
  truncated: boolean
}

export interface MergeJob {
  accountId: number
  subject: string
  html: string
  columns: string[]
  rows: string[][]
  rowNumbers: number[]
  toColumn: string
  ccColumn?: string
  bccColumn?: string
  /** cột chứa đường dẫn tệp đính kèm riêng cho từng người (nhiều tệp cách nhau bằng ;) */
  attachColumn?: string
  baseDir?: string
  /** tệp đính kèm chung cho mọi thư */
  attachments: OutgoingAttachment[]
  /** nghỉ giữa hai thư (ms) */
  delayMs: number
  importance?: 'high' | 'normal' | 'low'
}

export interface MergeIssue {
  row: number
  level: 'error' | 'skip'
  message: string
}
export interface MergeCheck {
  sendable: number
  issues: MergeIssue[]
  /** trường {{...}} trong mẫu không khớp cột nào */
  unknownFields: string[]
}
export interface MergeResult {
  row: number
  to: string
  status: 'sent' | 'failed' | 'skipped'
  error?: string
  at: number
  /** app thoát đúng lúc đang gửi thư này — không rõ đã gửi hay chưa, nên không tự gửi lại */
  uncertain?: boolean
}
export interface MergeProgress {
  running: boolean
  accountId: number
  total: number
  results: MergeResult[]
  /** lý do dừng sớm (người dùng bấm dừng, lỗi liên tiếp, thoát ứng dụng…) */
  stopped?: string
  /** số dòng còn có thể gửi tiếp: chưa tới lượt + gửi lỗi (không tính dòng "không rõ") */
  remaining: number
  subject: string
}

/** Tên và dòng mô tả hiển thị của ứng dụng. */
export const APP_NAME = 'Mail Lite'
export const APP_TAGLINE = 'Mail Lite by ngthhung'
