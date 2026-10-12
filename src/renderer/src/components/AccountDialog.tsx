import { useState } from 'react'
import { Info, KeyRound, LogIn } from 'lucide-react'
import type { Account, AccountInput, AppSettings, ServerPreset } from '../../../shared/types.ts'
import { api } from '../api.ts'
import { Field, Modal } from './ui.tsx'

const COLORS = ['#0f6cbd', '#107c10', '#d13438', '#8764b8', '#ca5010', '#038387', '#c239b3', '#986f0b']

export function AccountDialog(props: {
  account?: Account
  settings: AppSettings
  onClose: () => void
  onSaved: (a: Account) => void
  onOpenOAuthSettings: () => void
}) {
  const e = props.account
  const [f, setF] = useState<AccountInput>(() =>
    e
      ? { ...e, password: '' }
      : {
          name: '',
          email: '',
          displayName: '',
          provider: 'imap',
          authType: 'password',
          imapHost: '',
          imapPort: 993,
          imapSecure: true,
          smtpHost: '',
          smtpPort: 465,
          smtpSecure: true,
          username: '',
          password: '',
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          syncDays: 90
        }
  )
  const [preset, setPreset] = useState<ServerPreset | null>(null)
  const [manual, setManual] = useState(!!e)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const set = (p: Partial<AccountInput>): void => setF((x) => ({ ...x, ...p }))
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())

  const detect = async (): Promise<ServerPreset | null> => {
    if (!validEmail || e) return preset
    setBusy('Đang nhận diện máy chủ…')
    try {
      const p = await api.discover(f.email.trim())
      setPreset(p)
      setF((x) => ({
        ...x,
        provider: p.provider,
        imapHost: p.imapHost,
        imapPort: p.imapPort,
        imapSecure: p.imapSecure,
        smtpHost: p.smtpHost,
        smtpPort: p.smtpPort,
        smtpSecure: p.smtpSecure,
        username: x.username || x.email.trim(),
        name: x.name || x.email.trim().split('@')[1]
      }))
      return p
    } finally {
      setBusy(null)
    }
  }

  const build = (): AccountInput => ({
    ...f,
    email: f.email.trim(),
    username: (f.username || f.email).trim(),
    name: f.name.trim() || f.email.trim(),
    displayName: f.displayName.trim()
  })

  const submit = async (mode: 'password' | 'oauth'): Promise<void> => {
    setError('')
    if (!validEmail) return setError('Địa chỉ email chưa đúng.')
    if (!f.imapHost) await detect()
    const input = build()
    if (!input.imapHost || !input.smtpHost) {
      setManual(true)
      return setError('Chưa có địa chỉ máy chủ IMAP/SMTP.')
    }
    setBusy(mode === 'oauth' ? 'Đang chờ bạn đăng nhập trên trình duyệt…' : 'Đang kiểm tra kết nối IMAP và SMTP…')
    try {
      const acc = mode === 'oauth' ? await api.oauthLogin({ ...input, authType: 'oauth' }) : await api.saveAccount({ ...input, authType: 'password' })
      props.onSaved(acc)
    } catch (err) {
      setError((err as Error).message)
      setManual(true)
    } finally {
      setBusy(null)
    }
  }

  const oauthProvider = f.provider === 'gmail' ? 'Google' : f.provider === 'microsoft' ? 'Microsoft' : null
  const oauthReady = f.provider === 'gmail' ? !!props.settings.googleClientId : f.provider === 'microsoft' ? !!props.settings.microsoftClientId : false
  const wasOauth = e?.authType === 'oauth'

  return (
    <Modal
      title={e ? `Sửa tài khoản — ${e.email}` : 'Thêm tài khoản mail'}
      onClose={props.onClose}
      width={600}
      footer={
        <>
          {busy && <span className="busy"><span className="spinner" /> {busy}</span>}
          <span className="grow" />
          {oauthProvider && (
            <button
              className={`btn ${f.provider === 'microsoft' || wasOauth ? 'primary' : ''}`}
              disabled={!!busy}
              onClick={() => (oauthReady ? void submit('oauth') : props.onOpenOAuthSettings())}
              title={oauthReady ? '' : 'Cần khai báo Client ID trước'}
            >
              <LogIn size={15} /> {oauthReady ? `Đăng nhập với ${oauthProvider}` : `Thiết lập đăng nhập ${oauthProvider}…`}
            </button>
          )}
          {!wasOauth && (
            <button className={`btn ${f.provider === 'microsoft' ? '' : 'primary'}`} disabled={!!busy || (!e && !f.password)} onClick={() => void submit('password')}>
              <KeyRound size={15} /> {e ? 'Lưu' : 'Kết nối bằng mật khẩu'}
            </button>
          )}
          {wasOauth && (
            <button className="btn" disabled={!!busy} onClick={() => void api.saveAccount({ ...build(), authType: 'oauth' }).then(props.onSaved, (er: Error) => setError(er.message))}>
              Lưu
            </button>
          )}
          <button className="btn" onClick={props.onClose}>Huỷ</button>
        </>
      }
    >
      <div className="form">
        <Field label="Địa chỉ email">
          <input autoFocus={!e} type="email" value={f.email} disabled={!!e} placeholder="ten@congty.vn" onChange={(ev) => set({ email: ev.target.value })} onBlur={() => void detect()} />
        </Field>
        <Field label="Tên hiển thị khi gửi">
          <input value={f.displayName} placeholder="Nguyễn Văn A" onChange={(ev) => set({ displayName: ev.target.value })} />
        </Field>
        {!wasOauth && (
          <Field label="Mật khẩu" hint={e ? 'Để trống nếu không đổi.' : undefined}>
            <input type="password" value={f.password} onChange={(ev) => set({ password: ev.target.value })} onKeyDown={(ev) => ev.key === 'Enter' && void submit('password')} />
          </Field>
        )}
        <Field label="Tên tài khoản (hiện trong ứng dụng)">
          <input value={f.name} placeholder="Mail công ty" onChange={(ev) => set({ name: ev.target.value })} />
        </Field>
        <Field label="Đồng bộ thư về máy">
          <select value={f.syncDays} onChange={(ev) => set({ syncDays: Number(ev.target.value) })}>
            <option value={30}>30 ngày gần nhất</option>
            <option value={90}>3 tháng gần nhất</option>
            <option value={365}>1 năm gần nhất</option>
            <option value={0}>Toàn bộ hộp thư</option>
          </select>
        </Field>
        <Field label="Màu nhận diện">
          <div className="colors">
            {COLORS.map((c) => (
              <button key={c} className={f.color === c ? 'on' : ''} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`Màu ${c}`} />
            ))}
          </div>
        </Field>
      </div>

      {preset?.note && !e && (
        <div className="note">
          <Info size={16} />
          <span>{preset.note}</span>
        </div>
      )}
      {error && <div className="note error">{error}</div>}

      <button className="link toggle" onClick={() => setManual(!manual)}>
        {manual ? '▾' : '▸'} Cấu hình máy chủ thủ công
      </button>
      {manual && (
        <div className="form servers">
          <Field label="Máy chủ nhận (IMAP)">
            <input value={f.imapHost} placeholder="imap.congty.vn" onChange={(ev) => set({ imapHost: ev.target.value.trim() })} />
          </Field>
          <div className="pair">
            <Field label="Cổng">
              <input type="number" value={f.imapPort} onChange={(ev) => set({ imapPort: Number(ev.target.value) })} />
            </Field>
            <Field label="Bảo mật">
              <select value={f.imapSecure ? 'ssl' : 'starttls'} onChange={(ev) => set({ imapSecure: ev.target.value === 'ssl', imapPort: ev.target.value === 'ssl' ? 993 : 143 })}>
                <option value="ssl">SSL/TLS (993)</option>
                <option value="starttls">STARTTLS (143)</option>
              </select>
            </Field>
          </div>
          <Field label="Máy chủ gửi (SMTP)">
            <input value={f.smtpHost} placeholder="smtp.congty.vn" onChange={(ev) => set({ smtpHost: ev.target.value.trim() })} />
          </Field>
          <div className="pair">
            <Field label="Cổng">
              <input type="number" value={f.smtpPort} onChange={(ev) => set({ smtpPort: Number(ev.target.value) })} />
            </Field>
            <Field label="Bảo mật">
              <select value={f.smtpSecure ? 'ssl' : 'starttls'} onChange={(ev) => set({ smtpSecure: ev.target.value === 'ssl', smtpPort: ev.target.value === 'ssl' ? 465 : 587 })}>
                <option value="ssl">SSL/TLS (465)</option>
                <option value="starttls">STARTTLS (587)</option>
              </select>
            </Field>
          </div>
          <Field label="Tên đăng nhập" hint="Thường là địa chỉ email đầy đủ." wide>
            <input value={f.username} onChange={(ev) => set({ username: ev.target.value })} />
          </Field>
        </div>
      )}
    </Modal>
  )
}
