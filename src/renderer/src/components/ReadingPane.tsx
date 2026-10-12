import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FilePen, Flag, Forward, ImageOff, Mails, Paperclip, Reply, ReplyAll, Trash2, WifiOff } from 'lucide-react'
import type { AppSettings, MessageDetail } from '../../../shared/types.ts'
import type { Actions } from '../App.tsx'
import { api } from '../api.ts'
import { addrList, colorFor, displayName, emailDocument, escapeHtml, fmtFull, fmtSize, hasRemoteContent, initials, sanitizeEmail } from '../util.ts'

export function ReadingPane(props: {
  detail: MessageDetail | null
  loading: boolean
  count: number
  settings: AppSettings
  actions: Actions
  onError: (m: string) => void
  onInfo: (m: string) => void
  onEditDraft: (id: number) => void
}) {
  const d = props.detail
  const [allowRemote, setAllowRemote] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => setAllowRemote(false), [d?.id])

  const clean = useMemo(() => {
    if (!d) return ''
    if (d.html) return sanitizeEmail(d.html)
    return `<pre>${escapeHtml(d.text)}</pre>`
  }, [d])
  const remote = useMemo(() => hasRemoteContent(clean), [clean])
  const blocked = remote && props.settings.blockRemoteImages && !allowRemote
  const doc = useMemo(() => emailDocument(clean, !blocked), [clean, blocked])

  // Liên kết trong thư mở bằng trình duyệt hệ thống
  const onLoad = (): void => {
    const cd = frame.current?.contentDocument
    if (!cd) return
    cd.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      e.preventDefault()
      const href = a.getAttribute('href') ?? ''
      if (/^(https?:|mailto:)/i.test(href)) void api.openExternal(href)
    })
  }

  if (props.count > 1) {
    return (
      <section className="reading placeholder">
        <Mails size={56} strokeWidth={1.2} />
        <p>Đã chọn {props.count} thư</p>
        <div className="row">
          <button className="btn" onClick={() => props.actions.setRead(true)}>Đánh dấu đã đọc</button>
          <button className="btn" onClick={props.actions.openMove}>Chuyển tới…</button>
          <button className="btn danger" onClick={props.actions.remove}>Xoá</button>
        </div>
      </section>
    )
  }
  if (!d) {
    return (
      <section className="reading placeholder">
        <Mails size={56} strokeWidth={1.2} />
        <p>{props.loading ? 'Đang mở thư…' : 'Chọn một thư để đọc'}</p>
      </section>
    )
  }

  const files = d.attachments.filter((a) => !a.inline)
  const wrap = (p: Promise<unknown>): void => void p.catch((e: Error) => props.onError(e.message))

  return (
    <section className="reading">
      <div className="read-head">
        <div className="read-subject">
          <h1>{d.subject || '(Không có tiêu đề)'}</h1>
          {d.category && (
            <span className="chip" style={{ background: props.settings.categories.find((c) => c.name === d.category)?.color }}>
              {d.category}
            </span>
          )}
        </div>
        <div className="read-meta">
          <div className="avatar" style={{ background: colorFor(d.from.address || d.from.name) }}>
            {initials(displayName(d.from))}
          </div>
          <div className="who">
            <div className="from">
              <b>{displayName(d.from)}</b>
              {d.from.name && <span className="muted"> &lt;{d.from.address}&gt;</span>}
            </div>
            <div className="muted line" title={addrList(d.to)}>
              Tới: {d.to.length ? d.to.map(displayName).join('; ') : '—'}
            </div>
            {d.cc.length > 0 && (
              <div className="muted line" title={addrList(d.cc)}>
                Cc: {d.cc.map(displayName).join('; ')}
              </div>
            )}
          </div>
          <div className="read-side">
            <div className="read-actions">
              {d.draft ? (
                <button className="btn" onClick={() => props.onEditDraft(d.id)}>
                  <FilePen size={15} /> Sửa thư nháp
                </button>
              ) : (
                <>
                  <button className="icon-btn" title="Trả lời (Ctrl+R)" onClick={() => props.actions.reply('reply')}><Reply size={17} /></button>
                  <button className="icon-btn" title="Trả lời tất cả (Ctrl+Shift+R)" onClick={() => props.actions.reply('replyAll')}><ReplyAll size={17} /></button>
                  <button className="icon-btn" title="Chuyển tiếp (Ctrl+F)" onClick={() => props.actions.reply('forward')}><Forward size={17} /></button>
                </>
              )}
              <button className={`icon-btn ${d.flagged ? 'flag-on' : ''}`} title="Gắn cờ" onClick={props.actions.toggleFlag}>
                <Flag size={17} fill={d.flagged ? 'currentColor' : 'none'} />
              </button>
              <button className="icon-btn" title="Xoá (Delete)" onClick={props.actions.remove}><Trash2 size={17} /></button>
            </div>
            <div className="muted date">{fmtFull(d.date)}</div>
          </div>
        </div>
        {files.length > 0 && (
          <div className="attachments">
            {files.map((a) => (
              <div key={a.id} className="att" title={`${a.filename} — bấm để mở`}>
                <button className="att-open" onClick={() => wrap(api.openAttachment(a.id))}>
                  <Paperclip size={15} />
                  <span className="att-name">{a.filename}</span>
                  <span className="muted">{fmtSize(a.size)}</span>
                </button>
                <button
                  className="icon-btn"
                  title="Lưu về máy…"
                  onClick={() => wrap(api.saveAttachmentAs(a.id).then((p) => p && props.onInfo('Đã lưu tệp đính kèm.')))}
                >
                  <Download size={15} />
                </button>
              </div>
            ))}
            {files.length > 1 && (
              <button className="link" onClick={() => wrap(api.saveAllAttachments(d.id).then((n) => n && props.onInfo(`Đã lưu ${n} tệp.`)))}>
                Lưu tất cả
              </button>
            )}
          </div>
        )}
        {blocked && (
          <div className="banner">
            <ImageOff size={15} />
            <span>Đã chặn hình ảnh từ bên ngoài để bảo vệ quyền riêng tư.</span>
            <button className="link" onClick={() => setAllowRemote(true)}>Tải hình ảnh</button>
          </div>
        )}
        {!d.bodyAvailable && (
          <div className="banner warn">
            <WifiOff size={15} />
            <span>Nội dung thư này chưa được tải về máy. Hãy kết nối mạng rồi mở lại.</span>
          </div>
        )}
      </div>
      <iframe ref={frame} className="read-body" title="Nội dung thư" sandbox="allow-same-origin allow-popups" srcDoc={doc} onLoad={onLoad} />
    </section>
  )
}
