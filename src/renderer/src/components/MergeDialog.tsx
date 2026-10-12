import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, CircleSlash, FileSpreadsheet, Paperclip, Send, Square, X, XCircle
} from 'lucide-react'
import type { Account, MergeCheck, MergeData, MergeJob, MergeProgress, OutgoingAttachment } from '../../../shared/types.ts'
import { fieldKey, guessEmailColumn, isEmail, renderTemplate, rowRecord } from '../../../shared/merge.ts'
import { api, onEvent } from '../api.ts'
import { emailDocument, fmtSize, fmtTime, sanitizeEmail } from '../util.ts'
import { ConfirmDialog, Field, Modal } from './ui.tsx'
import { RichEditor } from './RichEditor.tsx'
import type { RichEditorHandle } from './RichEditor.tsx'

const STEPS = ['1. Danh sách', '2. Soạn mẫu', '3. Xem trước', '4. Gửi']
const DELAYS = [
  [0, 'Không nghỉ'],
  [1000, '1 giây'],
  [2000, '2 giây'],
  [5000, '5 giây'],
  [10000, '10 giây'],
  [30000, '30 giây'],
  [60000, '1 phút']
] as const
const DEFAULT_BODY = '<p>Kính gửi anh/chị ,</p><p><br></p>'
const DRAFT_KEY = 'maillite.merge.template'

