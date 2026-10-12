import fs from 'node:fs/promises'
import path from 'node:path'
import type { MergeData } from '../shared/types.ts'

export const MERGE_MAX_ROWS = 5000

const pad = (n: number): string => String(n).padStart(2, '0')

/** ExcelJS trả ngày theo UTC; hiển thị kiểu Việt Nam dd/MM/yyyy (kèm giờ nếu có). */
function fmtDate(d: Date): string {
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
  const hasTime = d.getUTCHours() || d.getUTCMinutes()
  return hasTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date
}

/** Số có định dạng nghìn/phần trăm trong Excel → hiển thị giống trong bảng tính (kiểu vi-VN). */
function fmtNumber(n: number, numFmt: string | undefined): string {
  const fmt = (numFmt ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '').split(';')[0]
  const decimals = (fmt.match(/\.(0+)/)?.[1] ?? '').length
  if (fmt.includes('%')) return (n * 100).toLocaleString('vi-VN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%'
  if (/#,#|0,0/.test(fmt)) return n.toLocaleString('vi-VN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  if (decimals) return n.toFixed(decimals)
  // tránh nhiễu dấu phẩy động kiểu 0.30000000000000004; số điện thoại/mã dài giữ nguyên
  return String(Number.isInteger(n) ? n : Number(n.toPrecision(15)))
}

function cellText(value: unknown, numFmt?: string): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return fmtNumber(value, numFmt)
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : fmtDate(value)
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if ('result' in v) return cellText(v.result, numFmt) // ô công thức
    if (Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((t) => t.text).join('').trim()
    if ('text' in v) return cellText(v.text, numFmt) // ô có liên kết
    if ('error' in v) return ''
    if ('formula' in v || 'sharedFormula' in v) return ''
  }
  return String(value).trim()
}

/** Dòng đầu tiên có dữ liệu là tiêu đề cột; dòng trống bị bỏ qua. */
function shape(grid: { n: number; cells: string[] }[], file: string, sheets: string[], sheet: string): MergeData {
  const nonEmpty = grid.filter((r) => r.cells.some((c) => c !== ''))
  if (!nonEmpty.length) throw new Error('Trang tính này không có dữ liệu.')
  const width = Math.max(...nonEmpty.map((r) => r.cells.length))
  const seen = new Map<string, number>()
  const columns = Array.from({ length: width }, (_, i) => {
    const base = (nonEmpty[0].cells[i] ?? '').replace(/\s+/g, ' ').trim() || `Cột ${i + 1}`
    const k = base.toLowerCase()
    const count = (seen.get(k) ?? 0) + 1
    seen.set(k, count)
    return count > 1 ? `${base} (${count})` : base
  })
  const body = nonEmpty.slice(1)
  if (!body.length) throw new Error('Tệp chỉ có dòng tiêu đề, chưa có dòng dữ liệu nào.')
  const kept = body.slice(0, MERGE_MAX_ROWS)
  return {
    file,
    baseDir: path.dirname(file),
    sheets,
    sheet,
    columns,
    rows: kept.map((r) => Array.from({ length: width }, (_, i) => r.cells[i] ?? '')),
    rowNumbers: kept.map((r) => r.n),
    truncated: body.length > kept.length
  }
}

/** Phân tích CSV: tự nhận dấu phân cách (, ; tab), hỗ trợ ô có ngoặc kép và xuống dòng trong ô. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '')
  const head = text.slice(0, 5000).split(/\r?\n/)[0] ?? ''
  const count = (ch: string): number => head.split(ch).length - 1
  const delim = [';', '\t', ','].reduce((a, b) => (count(b) > count(a) ? b : a), ',')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delim) {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell.trim())
    rows.push(row)
  }
  return rows
}

export async function readMergeFile(file: string, sheetName?: string): Promise<MergeData> {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv') {
    const buf = await fs.readFile(file)
    // Excel ở Việt Nam hay lưu CSV dạng UTF-16 hoặc Windows-1258; ưu tiên UTF-8, nhận UTF-16 qua BOM
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')
    const grid = parseCsv(text).map((cells, i) => ({ n: i + 1, cells }))
    return shape(grid, file, [], '')
  }
  if (ext === '.xls') throw new Error('Tệp .xls (Excel 97-2003) chưa được hỗ trợ. Hãy mở bằng Excel và lưu lại dạng .xlsx.')
  if (ext !== '.xlsx' && ext !== '.xlsm') throw new Error('Chỉ hỗ trợ tệp .xlsx, .xlsm hoặc .csv.')

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(file)
  } catch (e: any) {
    throw new Error(`Không đọc được tệp Excel (tệp hỏng, đang đặt mật khẩu, hoặc không phải .xlsx thật): ${e?.message ?? e}`)
  }
  const visible = wb.worksheets.filter((w) => w.state === 'visible' || !w.state)
  const sheets = (visible.length ? visible : wb.worksheets).map((w) => w.name)
  if (!sheets.length) throw new Error('Tệp Excel không có trang tính nào.')
  const ws = wb.getWorksheet(sheetName && sheets.includes(sheetName) ? sheetName : sheets[0])!
  const grid: { n: number; cells: string[] }[] = []
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellText(cell.value, cell.numFmt)
    })
    grid.push({ n, cells: Array.from(cells, (c) => c ?? '') })
  })
  return shape(grid, file, sheets, ws.name)
}
