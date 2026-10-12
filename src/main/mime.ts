import { simpleParser } from 'mailparser'
import type { ParsedMail } from 'mailparser'
import type { ParsedBody } from './store.ts'

export function makeSnippet(text: string): string {
  return text
    .replace(/\[cid:[^\]]+\]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>(?=.)/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

export async function parseRaw(raw: Buffer): Promise<ParsedMail> {
  return simpleParser(raw, { skipImageLinks: true, skipTextToHtml: false })
}

/**
 * Ảnh "nhúng" là ảnh mà nội dung HTML thật sự tham chiếu tới (src="cid:..."). Nhiều trình gửi thư (Gmail trên điện
 * thoại, Outlook, Apple Mail) gắn Content-ID và "inline" cho cả ảnh đính kèm bình thường — nếu chỉ dựa vào đó
 * thì các tệp này bị ẩn mất khỏi danh sách đính kèm dù không hiện ở đâu trong thư.
 */
export function isInline(a: { cid?: string; contentType?: string }, html: string): boolean {
  const cid = (a.cid ?? '').replace(/^<|>$/g, '')
  return !!cid && /^image\//.test(a.contentType ?? '') && html.includes(`cid:${cid}`)
}

export function toParsedBody(mail: ParsedMail): ParsedBody {
  const html = typeof mail.html === 'string' ? mail.html : ''
  const text = mail.text?.trim() ? mail.text : html ? htmlToText(html) : ''
  const refs = mail.references ? (Array.isArray(mail.references) ? mail.references.join(' ') : mail.references) : ''
  return {
    text,
    html: html || (typeof mail.textAsHtml === 'string' ? mail.textAsHtml : ''),
    snippet: makeSnippet(text),
    refs,
    attachments: (mail.attachments ?? []).map((a, idx) => ({
      idx,
      filename: a.filename || (a.contentType === 'message/rfc822' ? 'thu-dinh-kem.eml' : `tep-${idx + 1}`),
      contentType: a.contentType || 'application/octet-stream',
      size: a.size ?? a.content?.length ?? 0,
      contentId: (a.cid ?? '').replace(/^<|>$/g, ''),
      inline: isInline(a, html)
    }))
  }
}

/** Thay ảnh nhúng cid: bằng data: để hiển thị offline. */
export function inlineCids(html: string, mail: ParsedMail): string {
  if (!/cid:/i.test(html)) return html
  const map = new Map<string, string>()
  for (const a of mail.attachments ?? []) {
    if (a.cid && a.content) {
      map.set(a.cid.replace(/^<|>$/g, ''), `data:${a.contentType};base64,${a.content.toString('base64')}`)
    }
  }
  return html.replace(/cid:([^"'\s)>]+)/gi, (m, cid) => map.get(cid) ?? m)
}
