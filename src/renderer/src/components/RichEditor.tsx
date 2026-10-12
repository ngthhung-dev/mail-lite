import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, Highlighter, Image as ImageIcon, IndentDecrease, IndentIncrease,
  Italic, Link, List, ListOrdered, Minus, Redo2, RemoveFormatting, Strikethrough, Subscript, Superscript, Table, Underline, Undo2, Unlink
} from 'lucide-react'

export interface RichEditorHandle {
  getHtml(): string
  focus(atStart?: boolean): void
  /** chèn chữ thuần tại vị trí con trỏ (dùng cho trường trộn thư) */
  insertText(text: string): void
  appendHtml(html: string): void
}

const FONTS = ['Segoe UI', 'Arial', 'Calibri', 'Tahoma', 'Verdana', 'Times New Roman', 'Georgia', 'Courier New']
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]
const BLOCKS: [string, string][] = [
  ['p', 'Đoạn văn'],
  ['h1', 'Tiêu đề 1'],
  ['h2', 'Tiêu đề 2'],
  ['h3', 'Tiêu đề 3'],
  ['blockquote', 'Trích dẫn'],
  ['pre', 'Chữ đều (mã)']
]
const TEXT_COLORS = [
  '#000000', '#434343', '#7f7f7f', '#bfbfbf', '#ffffff', '#c00000', '#ff0000', '#ed7d31', '#ffc000', '#ffff00',
  '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0', '#c239b3', '#843c0c', '#0f6cbd', '#107c10'
]
const HILITE_COLORS = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#ffc000', '#ff9999', '#b4c7e7', '#c5e0b4', '#d9d9d9', '#ffffff']
const MAX_IMAGE = 8 * 1024 * 1024

interface State {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  sub: boolean
  sup: boolean
  ul: boolean
  ol: boolean
  align: 'left' | 'center' | 'right' | 'justify'
  font: string
  size: number
  block: string
  inTable: boolean
  inLink: boolean
}
const INITIAL: State = {
  bold: false, italic: false, underline: false, strike: false, sub: false, sup: false, ul: false, ol: false,
  align: 'left', font: '', size: 11, block: 'p', inTable: false, inLink: false
}

function B(p: { title: string; on?: boolean; onDo: () => void; children: ReactNode; disabled?: boolean; wide?: boolean }) {
  return (
    <button
        type="button"
        title={p.title}
        aria-label={p.title}
        aria-pressed={p.on}
        disabled={p.disabled}
        className={`${p.on ? 'on' : ''} ${p.wide ? 'wide' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault()
          p.onDo()
        }}
      >
        {p.children}
      </button>
  )
}

function Popover(props: { onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) props.onClose()
    }
    window.addEventListener('mousedown', down, true)
    return () => window.removeEventListener('mousedown', down, true)
  })
  return (
    <div
      ref={ref}
      className={`pop ${props.className ?? ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          props.onClose()
        }
      }}
    >
      {props.children}
    </div>
  )
}

