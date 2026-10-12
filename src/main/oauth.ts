import http from 'node:http'
import crypto from 'node:crypto'
import type { AppSettings, Provider } from '../shared/types.ts'

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface Endpoints {
  auth: string
  token: string
  scope: string
  clientId: string
  clientSecret?: string
}

export function endpoints(provider: Provider, s: AppSettings): Endpoints {
  if (provider === 'gmail') {
    if (!s.googleClientId) throw new Error('Chưa khai báo Google Client ID trong Cài đặt → Đăng nhập OAuth.')
    return {
      auth: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      scope: 'https://mail.google.com/',
      clientId: s.googleClientId,
      clientSecret: s.googleClientSecret || undefined
    }
  }
  if (provider === 'microsoft') {
    if (!s.microsoftClientId) throw new Error('Chưa khai báo Microsoft Client ID trong Cài đặt → Đăng nhập OAuth.')
    return {
      auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scope: 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send',
      clientId: s.microsoftClientId
    }
  }
  throw new Error('Nhà cung cấp này không hỗ trợ OAuth.')
}

async function postToken(url: string, body: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`OAuth lỗi: ${json.error_description || json.error || res.status}`)
  return json
}

/** Luồng Authorization Code + PKCE, nhận mã qua cổng loopback trên máy. */
export async function authorize(
  provider: Provider,
  settings: AppSettings,
  loginHint: string,
  openExternal: (url: string) => void | Promise<void>
): Promise<OAuthTokens> {
  const ep = endpoints(provider, settings)
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('hex')

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let redirectUri = ''
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://localhost')
      if (!u.searchParams.has('code') && !u.searchParams.has('error')) {
        res.writeHead(404).end()
        return
      }
      const ok = u.searchParams.get('state') === state && u.searchParams.has('code')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        `<body style="font-family:sans-serif;padding:40px"><h2>${ok ? 'Đăng nhập thành công' : 'Đăng nhập thất bại'}</h2><p>Bạn có thể đóng tab này và quay lại Mail Lite.</p></body>`
      )
      clearTimeout(timer)
      server.close()
      if (ok) resolve({ code: u.searchParams.get('code')!, redirectUri })
      else reject(new Error(u.searchParams.get('error_description') || u.searchParams.get('error') || 'Sai state'))
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Hết thời gian chờ đăng nhập (5 phút).'))
    }, 5 * 60_000)
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port
      // Google chấp nhận 127.0.0.1, Microsoft yêu cầu http://localhost
      redirectUri = provider === 'microsoft' ? `http://localhost:${port}` : `http://127.0.0.1:${port}`
      const q = new URLSearchParams({
        client_id: ep.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: ep.scope,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        login_hint: loginHint,
        access_type: 'offline',
        prompt: provider === 'gmail' ? 'consent' : 'select_account'
      })
      void openExternal(`${ep.auth}?${q}`)
    })
  })

  const json = await postToken(ep.token, {
    client_id: ep.clientId,
    ...(ep.clientSecret ? { client_secret: ep.clientSecret } : {}),
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  })
  if (!json.refresh_token) throw new Error('Máy chủ không trả về refresh token.')
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000
  }
}

export async function refresh(provider: Provider, settings: AppSettings, t: OAuthTokens): Promise<OAuthTokens> {
  if (t.accessToken && t.expiresAt - Date.now() > 120_000) return t
  const ep = endpoints(provider, settings)
  const json = await postToken(ep.token, {
    client_id: ep.clientId,
    ...(ep.clientSecret ? { client_secret: ep.clientSecret } : {}),
    grant_type: 'refresh_token',
    refresh_token: t.refreshToken,
    ...(provider === 'microsoft' ? { scope: ep.scope } : {})
  })
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || t.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000
  }
}
