import DOMPurify from 'dompurify'
import type { Account, Address, Draft, Folder, MessageDetail } from '../../shared/types.ts'

const pad = (n: number): string => String(n).padStart(2, '0')
const DAYS = ['CN', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7']
const DAYS_FULL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']

export function startOfDay(d: Date | number): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}
const DAY = 86400_000

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function fmtDate(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
export function fmtListDate(ts: number): string {
  const today = startOfDay(Date.now())
  if (ts >= today && ts < today + DAY) return fmtTime(ts)
  if (ts >= today - 6 * DAY && ts < today) return `${DAYS[new Date(ts).getDay()]} ${fmtTime(ts)}`
  return fmtDate(ts)
}
export function fmtFull(ts: number): string {
  const d = new Date(ts)
  return `${DAYS_FULL[d.getDay()]}, ${fmtDate(ts)} ${fmtTime(ts)}`
}
export function groupLabel(ts: number): string {
  const today = startOfDay(Date.now())
  if (ts >= today + DAY) return 'Sắp tới'
  if (ts >= today) return 'Hôm nay'
  if (ts >= today - DAY) return 'Hôm qua'
  const dow = (new Date(today).getDay() + 6) % 7 // thứ hai = 0
  const weekStart = today - dow * DAY
  if (ts >= weekStart) return 'Tuần này'
  if (ts >= weekStart - 7 * DAY) return 'Tuần trước'
  const now = new Date()
  const d = new Date(ts)
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'Tháng này'
  if (d.getFullYear() === now.getFullYear()) return `Tháng ${d.getMonth() + 1}`
  return `Năm ${d.getFullYear()}`
}
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function initials(name: string): string {
  const parts = name.replace(/[<>"']/g, '').trim().split(/[\s.@_-]+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
const AVATAR = ['#0f6cbd', '#107c10', '#8764b8', '#ca5010', '#038387', '#c239b3', '#986f0b', '#4f6bed', '#d13438', '#567c8d']
export function colorFor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return AVATAR[Math.abs(h) % AVATAR.length]
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
export function addrText(a: Address): string {
  return a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address
}
export function addrList(list: Address[]): string {
  return list.map(addrText).join('; ')
}
export function displayName(a: Address): string {
  return a.name || a.address || '(Không rõ)'
}

// ---------- Thư mục ----------
const SPECIAL_LABEL: Record<string, string> = {
  inbox: 'Hộp thư đến',
  sent: 'Thư đã gửi',
  drafts: 'Thư nháp',
  trash: 'Thùng rác',
  junk: 'Thư rác',
  archive: 'Lưu trữ'
}
const SPECIAL_ORDER: Record<string, number> = { inbox: 0, drafts: 1, sent: 2, archive: 3, junk: 4, trash: 5 }

export function folderLabel(f: Folder): string {
  return (f.specialUse && SPECIAL_LABEL[f.specialUse]) || f.name
}

export interface FolderNode {
  folder: Folder
  children: FolderNode[]
  depth: number
}
export function buildTree(folders: Folder[]): FolderNode[] {
  const byPath = new Map<string, FolderNode>()
  for (const f of folders) byPath.set(f.path, { folder: f, children: [], depth: 0 })
  const roots: FolderNode[] = []
  for (const f of folders) {
    const node = byPath.get(f.path)!
    const i = f.path.lastIndexOf(f.delimiter)
    const parent = i > 0 ? byPath.get(f.path.slice(0, i)) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (list: FolderNode[], depth: number): void => {
    list.sort((a, b) => {
      // thứ tự người dùng đã kéo thả đứng trước; thư mục mới (chưa có thứ tự) xếp sau theo quy tắc mặc định
      const ua = a.folder.sortOrder ?? Infinity
      const ub = b.folder.sortOrder ?? Infinity
      if (ua !== ub) return ua < ub ? -1 : 1
      const oa = SPECIAL_ORDER[a.folder.specialUse ?? ''] ?? 9
      const ob = SPECIAL_ORDER[b.folder.specialUse ?? ''] ?? 9
      return oa - ob || folderLabel(a.folder).localeCompare(folderLabel(b.folder), 'vi')
    })
    for (const n of list) {
      n.depth = depth
      sort(n.children, depth + 1)
    }
  }
  // ẩn thư mục không chọn được và không có con (vd. "Tất cả thư" của Gmail)
  const prune = (list: FolderNode[]): FolderNode[] =>
    list.filter((n) => {
      n.children = prune(n.children)
      return n.folder.selectable || n.children.length > 0
    })
  // Gmail đặt thư mục hệ thống trong ngăn chứa "[Gmail]" — đưa các thư mục con ra ngoài cho gọn như Outlook
  const lifted = prune(roots).flatMap((n) => (!n.folder.selectable && /^\[.+\]$/.test(n.folder.name) ? n.children : [n]))
  const kept = lifted
  sort(kept, 0)
  return kept
}
export function flattenTree(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)])
}

// ---------- Hiển thị thư an toàn ----------
export function sanitizeEmail(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed', 'script', 'link', 'meta', 'base', 'svg', 'math'],
    FORBID_ATTR: ['srcset', 'ping'],
    ADD_ATTR: ['target']
  })
}
export function hasRemoteContent(html: string): boolean {
  return /<img[^>]+src\s*=\s*["']?\s*https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html) || /background\s*=\s*["']?https?:/i.test(html)
}
export function emailDocument(cleanHtml: string, allowRemote: boolean): string {
  const img = allowRemote ? 'data: https: http:' : 'data:'
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:">
<base target="_blank">
<style>
html{background:#fff}
body{font:14px/1.5 "Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;color:#201f1e;margin:16px 20px;word-wrap:break-word;overflow-wrap:anywhere}
img{max-width:100%;height:auto}
a{color:#0f6cbd}
blockquote{margin:8px 0 8px 4px;padding-left:12px;border-left:3px solid #c8c6c4;color:#484644}
pre{white-space:pre-wrap;font-family:Consolas,Menlo,monospace}
table{max-width:100%}
p{margin:0 0 8px}
</style></head><body>${cleanHtml}</body></html>`
}

// ---------- Soạn thư ----------
export function emptyDraft(account: Account | undefined, patch: Partial<Draft> = {}): Draft {
  const sig = account?.signatureHtml ? `<p><br></p><div class="mn-signature">${account.signatureHtml}</div>` : ''
  return {
    accountId: account?.id ?? 0,
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    html: `<p><br></p>${sig}`,
    attachments: [],
    mode: 'new',
    importance: 'normal',
    ...patch
  }
}

function prefix(subject: string, p: 'RE' | 'FW'): string {
  const re = p === 'RE' ? /^\s*(re|trả lời)\s*:/i : /^\s*(fw|fwd|chuyển tiếp)\s*:/i
  return re.test(subject) ? subject : `${p}: ${subject}`
}

export function buildReply(m: MessageDetail, account: Account, mode: 'reply' | 'replyAll' | 'forward'): Draft {
  const me = account.email.toLowerCase()
  const sig = account.signatureHtml ? `<div class="mn-signature">${account.signatureHtml}</div><p><br></p>` : ''
  const original = m.html ? sanitizeEmail(m.html) : `<pre>${escapeHtml(m.text)}</pre>`
  const header =
    `<hr style="border:none;border-top:1px solid #e1dfdd">` +
    `<p style="font-size:13px"><b>Từ:</b> ${escapeHtml(addrText(m.from))}<br>` +
    `<b>Đã gửi:</b> ${escapeHtml(fmtFull(m.date))}<br>` +
    `<b>Tới:</b> ${escapeHtml(addrList(m.to))}<br>` +
    (m.cc.length ? `<b>Cc:</b> ${escapeHtml(addrList(m.cc))}<br>` : '') +
    `<b>Chủ đề:</b> ${escapeHtml(m.subject)}</p>`
  const html = `<p><br></p>${sig}<div class="mn-quote">${header}${original}</div>`
  const refs = [m.references, m.messageId].filter(Boolean).join(' ').trim()

  if (mode === 'forward') {
    return {
      accountId: account.id,
      to: '',
      cc: '',
      bcc: '',
      subject: prefix(m.subject, 'FW'),
      html,
      attachments: m.attachments
        .filter((a) => !a.inline)
        .map((a) => ({ filename: a.filename, size: a.size, fromAttachmentId: a.id })),
      sourceMessageId: m.id,
      mode,
      importance: 'normal'
    }
  }
  const replyTarget = m.replyTo.length ? m.replyTo : [m.from]
  // trả lời thư do chính mình gửi → gửi lại cho người nhận cũ
  const sentByMe = m.from.address.toLowerCase() === me
  const to = sentByMe ? m.to : replyTarget
  let cc: Address[] = []
  if (mode === 'replyAll') {
    const used = new Set([me, ...to.map((a) => a.address.toLowerCase())])
    cc = [...(sentByMe ? [] : m.to), ...m.cc].filter((a) => {
      const k = a.address.toLowerCase()
      if (used.has(k)) return false
      used.add(k)
      return true
    })
  }
  return {
    accountId: account.id,
    to: addrList(to),
    cc: addrList(cc),
    bcc: '',
    subject: prefix(m.subject, 'RE'),
    html,
    attachments: [],
    inReplyTo: m.messageId,
    references: refs,
    sourceMessageId: m.id,
    mode,
    importance: 'normal'
  }
}

export function draftFromMessage(m: MessageDetail): Draft {
  return {
    accountId: m.accountId,
    to: addrList(m.to),
    cc: addrList(m.cc),
    bcc: addrList(m.bcc),
    subject: m.subject,
    html: m.html ? sanitizeEmail(m.html) : `<p>${escapeHtml(m.text).replace(/\n/g, '<br>')}</p>`,
    attachments: m.attachments.filter((a) => !a.inline).map((a) => ({ filename: a.filename, size: a.size, fromAttachmentId: a.id })),
    inReplyTo: m.inReplyTo || undefined,
    references: m.references || undefined,
    mode: 'draft',
    draftMessageId: m.id,
    importance: 'normal'
  }
}