export function RichEditor(props: {
  ref?: Ref<RichEditorHandle>
  initialHtml: string
  onChange?: (html: string) => void
  onFocus?: () => void
  onError?: (message: string) => void
  className?: string
  ariaLabel: string
  /** đặt con trỏ ở đầu nội dung khi mở (trả lời/chuyển tiếp) */
  focusAtStart?: boolean
}) {
  const el = useRef<HTMLDivElement>(null)
  const saved = useRef<Range | null>(null)
  const pendingSize = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [st, setSt] = useState<State>(INITIAL)
  const [pop, setPop] = useState<null | 'color' | 'hilite' | 'link' | 'table'>(null)
  const [url, setUrl] = useState('https://')
  const [grid, setGrid] = useState({ r: 0, c: 0 })
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const onChange = useRef(props.onChange)
  onChange.current = props.onChange

  const changed = useCallback(() => {
    if (el.current) onChange.current?.(cleanEditorHtml(el.current.innerHTML))
  }, [])

  const inside = (n: Node | null): boolean => !!n && !!el.current && el.current.contains(n)
  const anchorEl = (): HTMLElement | null => {
    const s = window.getSelection()
    const n = s?.anchorNode ?? null
    if (!inside(n)) return null
    return n!.nodeType === 1 ? (n as HTMLElement) : n!.parentElement
  }

  /** Ghi nhớ vùng chọn ngay lúc này (sự kiện selectionchange đến trễ hơn phím gõ). */
  const capture = (): void => {
    const s = window.getSelection()
    if (s && s.rangeCount && inside(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange()
  }

  /** Lấy lại vùng chọn trong khung soạn (ô chọn phông/cỡ chữ làm mất tiêu điểm). */
  const restore = (): void => {
    const e = el.current
    if (!e) return
    const s = window.getSelection()
    if (inside(s?.anchorNode ?? null)) return
    e.focus()
    if (saved.current && s) {
      s.removeAllRanges()
      s.addRange(saved.current)
    }
  }

  /** Cỡ chữ: execCommand chỉ hỗ trợ 7 mức → dùng mức 7 làm dấu rồi đổi thành cỡ pt thật. */
  const fixSizes = (): void => {
    const pt = pendingSize.current
    if (!pt || !el.current) return
    el.current.querySelectorAll('font[size="7"]').forEach((f) => {
      f.removeAttribute('size')
      ;(f as HTMLElement).style.fontSize = `${pt}pt`
    })
    // chọn cỡ rồi chọn tiếp màu/phông trước khi gõ: trình duyệt ghi mức 7 thành CSS "xxx-large" thay vì <font size=7>
    el.current.querySelectorAll<HTMLElement>('[style*="xxx-large"]').forEach((f) => {
      f.style.fontSize = `${pt}pt`
    })
  }

  const refresh = useCallback(() => {
    const a = anchorEl()
    if (!a) return
    const s = window.getSelection()
    if (s && s.rangeCount) saved.current = s.getRangeAt(0).cloneRange()
    const q = (c: string): boolean => {
      try {
        return document.queryCommandState(c)
      } catch {
        return false
      }
    }
    const cs = getComputedStyle(a)
    const block = (a.closest('h1,h2,h3,blockquote,pre') as HTMLElement | null)?.tagName.toLowerCase() ?? 'p'
    setSt({
      bold: q('bold'),
      italic: q('italic'),
      underline: q('underline'),
      strike: q('strikeThrough'),
      sub: q('subscript'),
      sup: q('superscript'),
      ul: q('insertUnorderedList'),
      ol: q('insertOrderedList'),
      align: q('justifyCenter') ? 'center' : q('justifyRight') ? 'right' : q('justifyFull') ? 'justify' : 'left',
      font: (cs.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim(),
      size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2,
      block: inside(a.closest('h1,h2,h3,blockquote,pre')) ? block : 'p',
      inTable: inside(a.closest('td,th')),
      inLink: inside(a.closest('a'))
    })
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', refresh)
    return () => document.removeEventListener('selectionchange', refresh)
  }, [refresh])

  // Nội dung ban đầu chỉ nạp một lần — sau đó khung soạn tự quản lý DOM của nó
  useEffect(() => {
    const e = el.current
    if (!e) return
    e.innerHTML = props.initialHtml
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p')
    } catch {
      /* trình duyệt cũ */
    }
    if (props.focusAtStart) {
      e.focus()
      const r = document.createRange()
      r.setStart(e, 0)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exec = (cmd: string, value?: string, css = true): void => {
    restore()
    try {
      document.execCommand('styleWithCSS', false, css ? 'true' : 'false')
      document.execCommand(cmd, false, value)
    } catch {
      /* lệnh không hỗ trợ */
    }
    refresh()
    changed()
  }

  const setSize = (pt: number): void => {
    pendingSize.current = pt
    exec('fontSize', '7', false)
    fixSizes()
    changed()
  }

  const insertHtml = (html: string): void => exec('insertHTML', html)

  useImperativeHandle(props.ref, () => ({
    getHtml: () => cleanEditorHtml(el.current?.innerHTML ?? ''),
    focus(atStart) {
      const e = el.current
      if (!e) return
      e.focus()
      if (atStart) {
        const r = document.createRange()
        r.setStart(e, 0)
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
      }
    },
    insertText(text) {
      const e = el.current
      if (!e) return
      if (!saved.current && !inside(window.getSelection()?.anchorNode ?? null)) {
        e.focus()
        const r = document.createRange()
        r.selectNodeContents(e)
        r.collapse(false)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
      }
      exec('insertText', text)
    },
    appendHtml(html) {
      if (!el.current) return
      el.current.insertAdjacentHTML('beforeend', html)
      changed()
    }
  }))

  // ---------- Liên kết ----------
  const openLink = (): void => {
    capture()
    const a = anchorEl()?.closest('a')
    setUrl(a && inside(a) ? (a.getAttribute('href') ?? 'https://') : 'https://')
    setPop('link')
  }
  const applyLink = (): void => {
    let u = url.trim()
    if (!u || u === 'https://') return setPop(null)
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u)) u = `mailto:${u}`
    else if (!/^(https?:|mailto:|tel:)/i.test(u)) u = `https://${u}`
    if (!/^(https?:|mailto:|tel:)/i.test(u)) return props.onError?.('Liên kết phải bắt đầu bằng http://, https:// hoặc là địa chỉ email.')
    setPop(null)
    restore()
    const s = window.getSelection()
    if (s && s.isCollapsed && !anchorEl()?.closest('a')) {
      // dấu cách thường ở cuối dòng sẽ bị nuốt khi chèn thẻ liền sau → đổi thành dấu cách cứng
      const r = s.getRangeAt(0)
      const n = r.startContainer
      if (n.nodeType === 3 && r.startOffset > 0 && (n as Text).data[r.startOffset - 1] === ' ') {
        ;(n as Text).replaceData(r.startOffset - 1, 1, '\u00a0')
      }
      const shown = u.replace(/^mailto:/, '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      insertHtml(`<a href="${u.replace(/"/g, '&quot;')}">${shown}</a>&nbsp;`)
    } else exec('createLink', u)
  }

  // ---------- Ảnh ----------
  const pickImage = (file: File | undefined): void => {
    if (!file) return
    if (!file.type.startsWith('image/')) return props.onError?.('Tệp này không phải hình ảnh.')
    if (file.size > MAX_IMAGE) return props.onError?.('Ảnh lớn hơn 8 MB — hãy thu nhỏ hoặc gửi dạng tệp đính kèm.')
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const probe = new window.Image()
      probe.onload = () => {
        // ảnh quá rộng thì thu về 600px để vừa khung đọc thư của người nhận
        const w = Math.min(probe.naturalWidth, 600)
        insertHtml(`<img src="${src}" width="${w}" alt="${file.name.replace(/"/g, '')}" style="max-width:100%;height:auto">`)
      }
      probe.onerror = () => props.onError?.('Không đọc được hình ảnh này.')
      probe.src = src
    }
    reader.readAsDataURL(file)
  }
  const sizeImage = (w: number | null): void => {
    if (!img) return
    if (w) img.setAttribute('width', String(Math.min(w, img.naturalWidth || w)))
    else img.removeAttribute('width')
    img.style.maxWidth = '100%'
    img.style.height = 'auto'
    changed()
  }

  // ---------- Bảng ----------
  const insertTable = (rows: number, cols: number): void => {
    setPop(null)
    const row = `<tr>${'<td><br></td>'.repeat(cols)}</tr>`
    // data-ml-table đánh dấu bảng do người dùng tạo; viền được gắn inline lúc lấy nội dung (xem cleanEditorHtml)
    insertHtml(`<table data-ml-table="1"><tbody>${row.repeat(rows)}</tbody></table><p><br></p>`)
  }
  const cellAt = (): HTMLTableCellElement | null => {
    const c = anchorEl()?.closest('td,th') as HTMLTableCellElement | null
    return c && inside(c) ? c : null
  }
  const caretIn = (node: Node): void => {
    const r = document.createRange()
    r.selectNodeContents(node)
    r.collapse(true)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
  }
  const blank = (from: HTMLTableCellElement): HTMLTableCellElement => {
    const c = from.cloneNode(false) as HTMLTableCellElement
    c.removeAttribute('colspan')
    c.removeAttribute('rowspan')
    c.innerHTML = '<br>'
    return c
  }
  const tableOp = (op: 'row' | 'col' | 'delRow' | 'delCol' | 'delTable'): void => {
    restore()
    const cell = cellAt()
    const row = cell?.parentElement as HTMLTableRowElement | null
    const table = cell?.closest('table')
    if (!cell || !row || !table) return
    const idx = cell.cellIndex
    if (op === 'row') {
      const tr = row.cloneNode(false) as HTMLTableRowElement
      for (const c of Array.from(row.cells)) tr.appendChild(blank(c))
      row.after(tr)
      caretIn(tr.cells[Math.min(idx, tr.cells.length - 1)])
    } else if (op === 'col') {
      for (const r of Array.from(table.rows)) {
        const ref = r.cells[Math.min(idx, r.cells.length - 1)]
        if (ref) ref.after(blank(ref))
      }
      caretIn(row.cells[idx + 1])
    } else if (op === 'delRow') {
      const next = (row.nextElementSibling ?? row.previousElementSibling) as HTMLTableRowElement | null
      row.remove()
      if (next) caretIn(next.cells[Math.min(idx, next.cells.length - 1)])
      else table.remove()
    } else if (op === 'delCol') {
      if (row.cells.length <= 1) table.remove()
      else {
        for (const r of Array.from(table.rows)) r.cells[Math.min(idx, r.cells.length - 1)]?.remove()
        caretIn(row.cells[Math.max(0, idx - 1)])
      }
    } else table.remove()
    refresh()
    changed()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      openLink()
      return
    }
    if (e.key !== 'Tab' || mod || e.altKey) return
    const cell = cellAt()
    if (cell) {
      // Tab trong bảng: sang ô kế; ở ô cuối thì thêm dòng mới như Word/Outlook
      e.preventDefault()
      const cells = Array.from(cell.closest('table')!.querySelectorAll('td,th')) as HTMLTableCellElement[]
      const i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1)
      if (i >= cells.length) tableOp('row')
      else if (i >= 0) caretIn(cells[i])
      return
    }
    e.preventDefault()
    if (anchorEl()?.closest('li')) exec(e.shiftKey ? 'outdent' : 'indent')
    else if (!e.shiftKey) exec('insertHTML', '&nbsp;&nbsp;&nbsp;&nbsp;')
  }

  const fontShown = FONTS.find((f) => f.toLowerCase() === st.font.toLowerCase()) ?? ''
  const sizes = SIZES.includes(st.size) ? SIZES : [...SIZES, st.size].sort((a, b) => a - b)

  return (
    <div className={`rich ${props.className ?? ''}`}>
      <div className="toolbar fmt" role="toolbar" aria-label="Định dạng" onMouseDownCapture={capture}>
        <B title="Hoàn tác (Ctrl+Z)" onDo={() => exec('undo')}><Undo2 size={16} /></B>
        <B title="Làm lại (Ctrl+Y)" onDo={() => exec('redo')}><Redo2 size={16} /></B>
        <span className="sep" />
        <select title="Phông chữ" aria-label="Phông chữ" className="font" value={fontShown} onChange={(e) => e.target.value && exec('fontName', e.target.value)}>
          <option value="">Phông chữ</option>
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
          ))}
        </select>
        <select title="Cỡ chữ" aria-label="Cỡ chữ" className="size" value={st.size} onChange={(e) => setSize(Number(e.target.value))}>
          {sizes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select title="Kiểu đoạn" aria-label="Kiểu đoạn" className="block" value={st.block} onChange={(e) => exec('formatBlock', `<${e.target.value}>`)}>
          {BLOCKS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <span className="sep" />
        <B title="Đậm (Ctrl+B)" on={st.bold} onDo={() => exec('bold')}><Bold size={16} /></B>
        <B title="Nghiêng (Ctrl+I)" on={st.italic} onDo={() => exec('italic')}><Italic size={16} /></B>
        <B title="Gạch chân (Ctrl+U)" on={st.underline} onDo={() => exec('underline')}><Underline size={16} /></B>
        <B title="Gạch ngang" on={st.strike} onDo={() => exec('strikeThrough')}><Strikethrough size={16} /></B>
        <B title="Chỉ số dưới" on={st.sub} onDo={() => exec('subscript')}><Subscript size={16} /></B>
        <B title="Chỉ số trên" on={st.sup} onDo={() => exec('superscript')}><Superscript size={16} /></B>
        <span className="anchor">
          <B title="Màu chữ" onDo={() => setPop(pop === 'color' ? null : 'color')}><Baseline size={16} /></B>
          {pop === 'color' && (
            <Popover onClose={() => setPop(null)} className="palette">
              {TEXT_COLORS.map((c) => (
                <button key={c} type="button" title={c} aria-label={`Màu ${c}`} style={{ background: c }} onMouseDown={(e) => (e.preventDefault(), setPop(null), exec('foreColor', c))} />
              ))}
              <button type="button" className="auto" onMouseDown={(e) => (e.preventDefault(), setPop(null), exec('foreColor', '#201f1e'))}>Tự động</button>
            </Popover>
          )}
        </span>
        <span className="anchor">
          <B title="Tô sáng (màu nền chữ)" onDo={() => setPop(pop === 'hilite' ? null : 'hilite')}><Highlighter size={16} /></B>
          {pop === 'hilite' && (
            <Popover onClose={() => setPop(null)} className="palette">
              {HILITE_COLORS.map((c) => (
                <button key={c} type="button" title={c} aria-label={`Tô ${c}`} style={{ background: c }} onMouseDown={(e) => (e.preventDefault(), setPop(null), exec('hiliteColor', c))} />
              ))}
              <button type="button" className="auto" onMouseDown={(e) => (e.preventDefault(), setPop(null), exec('hiliteColor', 'transparent'))}>Không tô</button>
            </Popover>
          )}
        </span>
        <span className="sep" />
        <B title="Danh sách chấm" on={st.ul} onDo={() => exec('insertUnorderedList')}><List size={16} /></B>
        <B title="Danh sách số" on={st.ol} onDo={() => exec('insertOrderedList')}><ListOrdered size={16} /></B>
        <B title="Giảm thụt lề" onDo={() => exec('outdent')}><IndentDecrease size={16} /></B>
        <B title="Tăng thụt lề" onDo={() => exec('indent')}><IndentIncrease size={16} /></B>
        <span className="sep" />
        <B title="Căn trái" on={st.align === 'left'} onDo={() => exec('justifyLeft')}><AlignLeft size={16} /></B>
        <B title="Căn giữa" on={st.align === 'center'} onDo={() => exec('justifyCenter')}><AlignCenter size={16} /></B>
        <B title="Căn phải" on={st.align === 'right'} onDo={() => exec('justifyRight')}><AlignRight size={16} /></B>
        <B title="Căn đều hai bên" on={st.align === 'justify'} onDo={() => exec('justifyFull')}><AlignJustify size={16} /></B>
        <span className="sep" />
        <span className="anchor">
          <B title="Chèn / sửa liên kết (Ctrl+K)" on={st.inLink} onDo={openLink}><Link size={16} /></B>
          {pop === 'link' && (
            <Popover onClose={() => setPop(null)} className="linkpop">
              <input
                autoFocus
                value={url}
                aria-label="Địa chỉ liên kết"
                placeholder="https://… hoặc địa chỉ email"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    applyLink()
                  }
                }}
              />
              <button type="button" className="btn primary" onClick={applyLink}>Chèn</button>
            </Popover>
          )}
        </span>
        <B title="Gỡ liên kết" disabled={!st.inLink} onDo={() => exec('unlink')}><Unlink size={16} /></B>
        <B title="Chèn hình ảnh vào nội dung" onDo={() => fileInput.current?.click()}><ImageIcon size={16} /></B>
        <span className="anchor">
          <B title="Chèn bảng" onDo={() => setPop(pop === 'table' ? null : 'table')}><Table size={16} /></B>
          {pop === 'table' && (
            <Popover onClose={() => setPop(null)} className="tablepop">
              <div className="tgrid" onMouseLeave={() => setGrid({ r: 0, c: 0 })}>
                {Array.from({ length: 8 }, (_, r) =>
                  Array.from({ length: 8 }, (_, c) => (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      aria-label={`Bảng ${r + 1} dòng × ${c + 1} cột`}
                      className={r < grid.r && c < grid.c ? 'on' : ''}
                      onMouseEnter={() => setGrid({ r: r + 1, c: c + 1 })}
                      onMouseDown={(e) => (e.preventDefault(), insertTable(r + 1, c + 1))}
                    />
                  ))
                )}
              </div>
              <div className="muted small">{grid.r ? `${grid.r} dòng × ${grid.c} cột` : 'Rê chuột để chọn kích thước'}</div>
            </Popover>
          )}
        </span>
        <B title="Đường kẻ ngang" onDo={() => exec('insertHorizontalRule')}><Minus size={16} /></B>
        <B title="Xoá định dạng" onDo={() => (exec('removeFormat'), exec('formatBlock', '<p>'))}><RemoveFormatting size={16} /></B>
        {st.inTable && (
          <span className="ctx" aria-label="Công cụ bảng">
            <span className="sep" />
            <B wide title="Thêm dòng bên dưới" onDo={() => tableOp('row')}>+ Dòng</B>
            <B wide title="Thêm cột bên phải" onDo={() => tableOp('col')}>+ Cột</B>
            <B wide title="Xoá dòng hiện tại" onDo={() => tableOp('delRow')}>− Dòng</B>
            <B wide title="Xoá cột hiện tại" onDo={() => tableOp('delCol')}>− Cột</B>
            <B wide title="Xoá cả bảng" onDo={() => tableOp('delTable')}>Xoá bảng</B>
          </span>
        )}
        {img && (
          <span className="ctx" aria-label="Công cụ ảnh">
            <span className="sep" />
            <span className="muted small">Ảnh:</span>
            <B wide title="Rộng 200px" onDo={() => sizeImage(200)}>Nhỏ</B>
            <B wide title="Rộng 400px" onDo={() => sizeImage(400)}>Vừa</B>
            <B wide title="Rộng 600px" onDo={() => sizeImage(600)}>Lớn</B>
            <B wide title="Kích thước gốc" onDo={() => sizeImage(null)}>Gốc</B>
          </span>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            pickImage(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <div
        ref={el}
        className="editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={props.ariaLabel}
        aria-multiline="true"
        onFocus={props.onFocus}
        onKeyDown={onKeyDown}
        onInput={() => {
          fixSizes()
          changed()
        }}
        onClick={(e) => {
          const t = e.target as HTMLElement
          el.current?.querySelectorAll('img.picked').forEach((i) => i.classList.remove('picked'))
          if (t.tagName === 'IMG') {
            t.classList.add('picked')
            setImg(t as HTMLImageElement)
          } else setImg(null)
        }}
      />
    </div>
  )
}

const CELL_STYLE = 'border:1px solid #a6a6a6;padding:4px 8px;min-width:48px;vertical-align:top'

/**
 * Chuẩn bị nội dung để gửi/lưu:
 * - bỏ dấu đánh chọn ảnh (chỉ dùng trong lúc soạn);
 * - gắn viền inline cho bảng do người dùng tạo, vì trình đọc thư của người nhận không có CSS của khung soạn
 *   (bảng trong thư gốc được trích dẫn thì giữ nguyên).
 */
export function cleanEditorHtml(html: string): string {
  if (!/picked|data-ml-table/.test(html)) return html
  const t = document.createElement('template')
  t.innerHTML = html
  t.content.querySelectorAll('img.picked').forEach((i) => {
    i.classList.remove('picked')
    if (!i.getAttribute('class')) i.removeAttribute('class')
  })
  t.content.querySelectorAll('table[data-ml-table]').forEach((tb) => {
    tb.setAttribute('style', 'border-collapse:collapse;margin:6px 0')
    tb.setAttribute('cellspacing', '0')
    tb.querySelectorAll('td,th').forEach((c) => {
      if (c.closest('table') === tb) c.setAttribute('style', CELL_STYLE)
    })
  })
  return t.innerHTML
}
