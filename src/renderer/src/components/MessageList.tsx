import { Fragment, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ChevronDown, ChevronRight, CornerUpLeft, Flag, Mail, MailOpen, MailPlus, Paperclip, Pin } from 'lucide-react'
import type { Account, AdvancedSearch, AppSettings, ListQuery, MessageSummary } from '../../../shared/types.ts'
import { SearchBox } from './SearchBox.tsx'
import { displayName, fmtListDate, groupLabel } from '../util.ts'
import { DRAG_TYPE } from './FolderPane.tsx'

/** Một dòng trong danh sách: thư lẻ, dòng đại diện cuộc hội thoại, hoặc thư con khi hội thoại được mở ra. */
export interface ListRow {
  m: MessageSummary
  kind: 'single' | 'head' | 'child'
  /** mã cuộc hội thoại (tài khoản + khoá), rỗng với thư lẻ */
  tid: string
  /** số thư trong cuộc hội thoại */
  count: number
  open: boolean
  /** hội thoại còn thư chưa đọc (trong các thư đang hiện ở danh sách) */
  unread: boolean
}

export function MessageList(props: {
  title: string
  rows: ListRow[]
  /** thư mục đang mở — thư con nằm ở thư mục khác (vd. Thư đã gửi) sẽ được ghi chú */
  currentFolderId?: number
  folderLabelOf: (folderId: number) => string
  onToggleThread: (row: ListRow) => void
  onToggleRead: (m: MessageSummary) => void
  onTogglePin: (m: MessageSummary) => void
  accounts: Account[]
  settings: AppSettings
  showAccount: boolean
  sentView: boolean
  selected: Set<number>
  activeId: number | null
  filter: NonNullable<ListQuery['filter']>
  onFilter: (f: NonNullable<ListQuery['filter']>) => void
  searching: boolean
  search: string
  adv: AdvancedSearch
  folderName: string
  searchRef: RefObject<HTMLInputElement | null>
  onSearch: (s: string) => void
  onApplySearch: (search: string, adv: AdvancedSearch) => void
  empty: boolean
  onSelect: (id: number, mode: 'single' | 'toggle' | 'range') => void
  onOpen: (m: MessageSummary) => void
  onMenu: (m: MessageSummary, x: number, y: number) => void
  onToggleFlag: (m: MessageSummary) => void
  onMore: () => void
  onAddAccount: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [searchFocus, setSearchFocus] = useState(false)
  // ngăn danh sách thường hẹp: khi đang gõ tìm kiếm thì ô tìm xuống một hàng riêng rộng hết ngăn,
  // các thẻ lọc nhanh vẫn hiện phía trên để chọn nhóm thư cần tìm (tất cả / chưa đọc / có cờ / có tệp)
  const wide = searchFocus || !!props.search
  const catColor = (name: string | null): string | undefined => props.settings.categories.find((c) => c.name === name)?.color
  const accColor = (id: number): string => props.accounts.find((a) => a.id === id)?.color ?? '#888'
  let lastGroup = ''

  return (
    <section className="list">
      <div className="list-head">
        <h2 title={props.title}>{props.title}</h2>
        <div className={`list-tools ${wide ? 'wide' : ''}`}>
        <div className="tabs" role="tablist">
          {(
            [
              ['all', 'Tất cả'],
              ['unread', 'Chưa đọc'],
              ['flagged', 'Có cờ'],
              ['attachments', 'Có tệp']
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={props.filter === k} className={props.filter === k ? 'on' : ''} onClick={() => props.onFilter(k)}>
              {label}
            </button>
          ))}
        </div>
          <SearchBox
            inputRef={props.searchRef}
            search={props.search}
            adv={props.adv}
            folderName={props.folderName}
            filter={props.filter}
            onSearch={props.onSearch}
            onApply={props.onApplySearch}
            onFocusChange={setSearchFocus}
          />
        </div>
      </div>
      <div
        className="list-body"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) props.onMore()
        }}
      >
        {props.rows.length === 0 && (
          <div className="list-empty">
            {props.empty ? (
              <>
                <p>Chưa có tài khoản mail nào.</p>
                <button className="btn primary" onClick={props.onAddAccount}>
                  <MailPlus size={16} /> Thêm tài khoản
                </button>
              </>
            ) : props.searching ? (
              <p>Không tìm thấy thư nào khớp.</p>
            ) : props.filter !== 'all' ? (
              <p>Không có thư nào khớp bộ lọc.</p>
            ) : (
              <p>Thư mục này chưa có thư.</p>
            )}
          </div>
        )}
        {props.rows.map((row) => {
          const m = row.m
          const child = row.kind === 'child'
          const g = m.pinned ? 'Đã ghim' : groupLabel(m.date)
          // thư con nằm ngay dưới dòng hội thoại, không tách nhóm ngày riêng
          const head = !child && g !== lastGroup
          if (!child) lastGroup = g
          const sentLike = props.sentView || (child && props.accounts.some((a) => a.id === m.accountId && a.email.toLowerCase() === m.from.address.toLowerCase()))
          const who = sentLike ? (m.to.length ? `Tới: ${m.to.map(displayName).join('; ')}` : '(Chưa có người nhận)') : displayName(m.from)
          const cat = catColor(m.category)
          const unread = row.kind === 'head' ? row.unread : !m.seen
          const elsewhere = child && props.currentFolderId !== undefined && m.folderId !== props.currentFolderId
          const stop = (fn: () => void) => (e: React.MouseEvent) => {
            e.stopPropagation()
            fn()
          }
          return (
            <Fragment key={`${row.kind}-${m.id}`}>
              {head && <div className="group">{g}</div>}
              <div
                data-mid={m.id}
                className={`item ${unread ? 'unread' : ''} ${child ? 'child' : ''} ${props.selected.has(m.id) ? 'sel' : ''} ${props.activeId === m.id ? 'active' : ''}`}
                draggable
                onDragStart={(e) => {
                  const ids = props.selected.has(m.id) ? [...props.selected] : [m.id]
                  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ ids, accountId: m.accountId }))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={(e) => props.onSelect(m.id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single')}
                onDoubleClick={() => props.onOpen(m)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  props.onMenu(m, e.clientX, e.clientY)
                }}
              >
                <span className="bar" style={cat ? { background: cat } : undefined} />
                <div className="item-main">
                  <div className="row1">
                    {row.kind === 'head' && (
                      <button
                        className="thread-toggle"
                        title={row.open ? 'Thu gọn cuộc hội thoại' : `Mở cuộc hội thoại (${row.count} thư)`}
                        aria-expanded={row.open}
                        onClick={stop(() => props.onToggleThread(row))}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        {row.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    )}
                    {props.showAccount && !child && <span className="dot" style={{ background: accColor(m.accountId) }} />}
                    <span className="who">{who}</span>
                    {row.kind === 'head' && <span className="thread-count" title={`${row.count} thư trong cuộc hội thoại`}>{row.count}</span>}
                    {m.answered && <CornerUpLeft size={13} className="mark" aria-label="Đã trả lời" />}
                    {m.hasAttachments && <Paperclip size={13} className="mark clip" aria-label="Có tệp đính kèm" />}
                    <span className="quick" onDoubleClick={(e) => e.stopPropagation()}>
                      <button
                        className="qa"
                        title={m.seen ? 'Đánh dấu chưa đọc' : 'Đánh dấu đã đọc'}
                        aria-label={m.seen ? 'Đánh dấu chưa đọc' : 'Đánh dấu đã đọc'}
                        onClick={stop(() => props.onToggleRead(m))}
                      >
                        {m.seen ? <Mail size={14} /> : <MailOpen size={14} />}
                      </button>
                      <button
                        className={`qa pin ${m.pinned ? 'on' : ''}`}
                        title={m.pinned ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại lên đầu'}
                        aria-label={m.pinned ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại lên đầu'}
                        aria-pressed={m.pinned}
                        onClick={stop(() => props.onTogglePin(m))}
                      >
                        <Pin size={14} fill={m.pinned ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        className={`qa flag ${m.flagged ? 'on' : ''}`}
                        title={m.flagged ? 'Bỏ gắn cờ' : 'Gắn cờ'}
                        aria-label={m.flagged ? 'Bỏ gắn cờ' : 'Gắn cờ'}
                        aria-pressed={m.flagged}
                        onClick={stop(() => props.onToggleFlag(m))}
                      >
                        <Flag size={14} fill={m.flagged ? 'currentColor' : 'none'} />
                      </button>
                    </span>
                  </div>
                  <div className="row2">
                    <span className="subject">
                      {m.draft && <em className="draft">[Nháp] </em>}
                      {elsewhere && <em className="where">{props.folderLabelOf(m.folderId)} · </em>}
                      {m.subject || '(Không có tiêu đề)'}
                    </span>
                    <span className="date">{fmtListDate(m.date)}</span>
                  </div>
                  <div className="row3">{m.snippet || '\u00a0'}</div>
                </div>
              </div>
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
