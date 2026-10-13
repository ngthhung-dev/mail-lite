import { useEffect, useState } from 'react'
import { ArchiveRestore, DatabaseBackup, FolderOpen, Pencil, Plus, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import type { Account, AppSettings, Folder, Rule, RuleAction, RuleCondition } from '../../../shared/types.ts'
import { api } from '../api.ts'
import { isEmail } from '../../../shared/merge.ts'
import { buildTree, flattenTree, fmtFull, folderLabel } from '../util.ts'
import { ConfirmDialog, Field, Modal } from './ui.tsx'
import { RichEditor } from './RichEditor.tsx'
import type { Toast } from './ui.tsx'

const TABS = [
  ['accounts', 'Tài khoản'],
  ['general', 'Chung'],
  ['signatures', 'Chữ ký'],
  ['rules', 'Quy tắc'],
  ['categories', 'Phân loại'],
  ['oauth', 'Đăng nhập OAuth'],
  ['data', 'Dữ liệu']
] as const

const FIELD_LABEL: Record<RuleCondition['field'], string> = {
  from: 'Người gửi',
  to: 'Người nhận',
  subject: 'Chủ đề',
  body: 'Nội dung',
  hasAttachment: 'Có tệp đính kèm'
}

function describeRule(r: Rule): string {
  const conds = r.conditions
    .map((c) => (c.field === 'hasAttachment' ? 'có tệp đính kèm' : `${FIELD_LABEL[c.field].toLowerCase()} ${c.op === 'notContains' ? 'không chứa' : c.op === 'equals' ? 'là' : 'chứa'} “${c.value}”`))
    .join(r.match === 'any' ? ' hoặc ' : ' và ')
  const acts = r.actions
    .map((a) =>
      a.type === 'move' ? `chuyển tới “${a.folderPath}”` : a.type === 'markRead' ? 'đánh dấu đã đọc' : a.type === 'flag' ? 'gắn cờ' : a.type === 'category' ? `phân loại “${a.value}”` : a.type === 'forward' ? `chuyển tiếp tới ${a.to}` : 'xoá'
    )
    .join(', ')
  return `Nếu ${conds || '…'} → ${acts || '…'}`
}

function RuleEditor(props: { rule: Rule | null; accounts: Account[]; folders: Folder[]; settings: AppSettings; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState<Omit<Rule, 'id'> & { id?: number }>(
    props.rule ?? {
      name: '',
      enabled: true,
      accountId: null,
      match: 'all',
      conditions: [{ field: 'from', op: 'contains', value: '' }],
      actions: [{ type: 'move', folderPath: '' }],
      sort: 0
    }
  )
  const [err, setErr] = useState('')
  const accId = r.accountId ?? props.accounts[0]?.id
  const folderOpts = flattenTree(buildTree(props.folders.filter((f) => f.accountId === accId)))
  const setCond = (i: number, p: Partial<RuleCondition>): void => setR({ ...r, conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...p } : c)) })
  const setAct = (i: number, a: RuleAction): void => setR({ ...r, actions: r.actions.map((x, j) => (j === i ? a : x)) })

  const save = async (): Promise<void> => {
    if (!r.name.trim()) return setErr('Hãy đặt tên quy tắc.')
    if (r.conditions.some((c) => c.field !== 'hasAttachment' && !c.value.trim())) return setErr('Có điều kiện chưa nhập giá trị.')
    if (r.actions.some((a) => (a.type === 'move' && !a.folderPath) || (a.type === 'category' && !a.value))) return setErr('Có hành động chưa chọn đích.')
    if (r.actions.some((a) => a.type === 'forward' && !a.to.split(/[;,]/).map((x) => x.trim()).filter(Boolean).every(isEmail))) return setErr('Địa chỉ chuyển tiếp chưa hợp lệ.')
    if (r.actions.some((a) => a.type === 'forward' && !a.to.trim())) return setErr('Chưa nhập địa chỉ chuyển tiếp.')
    if (!r.actions.length) return setErr('Cần ít nhất một hành động.')
    await api.saveRule(r)
    props.onSaved()
  }

  return (
    <Modal
      title={props.rule ? 'Sửa quy tắc' : 'Quy tắc mới'}
      onClose={props.onClose}
      width={640}
      footer={
        <>
          <button className="btn primary" onClick={() => void save()}>Lưu quy tắc</button>
          <button className="btn" onClick={props.onClose}>Huỷ</button>
        </>
      }
    >
      <div className="form">
        <Field label="Tên quy tắc">
          <input autoFocus value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="VD: Hoá đơn → thư mục Kế toán" />
        </Field>
        <Field label="Áp dụng cho">
          <select value={r.accountId ?? ''} onChange={(e) => setR({ ...r, accountId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Mọi tài khoản</option>
            {props.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.email}</option>
            ))}
          </select>
        </Field>
      </div>
      <h4>
        Khi thư mới đến Hộp thư đến và khớp{' '}
        <select value={r.match} onChange={(e) => setR({ ...r, match: e.target.value as Rule['match'] })}>
          <option value="all">tất cả</option>
          <option value="any">bất kỳ</option>
        </select>{' '}
        điều kiện:
      </h4>
      {r.conditions.map((c, i) => (
        <div className="rule-row" key={i}>
          <select value={c.field} onChange={(e) => setCond(i, { field: e.target.value as RuleCondition['field'], op: e.target.value === 'hasAttachment' ? 'is' : 'contains', value: e.target.value === 'hasAttachment' ? 'true' : '' })}>
            {Object.entries(FIELD_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {c.field !== 'hasAttachment' && (
            <>
              <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value as RuleCondition['op'] })}>
                <option value="contains">chứa</option>
                <option value="notContains">không chứa</option>
                <option value="equals">chính xác là</option>
              </select>
              <input value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder="từ khoá hoặc địa chỉ" />
            </>
          )}
          <button className="icon-btn" title="Bỏ điều kiện" disabled={r.conditions.length === 1} onClick={() => setR({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button className="link" onClick={() => setR({ ...r, conditions: [...r.conditions, { field: 'subject', op: 'contains', value: '' }] })}>+ Thêm điều kiện</button>

      <h4>Thì thực hiện:</h4>
      {r.actions.map((a, i) => (
        <div className="rule-row" key={i}>
          <select
            value={a.type}
            onChange={(e) => {
              const t = e.target.value as RuleAction['type']
              setAct(i, t === 'move' ? { type: 'move', folderPath: '' } : t === 'forward' ? { type: 'forward', to: '' } : t === 'category' ? { type: 'category', value: props.settings.categories[0]?.name ?? '' } : ({ type: t } as RuleAction))
            }}
          >
            <option value="move">Chuyển tới thư mục</option>
            <option value="forward">Chuyển tiếp thư tới</option>
            <option value="markRead">Đánh dấu đã đọc</option>
            <option value="flag">Gắn cờ</option>
            <option value="category">Gán phân loại</option>
            <option value="delete">Xoá</option>
          </select>
          {a.type === 'move' && (
            <select value={a.folderPath} onChange={(e) => setAct(i, { type: 'move', folderPath: e.target.value })}>
              <option value="">— chọn thư mục —</option>
              {folderOpts.map((n) => (
                <option key={n.folder.id} value={n.folder.path}>
                  {'  '.repeat(n.depth)}
                  {folderLabel(n.folder)}
                </option>
              ))}
            </select>
          )}
          {a.type === 'forward' && (
            <input type="email" value={a.to} placeholder="nguoinhan@congty.vn (nhiều địa chỉ cách nhau bằng ;)" onChange={(e) => setAct(i, { type: 'forward', to: e.target.value })} />
          )}
          {a.type === 'category' && (
            <select value={a.value} onChange={(e) => setAct(i, { type: 'category', value: e.target.value })}>
              {props.settings.categories.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          )}
          <button className="icon-btn" title="Bỏ hành động" disabled={r.actions.length === 1} onClick={() => setR({ ...r, actions: r.actions.filter((_, j) => j !== i) })}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button className="link" onClick={() => setR({ ...r, actions: [...r.actions, { type: 'markRead' }] })}>+ Thêm hành động</button>
      {r.accountId == null && props.accounts.length > 1 && r.actions.some((a) => a.type === 'move') && (
        <p className="muted small">Danh sách thư mục lấy theo tài khoản đầu tiên; ở tài khoản không có thư mục cùng đường dẫn, bước “chuyển tới” sẽ được bỏ qua.</p>
      )}
      {r.actions.some((a) => a.type === 'forward') && (
        <p className="muted small">
          Thư khớp điều kiện sẽ tự được chuyển tiếp (kèm tệp đính kèm) khi về Hộp thư đến trong lúc Mail Lite đang mở. Bấm “Chạy quy tắc ngay” trên thư cũ sẽ không
          chuyển tiếp, để tránh gửi hàng loạt ngoài ý muốn.
        </p>
      )}
      {err && <div className="note error">{err}</div>}
    </Modal>
  )
}

export function SettingsDialog(props: {
  tab?: string
  accounts: Account[]
  folders: Folder[]
  settings: AppSettings
  onSettings: (p: Partial<AppSettings>) => void
  onClose: () => void
  onEditAccount: (a: Account) => void
  onAddAccount: () => void
  onChanged: () => void
  toast: (text: string, kind?: Toast['kind']) => void
  onBackup: () => void
  onRestore: () => void
  backupBusy?: boolean
}) {
  const [tab, setTab] = useState(props.tab ?? 'accounts')
  const [rules, setRules] = useState<Rule[]>([])
  const [editRule, setEditRule] = useState<{ rule: Rule | null } | null>(null)
  const [removing, setRemoving] = useState<Account | null>(null)
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.appInfo>> | null>(null)
  const [sigAcc, setSigAcc] = useState<number>(props.accounts[0]?.id ?? 0)
  const [sig, setSig] = useState('')
  const s = props.settings
  const [oauth, setOauth] = useState({ googleClientId: s.googleClientId, googleClientSecret: s.googleClientSecret, microsoftClientId: s.microsoftClientId })

  const loadRules = (): void => void api.listRules().then(setRules)
  useEffect(() => {
    loadRules()
    void api.appInfo().then(setInfo)
  }, [])
  useEffect(() => {
    setSig(props.accounts.find((a) => a.id === sigAcc)?.signatureHtml ?? '')
  }, [sigAcc, props.accounts])

  const saveSignature = async (): Promise<void> => {
    const a = props.accounts.find((x) => x.id === sigAcc)
    if (!a) return
    try {
      await api.saveAccount({ ...a, signatureHtml: sig })
      props.onChanged()
      props.toast('Đã lưu chữ ký.', 'ok')
    } catch (e) {
      props.toast((e as Error).message, 'error')
    }
  }

  return (
    <Modal title="Cài đặt" onClose={props.onClose} width={820} className="settings">
      <div className="settings-layout">
        <nav>
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {tab === 'accounts' && (
            <>
              <h3>Tài khoản mail</h3>
              {props.accounts.length === 0 && <p className="muted">Chưa có tài khoản nào.</p>}
              {props.accounts.map((a) => (
                <div className="card" key={a.id}>
                  <span className="dot big" style={{ background: a.color }} />
                  <div className="grow">
                    <b>{a.name}</b> <span className="muted">· {a.email}</span>
                    <div className="muted small">
                      {a.imapHost}:{a.imapPort} · {a.authType === 'oauth' ? 'OAuth' : 'mật khẩu'} · {a.syncDays ? `đồng bộ ${a.syncDays} ngày` : 'đồng bộ toàn bộ'}
                    </div>
                    <div className={`small ${a.lastError ? 'err' : 'muted'}`}>
                      {a.lastError ? `Lỗi: ${a.lastError}` : a.lastSync ? `Đồng bộ lần cuối: ${fmtFull(a.lastSync)}` : 'Chưa đồng bộ xong'}
                    </div>
                  </div>
                  <button className="icon-btn" title="Sửa" onClick={() => props.onEditAccount(a)}><Pencil size={16} /></button>
                  <button className="icon-btn" title="Gỡ tài khoản" onClick={() => setRemoving(a)}><Trash2 size={16} /></button>
                </div>
              ))}
              <button className="btn primary" onClick={props.onAddAccount}><Plus size={15} /> Thêm tài khoản</button>
            </>
          )}

          {tab === 'general' && (
            <>
              <h3>Chung</h3>
              <div className="form one">
                <Field label="Tự động Gửi/Nhận mỗi">
                  <select value={s.syncIntervalMin} onChange={(e) => props.onSettings({ syncIntervalMin: Number(e.target.value) })}>
                    {[1, 2, 5, 10, 15, 30, 60].map((m) => (
                      <option key={m} value={m}>{m} phút</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="form one">
                <Field label="Hoàn tác gửi — giữ thư lại trước khi gửi thật" hint="Trong thời gian này có nút Hoàn tác để lấy lại thư gửi nhầm. Sau khi thư đã rời máy thì không thu hồi được.">
                  <select value={s.undoSendSec} onChange={(e) => props.onSettings({ undoSendSec: Number(e.target.value) })}>
                    <option value={0}>Tắt (gửi ngay)</option>
                    {[5, 10, 20, 30, 60].map((n) => (
                      <option key={n} value={n}>{n} giây</option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="check block">
                <input type="checkbox" checked={s.notifications} onChange={(e) => props.onSettings({ notifications: e.target.checked })} /> Hiện thông báo khi có thư mới
              </label>
              <label className="check block">
                <input type="checkbox" checked={s.markReadOnOpen} onChange={(e) => props.onSettings({ markReadOnOpen: e.target.checked })} /> Đánh dấu đã đọc khi mở thư trong ngăn đọc
              </label>
              <label className="check block">
                <input type="checkbox" checked={s.blockRemoteImages} onChange={(e) => props.onSettings({ blockRemoteImages: e.target.checked })} /> Chặn hình ảnh từ bên ngoài (chống theo dõi mở thư)
              </label>
              <p className="muted small">Hộp thư đến còn nhận thư mới gần như tức thời nhờ kết nối đẩy (IMAP IDLE) khi máy chủ hỗ trợ.</p>
            </>
          )}

          {tab === 'signatures' && (
            <>
              <h3>Chữ ký</h3>
              {props.accounts.length === 0 ? (
                <p className="muted">Thêm tài khoản trước để đặt chữ ký.</p>
              ) : (
                <>
                  <div className="form one">
                    <Field label="Tài khoản">
                      <select value={sigAcc} onChange={(e) => setSigAcc(Number(e.target.value))}>
                        {props.accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.email}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <RichEditor
                    key={sigAcc}
                    className="sig"
                    initialHtml={props.accounts.find((a) => a.id === sigAcc)?.signatureHtml ?? ''}
                    onChange={setSig}
                    onError={(m) => props.toast(m, 'error')}
                    ariaLabel="Chữ ký"
                  />
                  <p className="muted small">Chữ ký tự chèn vào thư mới, thư trả lời và chuyển tiếp. Có thể chèn logo, bảng, liên kết.</p>
                  <button className="btn primary" onClick={() => void saveSignature()}>Lưu chữ ký</button>
                </>
              )}
            </>
          )}

          {tab === 'rules' && (
            <>
              <h3>Quy tắc xử lý thư đến</h3>
              <p className="muted small">Quy tắc chạy theo thứ tự với thư mới về Hộp thư đến. Thư đã bị chuyển/xoá sẽ không xét các quy tắc sau.</p>
              {rules.length === 0 && <p className="muted">Chưa có quy tắc nào.</p>}
              {rules.map((r) => (
                <div className="card" key={r.id}>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    title="Bật/tắt"
                    onChange={(e) => void api.saveRule({ ...r, enabled: e.target.checked }).then(loadRules)}
                  />
                  <div className="grow">
                    <b>{r.name}</b>
                    <div className="muted small">{describeRule(r)}</div>
                  </div>
                  <button className="icon-btn" title="Sửa" onClick={() => setEditRule({ rule: r })}><Pencil size={16} /></button>
                  <button className="icon-btn" title="Xoá" onClick={() => void api.deleteRule(r.id).then(loadRules)}><Trash2 size={16} /></button>
                </div>
              ))}
              <button className="btn primary" onClick={() => setEditRule({ rule: null })}><Plus size={15} /> Quy tắc mới</button>
            </>
          )}

          {tab === 'categories' && (
            <>
              <h3>Phân loại màu</h3>
              {s.categories.map((c, i) => (
                <div className="rule-row" key={i}>
                  <input type="color" value={c.color} onChange={(e) => props.onSettings({ categories: s.categories.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
                  <input value={c.name} onChange={(e) => props.onSettings({ categories: s.categories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <button className="icon-btn" title="Xoá" onClick={() => props.onSettings({ categories: s.categories.filter((_, j) => j !== i) })}><Trash2 size={15} /></button>
                </div>
              ))}
              <button className="link" onClick={() => props.onSettings({ categories: [...s.categories, { name: `Loại ${s.categories.length + 1}`, color: '#038387' }] })}>+ Thêm phân loại</button>
              <p className="muted small">Phân loại lưu trên máy này (không đồng bộ lên máy chủ). Đổi tên một phân loại sẽ không cập nhật các thư đã gán tên cũ.</p>
            </>
          )}

          {tab === 'oauth' && (
            <>
              <h3>Đăng nhập OAuth (Google / Microsoft)</h3>
              <p className="small">
                Google và Microsoft yêu cầu mỗi ứng dụng mail có “Client ID” riêng do chính bạn (hoặc IT công ty) đăng ký — Mail Lite không kèm sẵn. Chỉ cần làm một lần.
              </p>
              <h4>Google (Gmail, Google Workspace)</h4>
              <ol className="small steps">
                <li>Vào console.cloud.google.com → tạo project → bật <b>Gmail API</b>.</li>
                <li>OAuth consent screen → thêm scope <code>https://mail.google.com/</code> và thêm email của bạn vào Test users.</li>
                <li>Credentials → Create OAuth client ID → loại <b>Desktop app</b> → chép Client ID và Client secret vào đây.</li>
              </ol>
              <div className="form">
                <Field label="Google Client ID"><input value={oauth.googleClientId} onChange={(e) => setOauth({ ...oauth, googleClientId: e.target.value.trim() })} /></Field>
                <Field label="Google Client secret"><input type="password" value={oauth.googleClientSecret} onChange={(e) => setOauth({ ...oauth, googleClientSecret: e.target.value.trim() })} /></Field>
              </div>
              <p className="muted small">Cách nhanh hơn cho Gmail cá nhân: bật xác minh 2 bước rồi tạo “Mật khẩu ứng dụng” và đăng nhập bằng mật khẩu đó — không cần Client ID.</p>
              <h4>Microsoft (Microsoft 365, Outlook.com)</h4>
              <ol className="small steps">
                <li>Vào entra.microsoft.com → App registrations → New registration (chọn loại tài khoản phù hợp).</li>
                <li>Authentication → Add platform → <b>Mobile and desktop applications</b> → Redirect URI: <code>http://localhost</code>; bật “Allow public client flows”.</li>
                <li>API permissions → thêm <code>IMAP.AccessAsUser.All</code>, <code>SMTP.Send</code>, <code>offline_access</code>.</li>
              </ol>
              <div className="form one">
                <Field label="Microsoft Application (client) ID"><input value={oauth.microsoftClientId} onChange={(e) => setOauth({ ...oauth, microsoftClientId: e.target.value.trim() })} /></Field>
              </div>
              <p className="muted small">Với Microsoft 365 công ty, quản trị viên có thể cần cho phép ứng dụng và bật IMAP/SMTP AUTH cho hộp thư.</p>
              <button
                className="btn primary"
                onClick={() => {
                  props.onSettings(oauth)
                  props.toast('Đã lưu thông tin OAuth.', 'ok')
                }}
              >
                Lưu
              </button>
            </>
          )}

          {tab === 'data' && info && (
            <>
              <h3>Dữ liệu trên máy</h3>
              <p className="small">Toàn bộ thư (tệp .eml gốc), cơ sở dữ liệu và chỉ mục tìm kiếm nằm tại:</p>
              <p className="path">{info.dataDir}</p>
              <div className="btn-row">
                <button className="btn" onClick={() => void api.openDataDir()}><FolderOpen size={15} /> Mở thư mục dữ liệu</button>
                <button className="btn" onClick={() => void api.changeDataDir().catch((e: Error) => props.toast(e.message, 'error'))}>
                  Đổi nơi lưu…
                </button>
                {info.customDataDir && (
                  <button className="btn" onClick={() => void api.resetDataDir().catch((e: Error) => props.toast(e.message, 'error'))} title={info.defaultDataDir}>
                    Về vị trí mặc định
                  </button>
                )}
              </div>
              <p className="muted small">
                Khi đổi nơi lưu (ví dụ sang ổ D:), Mail Lite chép toàn bộ thư, tài khoản và cài đặt sang vị trí mới rồi khởi động lại; bạn không phải đăng nhập lại.
              </p>
              <div className={`note ${info.secureStorage ? '' : 'error'}`}>
                {info.secureStorage ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
                <span>
                  {info.secureStorage
                    ? 'Mật khẩu và token được mã hoá bằng kho khoá của hệ điều hành (Windows DPAPI / macOS Keychain / Linux Secret Service).'
                    : 'Máy này không có kho khoá hệ thống (thường gặp trên Linux thiếu gnome-keyring/kwallet). Mật khẩu hiện chỉ được mã hoá yếu — hãy cài kho khoá rồi nhập lại mật khẩu.'}
                </span>
              </div>
              <h3 style={{ marginTop: 18 }}>Sao lưu &amp; khôi phục</h3>
              <p className="small">
                Ghi toàn bộ dữ liệu — thư, tệp đính kèm, tài khoản, cài đặt, chữ ký, quy tắc, phân loại, lịch, danh bạ — ra <b>một tệp .mlbackup</b>. Chép tệp đó
                sang USB, ổ mạng hoặc máy khác để cất giữ.
              </p>
              <div className="btn-row">
                <button className="btn primary" onClick={props.onBackup} disabled={props.backupBusy}>
                  <DatabaseBackup size={15} /> {props.backupBusy ? 'Đang sao lưu…' : 'Sao lưu toàn bộ…'}
                </button>
                <button className="btn" onClick={props.onRestore} disabled={props.backupBusy}>
                  <ArchiveRestore size={15} /> Khôi phục từ bản sao lưu…
                </button>
              </div>
              <p className="muted small">
                Khôi phục sẽ thay toàn bộ dữ liệu hiện tại (bản hiện tại được giữ lại một bản phòng khi cần). Khôi phục trên máy khác thì cần nhập lại mật khẩu các
                tài khoản. Muốn xuất riêng từng thư mục ra .mbox: thẻ Thư mục trên thanh công cụ.
              </p>
            </>
          )}
        </div>
      </div>
      {editRule && (
        <RuleEditor
          rule={editRule.rule}
          accounts={props.accounts}
          folders={props.folders}
          settings={s}
          onClose={() => setEditRule(null)}
          onSaved={() => {
            setEditRule(null)
            loadRules()
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Gỡ tài khoản"
          message={`Gỡ ${removing.email} khỏi Mail Lite và xoá toàn bộ thư đã tải về máy của tài khoản này? Thư trên máy chủ không bị ảnh hưởng.`}
          okLabel="Gỡ tài khoản"
          danger
          onClose={() => setRemoving(null)}
          onOk={() => {
            const a = removing
            setRemoving(null)
            void api.removeAccount(a.id).then(
              () => {
                props.onChanged()
                props.toast(`Đã gỡ ${a.email}.`, 'ok')
              },
              (e: Error) => props.toast(e.message, 'error')
            )
          }}
        />
      )}
    </Modal>
  )
}
