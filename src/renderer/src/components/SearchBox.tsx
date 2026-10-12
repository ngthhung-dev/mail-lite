import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import type { AdvancedSearch, ListQuery, SearchScope } from '../../../shared/types.ts'
import { SCOPE_LABEL, advCount } from '../../../shared/types.ts'

const pad = (n: number): string => String(n).padStart(2, '0')
const toInput = (ts?: number): string => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** yyyy-mm-dd (giờ địa phương) → mốc đầu ngày hoặc cuối ngày */
const fromInput = (v: string, end: boolean): number | undefined => {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (end) d.setHours(23, 59, 59, 999)
  return d.getTime()
}

interface Form extends AdvancedSearch {
  words: string
}

/**
 * Ô tìm thư nằm ngay trên danh sách thư + bảng lọc nâng cao (người gửi, người nhận, chủ đề, ngày, kích thước…).
 * Gõ vào ô là tìm ngay; bảng nâng cao chỉ áp dụng khi bấm "Tìm kiếm".
 */
export function SearchBox(props: {
  inputRef: RefObject<HTMLInputElement | null>
  search: string
  adv: AdvancedSearch
  /** tên thư mục đang mở, để ghi rõ phạm vi "Thư mục hiện tại" */
  folderName: string
  /** thẻ lọc nhanh đang chọn — tìm nhanh chỉ tìm trong nhóm thư đó */
  filter: NonNullable<ListQuery['filter']>
  onSearch: (s: string) => void
  onApply: (search: string, adv: AdvancedSearch) => void
  onFocusChange: (focused: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<Form>({ words: '' })
  const box = useRef<HTMLDivElement>(null)
  const n = advCount(props.adv)
  const scoped = !!props.adv.scope && props.adv.scope !== 'folder'
  const active = n > 0 || scoped
  const hint = { all: 'Tìm thư', unread: 'Tìm trong thư chưa đọc', flagged: 'Tìm trong thư có cờ', attachments: 'Tìm trong thư có tệp' }[props.filter]

  const openPanel = (): void => {
    setF({ ...props.adv, words: props.search })
    setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', down, true)
    return () => window.removeEventListener('mousedown', down, true)
  }, [open])

  // đóng bảng nâng cao mà con trỏ không nằm trong ô gõ → trả ô tìm về chỗ cũ
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open && document.activeElement !== props.inputRef.current) props.onFocusChange(false)
    wasOpen.current = open
  }, [open, props])

  const set = (p: Partial<Form>): void => setF((x) => ({ ...x, ...p }))
  const apply = (): void => {
    const { words, ...adv } = f
    // bỏ các ô trống để bộ đếm điều kiện chính xác
    for (const k of ['from', 'to', 'cc', 'subject', 'without'] as const) if (!adv[k]?.trim()) delete adv[k]
    if (adv.scope === 'folder') delete adv.scope
    if (!adv.sizeMb || adv.sizeMb <= 0) {
      delete adv.sizeMb
      delete adv.sizeOp
    }
    if (adv.dateFrom && adv.dateTo && adv.dateFrom > adv.dateTo) [adv.dateFrom, adv.dateTo] = [fromInput(toInput(adv.dateTo), false), fromInput(toInput(adv.dateFrom), true)]
    props.onApply(words.trim(), adv)
    setOpen(false)
  }
  const clear = (): void => {
    props.onApply('', {})
    setF({ words: '' })
    setOpen(false)
    // nút X biến mất ngay sau khi bấm nên không có sự kiện "rời tiêu điểm" — tự báo để ô tìm thu về chỗ cũ
    props.onFocusChange(false)
  }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault()
      apply()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div
      className="lsearch"
      ref={box}
    >
      <div className={`lsearch-box ${active ? 'active' : ''}`}>
        <Search size={15} />
        <input
          ref={props.inputRef}
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          // Ô tìm giãn ra một hàng riêng khi chính ô gõ được chọn. Không dựa vào tiêu điểm của các nút bên cạnh:
          // nếu bố cục đổi ngay lúc nhấn chuột vào nút thì nút chạy mất khỏi con trỏ và cú nhấp bị hụt.
          onFocus={() => props.onFocusChange(true)}
          onBlur={(e) => {
            if (!box.current?.contains(e.relatedTarget as Node | null)) props.onFocusChange(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (props.search) props.onSearch('')
              else (e.target as HTMLInputElement).blur()
            } else if (e.key === 'ArrowDown' && e.altKey) openPanel()
          }}
          placeholder={scoped ? `Tìm trong: ${SCOPE_LABEL[props.adv.scope!]}` : hint}
          title="Tìm thư (Ctrl+E) — gõ không dấu cũng được"
          aria-label="Tìm thư"
        />
        {(props.search || active) && (
          <button className="icon-btn" onClick={clear} title="Xoá tìm kiếm và bộ lọc">
            <X size={14} />
          </button>
        )}
        <button className={`icon-btn adv-btn ${active ? 'on' : ''}`} onClick={() => (open ? setOpen(false) : openPanel())} title="Tìm kiếm nâng cao" aria-expanded={open}>
          <SlidersHorizontal size={15} />
          {(n > 0 || scoped) && <span className="badge">{n + (scoped ? 1 : 0)}</span>}
        </button>
      </div>

      {open && (
        // Hộp thoại nằm giữa cửa sổ ứng dụng (tự co và cuộn khi cửa sổ nhỏ); bấm ra vùng mờ để đóng
        <div className="adv-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
        <div className="adv-panel" role="dialog" aria-label="Tìm kiếm nâng cao" onKeyDown={onKey}>
          <div className="adv-head">
            <span>Tìm kiếm nâng cao</span>
            <button className="icon-btn" onClick={() => setOpen(false)} title="Đóng (Esc)">
              <X size={16} />
            </button>
          </div>
          <label className="arow">
            <span>Tìm trong</span>
            <select value={f.scope ?? 'folder'} onChange={(e) => set({ scope: e.target.value as SearchScope })}>
              <option value="folder">Thư mục hiện tại — {props.folderName}</option>
              <optgroup label="Mọi tài khoản">
                {(['all', 'inbox', 'flagged', 'sent', 'drafts', 'junk', 'trash'] as const).map((k) => (
                  <option key={k} value={k}>{SCOPE_LABEL[k]}{k === 'all' ? ' (trừ Thư rác, Thùng rác)' : ''}</option>
                ))}
              </optgroup>
              <optgroup label="Mở rộng">
                <option value="everything">{SCOPE_LABEL.everything}</option>
              </optgroup>
              <optgroup label="Theo trạng thái">
                <option value="read">{SCOPE_LABEL.read}</option>
                <option value="unread">{SCOPE_LABEL.unread}</option>
              </optgroup>
            </select>
          </label>
          <label className="arow">
            <span>Người gửi</span>
            <input autoFocus value={f.from ?? ''} onChange={(e) => set({ from: e.target.value })} placeholder="tên hoặc địa chỉ email" />
          </label>
          <label className="arow">
            <span>Đến</span>
            <input value={f.to ?? ''} onChange={(e) => set({ to: e.target.value })} />
          </label>
          <label className="arow">
            <span>Cc</span>
            <input value={f.cc ?? ''} onChange={(e) => set({ cc: e.target.value })} />
          </label>
          <label className="arow">
            <span>Chủ đề</span>
            <input value={f.subject ?? ''} onChange={(e) => set({ subject: e.target.value })} />
          </label>
          <label className="arow">
            <span>Có các từ</span>
            <input value={f.words} onChange={(e) => set({ words: e.target.value })} placeholder="tìm trong chủ đề, người gửi/nhận và nội dung" />
          </label>
          <label className="arow">
            <span>Không có</span>
            <input value={f.without ?? ''} onChange={(e) => set({ without: e.target.value })} placeholder="loại thư chứa các từ này" />
          </label>
          <div className="arow">
            <span>Ngày</span>
            <div className="apair">
              <input type="date" aria-label="Từ ngày" value={toInput(f.dateFrom)} onChange={(e) => set({ dateFrom: fromInput(e.target.value, false) })} />
              <span className="muted">đến</span>
              <input type="date" aria-label="Đến ngày" value={toInput(f.dateTo)} onChange={(e) => set({ dateTo: fromInput(e.target.value, true) })} />
            </div>
          </div>
          <div className="arow">
            <span>Kích thước</span>
            <div className="apair">
              <select aria-label="So sánh kích thước" value={f.sizeOp ?? 'gt'} onChange={(e) => set({ sizeOp: e.target.value as 'gt' | 'lt' })}>
                <option value="gt">lớn hơn</option>
                <option value="lt">nhỏ hơn</option>
              </select>
              <input
                type="number"
                min={0}
                step={0.5}
                aria-label="Kích thước (MB)"
                value={f.sizeMb ?? ''}
                onChange={(e) => set({ sizeMb: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
              <span className="muted">MB</span>
            </div>
          </div>
          <label className="arow">
            <span>Trạng thái đọc</span>
            <select value={f.read ?? ''} onChange={(e) => set({ read: (e.target.value || undefined) as Form['read'] })}>
              <option value="">Tất cả</option>
              <option value="unread">Chưa đọc</option>
              <option value="read">Đã đọc</option>
            </select>
          </label>
          <div className="arow">
            <span />
            <div className="apair checks">
              <label className="check">
                <input type="checkbox" checked={!!f.hasAttachment} onChange={(e) => set({ hasAttachment: e.target.checked || undefined })} /> Có tệp đính kèm
              </label>
              <label className="check">
                <input type="checkbox" checked={!!f.flagged} onChange={(e) => set({ flagged: e.target.checked || undefined })} /> Đã gắn cờ
              </label>
            </div>
          </div>
          <div className="adv-foot">
            <span className="muted small">Gõ không dấu vẫn khớp chữ có dấu.</span>
            <span className="grow" />
            <button className="btn" onClick={clear}>
              Xoá bộ lọc
            </button>
            <button className="btn primary" onClick={apply}>
              Tìm kiếm
            </button>
          </div>
        </div>
        </div>
      )}
    </div>
  )
}
