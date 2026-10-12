import type { ServerPreset } from '../shared/types.ts'

const P = (
  provider: ServerPreset['provider'],
  imapHost: string,
  smtpHost: string,
  smtpPort = 465,
  oauth = false,
  note?: string
): ServerPreset => ({
  provider,
  imapHost,
  imapPort: 993,
  imapSecure: true,
  smtpHost,
  smtpPort,
  smtpSecure: smtpPort === 465,
  oauth,
  note
})

const GMAIL = P(
  'gmail',
  'imap.gmail.com',
  'smtp.gmail.com',
  465,
  true,
  'Gmail: dùng "Mật khẩu ứng dụng" (bật xác minh 2 bước rồi tạo tại myaccount.google.com/apppasswords), hoặc đăng nhập Google (OAuth) nếu đã khai báo Client ID trong Cài đặt.'
)
const MS = P(
  'microsoft',
  'outlook.office365.com',
  'smtp.office365.com',
  587,
  true,
  'Microsoft 365/Outlook.com: Microsoft đã tắt đăng nhập bằng mật khẩu thường, cần đăng nhập Microsoft (OAuth) — khai báo Client ID trong Cài đặt.'
)

const BY_DOMAIN: Record<string, ServerPreset> = {
  'gmail.com': GMAIL,
  'googlemail.com': GMAIL,
  'outlook.com': MS,
  'hotmail.com': MS,
  'live.com': MS,
  'msn.com': MS,
  'yahoo.com': P('imap', 'imap.mail.yahoo.com', 'smtp.mail.yahoo.com', 465, false, 'Yahoo: cần tạo "App password" trong phần bảo mật tài khoản.'),
  'yahoo.com.vn': P('imap', 'imap.mail.yahoo.com', 'smtp.mail.yahoo.com'),
  'icloud.com': P('imap', 'imap.mail.me.com', 'smtp.mail.me.com', 587, false, 'iCloud: cần tạo mật khẩu dành riêng cho ứng dụng tại appleid.apple.com.'),
  'me.com': P('imap', 'imap.mail.me.com', 'smtp.mail.me.com', 587),
  'zoho.com': P('imap', 'imap.zoho.com', 'smtp.zoho.com'),
  'yandex.com': P('imap', 'imap.yandex.com', 'smtp.yandex.com'),
  'aol.com': P('imap', 'imap.aol.com', 'smtp.aol.com'),
  'gmx.com': P('imap', 'imap.gmx.com', 'mail.gmx.com', 587),
  'fastmail.com': P('imap', 'imap.fastmail.com', 'smtp.fastmail.com')
}

/** Nhận diện theo bản ghi MX để biết tên miền công ty đang dùng Google Workspace hay Microsoft 365. */
async function detectByMx(domain: string): Promise<ServerPreset | null> {
  try {
    const dns = await import('node:dns/promises')
    const mx = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
    ])
    const hosts = mx.map((m) => m.exchange.toLowerCase()).join(' ')
    if (/google\.com|googlemail\.com/.test(hosts)) return { ...GMAIL, note: 'Tên miền này dùng Google Workspace. ' + GMAIL.note }
    if (/outlook\.com|office365|microsoft/.test(hosts)) return { ...MS, note: 'Tên miền này dùng Microsoft 365. ' + MS.note }
    if (/zoho/.test(hosts)) return P('imap', 'imappro.zoho.com', 'smtppro.zoho.com')
    if (/yandex/.test(hosts)) return P('imap', 'imap.yandex.com', 'smtp.yandex.com')
  } catch {
    /* không có mạng / không có MX */
  }
  return null
}

export async function discover(email: string): Promise<ServerPreset> {
  const domain = email.split('@')[1]?.toLowerCase().trim() ?? ''
  if (BY_DOMAIN[domain]) return BY_DOMAIN[domain]
  const mx = domain ? await detectByMx(domain) : null
  if (mx) return mx
  return P(
    'imap',
    domain ? `mail.${domain}` : '',
    domain ? `mail.${domain}` : '',
    465,
    false,
    'Mail công ty: máy chủ được đoán theo tên miền. Nếu không kết nối được, hỏi quản trị viên địa chỉ IMAP/SMTP chính xác (thường là mail.tenmien, imap.tenmien).'
  )
}
