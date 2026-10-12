import { useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, Maximize2, Minimize2, Paperclip, Save, Send, X } from 'lucide-react'
import type { Account, Contact, Draft } from '../../../shared/types.ts'
import { api } from '../api.ts'
import { fmtSize } from '../util.ts'
import { RichEditor } from './RichEditor.tsx'
import type { RichEditorHandle } from './RichEditor.tsx'

function RecipientInput(props: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const [sugg, setSugg] = useState<Contact[]>([])
  const [idx, setIdx] = useState(0)
  const seq = useRef(0)
  const lastToken = (v: string): string => v.split(/[;,]/).pop()!.trim()

  const change = (v: string): void => {
    props.onChange(v)
    const t = lastToken(v)
    const my = ++seq.current
    if (t.length < 2) return setSugg([])
    void api.listContacts(t, 6).then((c) => {
      if (my === seq.current) {
        setSugg(c)
        setIdx(0)
      }
    })
  }
  const pick = (c: Contact): void => {
    const parts = props.value.split(/[;,]/)
    parts.pop()
    const head = parts.map((p) => p.trim()).filter(Boolean)
    head.push(c.name ? `${c.name} <${c.email}>` : c.email)
    props.onChange(head.join('; ') + '; ')
    setSugg([])
  }
  return (
    <div className="crow">
      <label>{props.label}</label>
      <div className="rcpt">
        <input
          autoFocus={props.autoFocus}
          value={props.value}
          spellCheck={false}
          onChange={(e) => change(e.target.value)}
          onBlur={() => setTimeout(() => setSugg([]), 150)}
          onKeyDown={(e) => {
            if (!sugg.length) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdx((i) => (i + 1) % sugg.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx((i) => (i - 1 + sugg.length) % sugg.length)
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              pick(sugg[idx])
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setSugg([])
            }
          }}
        />
        {sugg.length > 0 && (
          <div className="sugg">
            {sugg.map((c, i) => (
              <div key={c.id} className={i === idx ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), pick(c))}>
                <b>{c.name || c.email}</b> {c.name && <span className="muted">{c.email}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function Compose(props: {
  initial: Draft
  accounts: Account[]
  onClose: () => void
  onSent: () => void
  /** số giây giữ thư lại để hoàn tác (0 = gửi ngay) */
  undoSec: number
  onQueued: (id: number, subject: string, sec: number) => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  const [d, setD] = useState<Draft>(props.initial)
  const [showCc, setShowCc] = useState(!!(props.initial.cc || props.initial.bcc))
  const [busy, setBusy] = useState<'send' | 'save' | null>(null)
  const [max, setMax] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const rich = useRef<RichEditorHandle>(null)
  const set = (patch: Partial<Draft>): void => {
    setD((x) => ({ ...x, ...patch }))
    setDirty(true)
  }

  const current = (): Draft => ({ ...d, html: rich.current?.getHtml() ?? d.html })

  const send = async (): Promise<void> => {
    const draft = current()
    if (!draft.to.trim() && !draft.cc.trim() && !draft.bcc.trim()) return props.onError('Chưa nhập người nhận.')
    if (!draft.subject.trim() && !window.confirm('Thư chưa có tiêu đề. Vẫn gửi?')) return
    setBusy('send')
    try {
      if (props.undoSec > 0) props.onQueued(await api.sendLater(draft, props.undoSec), draft.subject, props.undoSec)
      else {
        await api.send(draft)
        props.onSent()
      }
    } catch (e) {
      props.onError((e as Error).message)
      setBusy(null)
    }
  }
  const save = async (): Promise<void> => {
    setBusy('save')
    try {
      await api.saveDraft(current())
      props.onSaved()
    } catch (e) {
      props.onError((e as Error).message)
      setBusy(null)
    }
  }
  const tryClose = (): void => {
    if (dirty) setConfirmClose(true)
    else props.onClose()
  }
  const attach = async (): Promise<void> => {
    const files = await api.pickAttachments()
    if (files.length) set({ attachments: [...d.attachments, ...files] })
  }

  const onKey = (e: React.KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key === 'Enter') {
      e.preventDefault()
      void send()
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      tryClose()
    }
  }
  const title = { new: 'Thư mới', reply: 'Trả lời', replyAll: 'Trả lời tất cả', forward: 'Chuyển tiếp', draft: 'Thư nháp' }[d.mode ?? 'new']
  const total = d.attachments.reduce((n, a) => n + a.size, 0)

  return (
    <div className="overlay">
      <div className={`compose ${max ? 'max' : ''}`} onKeyDown={onKey} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span>
            {d.subject || title} <span className="muted">— {title}</span>
          </span>
          <span>
            <button className="icon-btn" onClick={() => setMax(!max)} title={max ? 'Thu nhỏ' : 'Phóng to'}>
              {max ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button className="icon-btn" onClick={tryClose} title="Đóng (Esc)">
              <X size={16} />
            </button>
          </span>
        </div>
        <div className="compose-top">
          <button className="send" onClick={() => void send()} disabled={!!busy} title="Gửi (Ctrl+Enter)">
            <Send size={22} />
            <span>{busy === 'send' ? 'Đang gửi…' : 'Gửi'}</span>
          </button>
          <div className="compose-fields">
            <div className="crow">
              <label>Từ</label>
              <select value={d.accountId} onChange={(e) => set({ accountId: Number(e.target.value) })}>
                {props.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName ? `${a.displayName} <${a.email}>` : a.email}
                  </option>
                ))}
              </select>
              {!showCc && (
                <button className="link" onClick={() => setShowCc(true)}>
                  Cc / Bcc
                </button>
              )}
            </div>
            <RecipientInput label="Tới" value={d.to} onChange={(v) => set({ to: v })} autoFocus={!props.initial.to} />
            {showCc && <RecipientInput label="Cc" value={d.cc} onChange={(v) => set({ cc: v })} />}
            {showCc && <RecipientInput label="Bcc" value={d.bcc} onChange={(v) => set({ bcc: v })} />}
            <div className="crow">
              <label>Chủ đề</label>
              <input value={d.subject} onChange={(e) => set({ subject: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="toolbar actions">
          <button title="Đính kèm tệp" className="wide" onClick={() => void attach()}><Paperclip size={16} /> Đính kèm</button>
          <button
            title="Mức quan trọng cao"
            className={d.importance === 'high' ? 'on danger' : ''}
            onClick={() => set({ importance: d.importance === 'high' ? 'normal' : 'high' })}
          >
            <AlertTriangle size={16} />
          </button>
          <button title="Mức quan trọng thấp" className={d.importance === 'low' ? 'on' : ''} onClick={() => set({ importance: d.importance === 'low' ? 'normal' : 'low' })}>
            <ArrowDown size={16} />
          </button>
          <label className="check" title="Yêu cầu người nhận xác nhận đã đọc">
            <input type="checkbox" checked={!!d.requestReadReceipt} onChange={(e) => set({ requestReadReceipt: e.target.checked })} /> Báo đã đọc
          </label>
          <span className="grow" />
          <button title="Lưu nháp (Ctrl+S)" className="wide" onClick={() => void save()} disabled={!!busy}>
            <Save size={16} /> {busy === 'save' ? 'Đang lưu…' : 'Lưu nháp'}
          </button>
        </div>
        {d.attachments.length > 0 && (
          <div className="attachments compose-att">
            {d.attachments.map((a, i) => (
              <div key={i} className="att">
                <span className="att-open">
                  <Paperclip size={15} />
                  <span className="att-name">{a.filename}</span>
                  <span className="muted">{fmtSize(a.size)}</span>
                </span>
                <button className="icon-btn" title="Bỏ tệp" onClick={() => set({ attachments: d.attachments.filter((_, j) => j !== i) })}>
                  <X size={14} />
                </button>
              </div>
            ))}
            {total > 20 * 1024 * 1024 && <span className="warn-text">Tổng {fmtSize(total)} — nhiều máy chủ từ chối thư trên 20–25 MB.</span>}
          </div>
        )}
        <RichEditor
          ref={rich}
          className="fill"
          initialHtml={props.initial.html}
          focusAtStart={!!props.initial.to}
          onChange={() => setDirty(true)}
          onError={props.onError}
          ariaLabel="Nội dung thư"
        />
        {confirmClose && (
          <div className="compose-confirm">
            <span>Lưu thư này vào Thư nháp trước khi đóng?</span>
            <button className="btn primary" onClick={() => void save()} disabled={!!busy}>Lưu nháp</button>
            <button className="btn danger" onClick={props.onClose}>Bỏ thư</button>
            <button className="btn" onClick={() => setConfirmClose(false)}>Tiếp tục soạn</button>
          </div>
        )}
      </div>
    </div>
  )
}