function loadTemplate(): { subject: string; html: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveTemplate(t: { subject: string; html: string }): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(t))
  } catch {
    /* không lưu được cũng không sao */
  }
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} giây`
  if (s < 3600) return `${Math.round(s / 60)} phút`
  return `${Math.floor(s / 3600)} giờ ${Math.round((s % 3600) / 60)} phút`
}

export function MergeDialog(props: {
  accounts: Account[]
  defaultAccountId?: number
  onClose: () => void
  toast: (text: string, kind?: 'info' | 'error' | 'ok') => void
}) {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<MergeData | null>(null)
  const [loading, setLoading] = useState(false)
  const [toColumn, setToColumn] = useState('')
  const [ccColumn, setCcColumn] = useState('')
  const [attachColumn, setAttachColumn] = useState('')
  const [accountId, setAccountId] = useState(props.defaultAccountId ?? props.accounts[0]?.id ?? 0)
  const saved = useMemo(loadTemplate, [])
  const [subject, setSubject] = useState(saved?.subject ?? '')
  const [html, setHtml] = useState(saved?.html || DEFAULT_BODY)
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>([])
  const [delayMs, setDelayMs] = useState(2000)
  const [check, setCheck] = useState<MergeCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [idx, setIdx] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [testing, setTesting] = useState(false)
  const [progress, setProgress] = useState<MergeProgress | null>(null)
  const [discard, setDiscard] = useState(false)
  const [focus, setFocus] = useState<'subject' | 'body'>('body')
  const rich = useRef<RichEditorHandle>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const account = props.accounts.find((a) => a.id === accountId)

  // Mở lại khi có đợt gửi đang chạy nền hoặc còn dở (kể cả từ lần mở app trước) → vào thẳng bước theo dõi
  useEffect(() => {
    const refresh = (): void => void api.mergeStatus().then(setProgress)
    void api.mergeStatus().then((s) => {
      if (s && (s.running || s.remaining > 0)) {
        setProgress(s)
        setStep(3)
      }
    })
    return onEvent((e) => {
      if (e.type !== 'merge-progress') return
      const last = e.last
      if (!e.running || !last) return refresh()
      setProgress((p) => {
        // nối thêm kết quả mới; nếu lệch nhịp (vừa mở hộp thoại, vừa gửi tiếp…) thì lấy lại toàn bộ
        if (p && p.results.length + 1 === e.done) return { ...p, running: true, results: [...p.results, last], remaining: e.remaining }
        refresh()
        return p
      })
    })
  }, [])

  const load = async (file: string, sheet?: string): Promise<void> => {
    setLoading(true)
    try {
      const d = await api.mergeRead(file, sheet)
      setData(d)
      setToColumn(guessEmailColumn(d.columns, d.rows))
      setCcColumn('')
      setAttachColumn(d.columns.find((c) => /tệp|đính kèm|file|attach/i.test(c)) ?? '')
      setIdx(0)
      setCheck(null)
    } catch (e) {
      props.toast((e as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }
  const pick = async (): Promise<void> => {
    const f = await api.pickMergeFile()
    if (f) await load(f)
  }

  const job = useMemo<MergeJob | null>(
    () =>
      data && toColumn
        ? {
            accountId,
            subject,
            html,
            columns: data.columns,
            rows: data.rows,
            rowNumbers: data.rowNumbers,
            toColumn,
            ccColumn: ccColumn || undefined,
            attachColumn: attachColumn || undefined,
            baseDir: data.baseDir,
            attachments,
            delayMs
          }
        : null,
    [data, toColumn, ccColumn, attachColumn, accountId, subject, html, attachments, delayMs]
  )

  const toIndex = data ? data.columns.indexOf(toColumn) : -1
  const validCount = useMemo(
    () => (data && toIndex >= 0 ? data.rows.filter((r) => isEmail((r[toIndex] ?? '').split(/[;,]/)[0].trim())).length : 0),
    [data, toIndex]
  )

  const goPreview = async (): Promise<void> => {
    if (!job) return
    saveTemplate({ subject, html })
    setStep(2)
    setChecking(true)
    try {
      setCheck(await api.mergeCheck(job))
    } catch (e) {
      props.toast((e as Error).message, 'error')
    } finally {
      setChecking(false)
    }
  }

  const start = (j: MergeJob): void => {
    setConfirm(false)
    setProgress({ running: true, accountId: j.accountId, total: j.rows.length, results: [], remaining: j.rows.length, subject: j.subject })
    setStep(3)
    api.mergeStart(j).catch((e: Error) => {
      props.toast(e.message, 'error')
      void api.mergeStatus().then((s) => setProgress(s))
    })
  }

  const insertField = (col: string): void => {
    const token = `{{${col}}}`
    if (focus === 'subject' && subjectRef.current) {
      const el = subjectRef.current
      const a = el.selectionStart ?? subject.length
      const b = el.selectionEnd ?? subject.length
      setSubject(subject.slice(0, a) + token + subject.slice(b))
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(a + token.length, a + token.length)
      })
      return
    }
    rich.current?.insertText(token)
  }

  // ---------- Xem trước ----------
  const rec = data ? rowRecord(data.columns, data.rows[idx] ?? []) : null
  const previewDoc = useMemo(() => (rec ? emailDocument(sanitizeEmail(renderTemplate(html, rec, true)), true) : ''), [html, rec])
  const rowIssue = check?.issues.find((i) => data && i.row === data.rowNumbers[idx])

  // ---------- Kết quả ----------
  const sent = progress?.results.filter((r) => r.status === 'sent').length ?? 0
  const failed = progress?.results.filter((r) => r.status === 'failed').length ?? 0
  const skipped = progress?.results.filter((r) => r.status === 'skipped').length ?? 0
  const done = progress?.results.length ?? 0

  const uncertain = progress?.results.filter((r) => r.uncertain).length ?? 0
  const resume = (): void => {
    api
      .mergeResume()
      .then(() => api.mergeStatus())
      .then(setProgress)
      .catch((e: Error) => props.toast(e.message, 'error'))
  }

  const saveReport = async (): Promise<void> => {
    if (!progress) return
    const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`
    const label = { sent: 'Đã gửi', failed: 'Lỗi', skipped: 'Bỏ qua' }
    const lines = [
      ['Dòng', 'Email', 'Trạng thái', 'Chi tiết', 'Thời gian'].join(','),
      ...progress.results.map((r) => [r.row, esc(r.to), label[r.status], esc(r.error ?? ''), esc(new Date(r.at).toLocaleString('vi-VN'))].join(','))
    ]
    const p = await api.saveTextFile('bao-cao-tron-thu.csv', lines.join('\r\n'))
    if (p) props.toast('Đã lưu báo cáo.', 'ok')
  }

  const canNext0 = !!data && !!toColumn && validCount > 0
  const canNext1 = !!subject.trim() && html.replace(/<[^>]+>|&nbsp;|\s/g, '').length > 0 && !!account
  const blockers = check ? check.unknownFields.length > 0 || check.sendable === 0 : true

  const footer =
    step === 3 ? (
      <>
        {progress?.running ? (
          <button className="btn danger" onClick={() => void api.mergeCancel()}>
            <Square size={14} /> Dừng gửi
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => void saveReport()} disabled={!done}>
              Lưu báo cáo .csv
            </button>
            {progress && progress.remaining > 0 && (
              <>
                <button className="btn primary" onClick={resume}>
                  <Send size={15} /> Tiếp tục gửi {progress.remaining} dòng còn lại
                </button>
                <button className="btn" onClick={() => setDiscard(true)} title="Không gửi các dòng còn lại nữa">
                  Bỏ đợt này
                </button>
              </>
            )}
            {progress && progress.remaining === 0 && (
              <button className="btn" onClick={() => setStep(0)}>
                Đợt mới
              </button>
            )}
          </>
        )}
        <span className="grow" />
        <button className="btn" onClick={props.onClose}>
          {progress?.running ? 'Ẩn (vẫn gửi nền)' : 'Đóng'}
        </button>
      </>
    ) : (
      <>
        {step > 0 && (
          <button className="btn" onClick={() => setStep(step - 1)}>
            <ChevronLeft size={15} /> Quay lại
          </button>
        )}
        <span className="grow" />
        {step === 0 && (
          <button className="btn primary" disabled={!canNext0} onClick={() => setStep(1)}>
            Tiếp: soạn mẫu <ChevronRight size={15} />
          </button>
        )}
        {step === 1 && (
          <button className="btn primary" disabled={!canNext1} onClick={() => void goPreview()}>
            Tiếp: xem trước <ChevronRight size={15} />
          </button>
        )}
        {step === 2 && (
          <>
            <button
              className="btn"
              disabled={!job || testing || !!rowIssue}
              title={`Gửi thư của dòng đang xem tới ${account?.email ?? ''}`}
              onClick={() => {
                if (!job) return
                setTesting(true)
                api
                  .mergeTest(job, idx)
                  .then((to) => props.toast(`Đã gửi thử tới ${to}.`, 'ok'))
                  .catch((e: Error) => props.toast(e.message, 'error'))
                  .finally(() => setTesting(false))
              }}
            >
              {testing ? 'Đang gửi thử…' : 'Gửi thử cho tôi'}
            </button>
            <button className="btn primary" disabled={checking || blockers} onClick={() => setConfirm(true)}>
              <Send size={15} /> Gửi {check?.sendable ?? 0} thư
            </button>
          </>
        )}
        <button className="btn" onClick={props.onClose}>
          Huỷ
        </button>
      </>
    )

  return (
    <Modal title="Trộn thư — gửi hàng loạt từ Excel" onClose={props.onClose} width={940} className="merge" footer={footer}>
      <ol className="steps-bar">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="merge-pane">
          <div className="merge-file">
            <button className="btn primary" onClick={() => void pick()} disabled={loading}>
              <FileSpreadsheet size={16} /> {data ? 'Chọn tệp khác…' : 'Chọn tệp Excel / CSV…'}
            </button>
            {loading && <span className="busy"><span className="spinner" /> Đang đọc tệp…</span>}
            {data && !loading && (
              <span className="muted file-name" title={data.file}>
                {data.file.split(/[\\/]/).pop()} · {data.rows.length} dòng{data.truncated ? ' (đã cắt ở 5.000 dòng đầu)' : ''}
              </span>
            )}
          </div>
          {!data && (
            <div className="merge-hint">
              <p>Tệp cần có <b>dòng đầu là tiêu đề cột</b>, mỗi dòng sau là một người nhận. Ví dụ:</p>
              <table className="grid">
                <thead>
                  <tr><th>Họ tên</th><th>Email</th><th>Công ty</th><th>Số tiền</th><th>Tệp</th></tr>
                </thead>
                <tbody>
                  <tr><td>Trần Thị Mai</td><td>mai@congty.vn</td><td>Công ty A</td><td>15.500.000</td><td>hoa-don\mai.pdf</td></tr>
                  <tr><td>Lê Nam</td><td>nam@doitac.vn</td><td>Kho vận Nam</td><td>8.200.000</td><td></td></tr>
                </tbody>
              </table>
              <p className="muted small">
                Mỗi người nhận một thư riêng, không ai thấy địa chỉ của người khác. Cột “Tệp” (không bắt buộc) chứa đường dẫn tệp đính kèm riêng
                cho từng người — đường dẫn tương đối tính từ thư mục chứa tệp Excel, nhiều tệp cách nhau bằng dấu chấm phẩy.
              </p>
            </div>
          )}
          {data && (
            <>
              <div className="form three">
                {data.sheets.length > 1 && (
                  <Field label="Trang tính">
                    <select value={data.sheet} onChange={(e) => void load(data.file, e.target.value)}>
                      {data.sheets.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Cột địa chỉ email (bắt buộc)">
                  <select value={toColumn} onChange={(e) => setToColumn(e.target.value)}>
                    <option value="">— chọn cột —</option>
                    {data.columns.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Cột Cc (tuỳ chọn)">
                  <select value={ccColumn} onChange={(e) => setCcColumn(e.target.value)}>
                    <option value="">Không dùng</option>
                    {data.columns.filter((c) => c !== toColumn).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Cột tệp đính kèm riêng (tuỳ chọn)">
                  <select value={attachColumn} onChange={(e) => setAttachColumn(e.target.value)}>
                    <option value="">Không dùng</option>
                    {data.columns.filter((c) => c !== toColumn).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
              {toColumn && (
                <p className={validCount ? 'muted small' : 'err small'}>
                  {validCount} / {data.rows.length} dòng có địa chỉ email hợp lệ ở cột “{toColumn}”.
                  {validCount < data.rows.length && validCount > 0 && ' Các dòng còn lại sẽ được liệt kê ở bước xem trước.'}
                </p>
              )}
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>#</th>
                      {data.columns.map((c) => (
                        <th key={c} className={c === toColumn ? 'key' : ''}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 12).map((r, i) => (
                      <tr key={i}>
                        <td className="muted">{data.rowNumbers[i]}</td>
                        {r.map((c, j) => (
                          <td key={j} title={c}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.rows.length > 12 && <p className="muted small">Đang hiện 12 dòng đầu trong {data.rows.length} dòng.</p>}
            </>
          )}
        </div>
      )}

      {step === 1 && data && (
        <div className="merge-pane compose-like">
          <div className="crow">
            <label>Từ</label>
            <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
              {props.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName ? `${a.displayName} <${a.email}>` : a.email}
                </option>
              ))}
            </select>
          </div>
          <div className="crow">
            <label>Chủ đề</label>
            <input
              ref={subjectRef}
              value={subject}
              placeholder="VD: Thông báo công nợ tháng 10 — {{Công ty}}"
              onFocus={() => setFocus('subject')}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="fields-bar">
            <span className="muted small">Chèn trường vào {focus === 'subject' ? 'chủ đề' : 'nội dung'}:</span>
            {data.columns.map((c) => (
              <button key={c} className="field-chip" onMouseDown={(e) => (e.preventDefault(), insertField(c))} title={`Chèn {{${c}}}`}>
                {c}
              </button>
            ))}
          </div>
          <div className="toolbar actions">
            <button
              className="wide"
              title="Tệp gửi kèm cho tất cả mọi người"
              onClick={() => void api.pickAttachments().then((f) => f.length && setAttachments((a) => [...a, ...f]))}
            >
              <Paperclip size={16} /> Đính kèm chung
            </button>
            {account?.signatureHtml && (
              <button
                className="wide"
                title="Chèn chữ ký của tài khoản gửi vào cuối thư"
                onClick={() => {
                  rich.current?.appendHtml(`<p><br></p><div class="mn-signature">${sanitizeEmail(account.signatureHtml)}</div>`)
                }}
              >
                Chèn chữ ký
              </button>
            )}
          </div>
          {attachments.length > 0 && (
            <div className="attachments compose-att">
              {attachments.map((a, i) => (
                <div key={i} className="att">
                  <span className="att-open">
                    <Paperclip size={15} />
                    <span className="att-name">{a.filename}</span>
                    <span className="muted">{fmtSize(a.size)}</span>
                  </span>
                  <button className="icon-btn" title="Bỏ tệp" onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <RichEditor
            ref={rich}
            className="merge-editor"
            initialHtml={html || DEFAULT_BODY}
            onFocus={() => setFocus('body')}
            onChange={setHtml}
            onError={(m) => props.toast(m, 'error')}
            ariaLabel="Nội dung thư mẫu"
          />
        </div>
      )}

      {step === 2 && data && (
        <div className="merge-pane preview">
          <div className="merge-summary">
            {checking || !check ? (
              <span className="busy"><span className="spinner" /> Đang rà soát danh sách…</span>
            ) : (
              <>
                <span className="pill ok"><CheckCircle2 size={14} /> Sẽ gửi {check.sendable} thư</span>
                {check.issues.some((i) => i.level === 'skip') && (
                  <span className="pill"><CircleSlash size={14} /> Bỏ qua {check.issues.filter((i) => i.level === 'skip').length} dòng không có email</span>
                )}
                {check.issues.some((i) => i.level === 'error') && (
                  <span className="pill bad"><XCircle size={14} /> {check.issues.filter((i) => i.level === 'error').length} dòng lỗi (sẽ không gửi)</span>
                )}
                <span className="grow" />
                <label className="inline-field">
                  Nghỉ giữa hai thư
                  <select value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))}>
                    {DELAYS.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
                {check.sendable > 1 && delayMs > 0 && <span className="muted small">≈ {duration((check.sendable - 1) * delayMs)}</span>}
              </>
            )}
          </div>
          {check && check.unknownFields.length > 0 && (
            <div className="note error">
              <AlertTriangle size={16} />
              <span>
                Mẫu có trường không khớp cột nào trong tệp: {check.unknownFields.map((f) => `{{${f}}}`).join(', ')}. Hãy quay lại sửa mẫu (hoặc tên cột) —
                nếu không người nhận sẽ thấy nguyên văn dấu ngoặc.
              </span>
            </div>
          )}
          {check && check.issues.some((i) => i.level === 'error') && (
            <details className="issues">
              <summary>Xem các dòng lỗi</summary>
              <ul>
                {check.issues.filter((i) => i.level === 'error').slice(0, 100).map((i) => (
                  <li key={i.row}>Dòng {i.row}: {i.message}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="preview-nav">
            <button className="icon-btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)} title="Người trước"><ChevronLeft size={18} /></button>
            <span>
              Người nhận {idx + 1} / {data.rows.length} <span className="muted">(dòng {data.rowNumbers[idx]})</span>
            </span>
            <button className="icon-btn" disabled={idx >= data.rows.length - 1} onClick={() => setIdx(idx + 1)} title="Người sau"><ChevronRight size={18} /></button>
            {rowIssue && <span className={`pill ${rowIssue.level === 'error' ? 'bad' : ''}`}>{rowIssue.message}</span>}
          </div>
          {rec && (
            <div className="preview-head">
              <div><span className="muted">Tới:</span> {rec.get(fieldKey(toColumn)) || <em className="err">(trống)</em>}</div>
              <div><span className="muted">Chủ đề:</span> <b>{renderTemplate(subject, rec, false)}</b></div>
            </div>
          )}
          <iframe className="preview-body" title="Xem trước thư" sandbox="" srcDoc={previewDoc} />
        </div>
      )}

      {step === 3 && progress && (
        <div className="merge-pane">
          {progress.subject && <div className="muted small file-name">Mẫu: {progress.subject}</div>}
          <div className="progress-head">
            <b>
              {progress.running
                ? `Đang gửi… ${done} / ${progress.total}`
                : progress.remaining > 0
                  ? `Tạm dừng ở ${done} / ${progress.total} — còn ${progress.remaining} dòng chưa gửi`
                  : `Đã xong ${done} / ${progress.total}`}
            </b>
            <span className="pill ok"><CheckCircle2 size={14} /> Đã gửi {sent}</span>
            {failed > 0 && <span className="pill bad"><XCircle size={14} /> Lỗi {failed}</span>}
            {skipped > 0 && <span className="pill"><CircleSlash size={14} /> Bỏ qua {skipped}</span>}
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={done}>
            <div style={{ width: `${progress.total ? (done / progress.total) * 100 : 0}%` }} />
          </div>
          {progress.stopped && (
            <div className="note error">
              <AlertTriangle size={16} />
              <span>
                {progress.stopped}
                {!progress.running && progress.remaining > 0 && ' Bấm “Tiếp tục gửi” để gửi các dòng còn lại — những người đã nhận thư sẽ không bị gửi lại.'}
                {uncertain > 0 && ` Có ${uncertain} dòng không rõ đã gửi hay chưa (xem cột Chi tiết); các dòng này không tự gửi lại.`}
              </span>
            </div>
          )}
          <div className="grid-wrap tall">
            <table className="grid">
              <thead>
                <tr><th>Dòng</th><th>Email</th><th>Trạng thái</th><th>Chi tiết</th><th>Lúc</th></tr>
              </thead>
              <tbody>
                {[...progress.results].reverse().map((r) => (
                  <tr key={`${r.row}-${r.at}`} className={r.status}>
                    <td>{r.row}</td>
                    <td title={r.to}>{r.to || '—'}</td>
                    <td>{{ sent: 'Đã gửi', failed: 'Lỗi', skipped: 'Bỏ qua' }[r.status]}</td>
                    <td title={r.error}>{r.error ?? ''}</td>
                    <td>{fmtTime(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {discard && (
        <ConfirmDialog
          title="Bỏ đợt gửi dở"
          message={`Bỏ ${progress?.remaining ?? 0} dòng chưa gửi của đợt này? Bạn sẽ không gửi tiếp được nữa (các thư đã gửi không bị ảnh hưởng).`}
          okLabel="Bỏ đợt này"
          danger
          onClose={() => setDiscard(false)}
          onOk={() => {
            setDiscard(false)
            void api.mergeDiscard().then(() => {
              setProgress(null)
              setStep(0)
            })
          }}
        />
      )}
      {confirm && job && check && (
        <ConfirmDialog
          title="Gửi thư hàng loạt"
          message={`Gửi ${check.sendable} thư từ ${account?.email}? Thư đã gửi không thu hồi được.${progress && progress.remaining > 0 ? ` Đợt gửi dở trước đó (còn ${progress.remaining} dòng) sẽ bị thay thế.` : ''}`}
          okLabel={`Gửi ${check.sendable} thư`}
          onClose={() => setConfirm(false)}
          onOk={() => start(job)}
        />
      )}
    </Modal>
  )
}
