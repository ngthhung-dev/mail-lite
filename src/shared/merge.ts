// Ghép mẫu thư với dữ liệu từng dòng — dùng chung cho xem trước (giao diện) và gửi thật (tiến trình chính).

const FIELD_RE = /\{\{([^{}]*)\}\}/g

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]*>/g, '') // người dùng tô đậm một phần tên trường → bỏ thẻ
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

/** Chuẩn hoá tên trường để so khớp: không phân biệt hoa thường, thừa khoảng trắng. */
export function fieldKey(name: string): string {
  return decodeEntities(name).replace(/\s+/g, ' ').trim().toLowerCase()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Các trường {{...}} xuất hiện trong mẫu (tên gốc như người dùng gõ). */
export function templateFields(tpl: string): string[] {
  const out = new Map<string, string>()
  for (const m of tpl.matchAll(FIELD_RE)) {
    const shown = decodeEntities(m[1]).trim()
    if (shown) out.set(fieldKey(m[1]), shown)
  }
  return [...out.values()]
}

export function rowRecord(columns: string[], row: string[]): Map<string, string> {
  const rec = new Map<string, string>()
  columns.forEach((c, i) => rec.set(fieldKey(c), row[i] ?? ''))
  return rec
}

/**
 * Thay {{Tên cột}} bằng giá trị của dòng. Trường không có cột tương ứng được giữ nguyên
 * để người dùng nhìn thấy lỗi khi xem trước. Với thân thư HTML, giá trị được escape.
 */
export function renderTemplate(tpl: string, rec: Map<string, string>, html: boolean): string {
  return tpl.replace(FIELD_RE, (whole, name: string) => {
    const v = rec.get(fieldKey(name))
    if (v === undefined) return whole
    return html ? escapeHtml(v).replace(/\r?\n/g, '<br>') : v.replace(/\s*\r?\n\s*/g, ' ')
  })
}

export function splitAddresses(s: string): string[] {
  return s
    .split(/[;,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** Chấp nhận "a@b.vn" hoặc "Tên <a@b.vn>". */
export function isEmail(s: string): boolean {
  const m = s.match(/<([^<>]+)>\s*$/)
  const addr = (m ? m[1] : s).trim()
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:".]{2,}$/.test(addr)
}

/** Đoán cột chứa email: ưu tiên theo tên cột, sau đó theo dữ liệu. */
export function guessEmailColumn(columns: string[], rows: string[][]): string {
  const byName = columns.find((c) => /e-?mail|thư điện tử|địa chỉ thư/i.test(c))
  if (byName) return byName
  let best = ''
  let bestN = 0
  columns.forEach((c, i) => {
    const n = rows.slice(0, 50).filter((r) => isEmail((r[i] ?? '').split(/[;,]/)[0].trim())).length
    if (n > bestN) {
      bestN = n
      best = c
    }
  })
  return best
}
