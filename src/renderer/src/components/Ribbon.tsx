import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Archive, ArrowDownUp, Ban, BookOpen, Info, Keyboard, CheckCheck, Download, FileSpreadsheet, Flag, FolderInput, FolderPen, FolderPlus, FolderX, Forward, Mail,
  MailOpen, MailPlus, MessagesSquare, Moon, Pin, PinOff, PanelBottom, PanelRight, PanelRightClose, RefreshCw, Reply, ReplyAll, Rows3, Rows4,
  Settings, Sun, SunMoon, Tag, Trash2, UserPlus, Wand2, X
} from 'lucide-react'
import type { AppSettings, Folder, ListQuery, MessageSummary } from '../../../shared/types.ts'
import type { Actions, View } from '../App.tsx'
import { ContextMenu } from './ui.tsx'
import type { MenuItem } from './ui.tsx'

function Big(props: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; title?: string; primary?: boolean }) {
  return (
    <button className={`rb big ${props.primary ? 'primary' : ''}`} onClick={props.onClick} disabled={props.disabled} title={props.title ?? props.label}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  )
}
function Small(props: { icon: ReactNode; label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean; title?: string; on?: boolean }) {
  return (
    <button className={`rb small ${props.on ? 'on' : ''}`} onClick={props.onClick} disabled={props.disabled} title={props.title ?? props.label}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  )
}
function Group(props: { label: string; children: ReactNode }) {
  return (
    <div className="rgroup">
      <div className="rgroup-body">{props.children}</div>
      <div className="rgroup-label">{props.label}</div>
    </div>
  )
}

const SORTS: { v: NonNullable<ListQuery['sort']>; label: string }[] = [
  { v: 'date-desc', label: 'Mới nhất trước' },
  { v: 'date-asc', label: 'Cũ nhất trước' },
  { v: 'from', label: 'Theo người gửi' },
  { v: 'subject', label: 'Theo chủ đề' },
  { v: 'size', label: 'Theo dung lượng' }
]

export function Ribbon(props: {
  view: View
  actions: Actions
  settings: AppSettings
  selection: MessageSummary[]
  folder?: Folder
  sort: NonNullable<ListQuery['sort']>
  onSort: (s: NonNullable<ListQuery['sort']>) => void
  busy: boolean
}) {
  const { actions: a, selection, settings } = props
  const [tab, setTab] = useState<'home' | 'sendrecv' | 'folder' | 'view' | 'help'>('home')
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const none = selection.length === 0
  const one = selection.length === 1
  const allRead = !none && selection.every((m) => m.seen)
  const mail = props.view === 'mail'

  const dropdown = (e: React.MouseEvent, items: MenuItem[]): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: r.left, y: r.bottom + 2, items })
  }

  return (
    <header className="ribbon">
      <div className="rtabs">
        {(
          [
            ['home', 'Trang chủ'],
            ['sendrecv', 'Gửi / Nhận'],
            ['folder', 'Thư mục'],
            ['view', 'Xem'],
            ['help', 'Trợ giúp']
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`rtab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="rbar">
        {tab === 'home' && (
          <>
            <Group label="Mới">
              <Big primary icon={<MailPlus size={26} />} label="Thư mới" title="Thư mới (Ctrl+N)" onClick={() => a.compose()} />
              <Big icon={<FileSpreadsheet size={24} />} label="Trộn thư" title="Gửi thư hàng loạt từ danh sách Excel/CSV" onClick={a.openMerge} />
            </Group>
            <Group label="Xoá">
              <Big icon={<Trash2 size={24} />} label="Xoá" title="Xoá (Delete)" onClick={a.remove} disabled={none || !mail} />
              <div className="rcol">
                <Small icon={<Archive size={16} />} label="Lưu trữ" onClick={a.archive} disabled={none || !mail} />
                <Small icon={<Ban size={16} />} label="Thư rác" onClick={a.junk} disabled={none || !mail} />
              </div>
              <div className="rcol">
                <Small icon={<Trash2 size={16} />} label="Xoá tất cả…" title="Xoá nhanh toàn bộ thư trong thư mục đang mở" onClick={a.emptyFolder} disabled={!mail} />
              </div>
            </Group>
            <Group label="Trả lời">
              <Big icon={<Reply size={24} />} label="Trả lời" title="Trả lời (Ctrl+R)" onClick={() => a.reply('reply')} disabled={!one || !mail} />
              <Big icon={<ReplyAll size={24} />} label="Trả lời tất cả" title="Trả lời tất cả (Ctrl+Shift+R)" onClick={() => a.reply('replyAll')} disabled={!one || !mail} />
              <Big icon={<Forward size={24} />} label="Chuyển tiếp" title="Chuyển tiếp (Ctrl+F)" onClick={() => a.reply('forward')} disabled={!one || !mail} />
            </Group>
            <Group label="Thẻ">
              <div className="rcol">
                <Small
                  icon={allRead ? <Mail size={16} /> : <MailOpen size={16} />}
                  label={allRead ? 'Chưa đọc' : 'Đã đọc'}
                  title={allRead ? 'Đánh dấu chưa đọc (Ctrl+U)' : 'Đánh dấu đã đọc (Ctrl+Q)'}
                  onClick={() => a.setRead(!allRead)}
                  disabled={none || !mail}
                />
                <Small icon={<Flag size={16} />} label="Gắn cờ" title="Gắn/bỏ cờ theo dõi (Insert)" onClick={a.toggleFlag} disabled={none || !mail} />
              </div>
              <div className="rcol">
                <Small
                  icon={!none && selection.every((m) => m.pinned) ? <PinOff size={16} /> : <Pin size={16} />}
                  label={!none && selection.every((m) => m.pinned) ? 'Bỏ ghim' : 'Ghim'}
                  title="Ghim cả cuộc hội thoại lên đầu danh sách"
                  onClick={a.togglePin}
                  disabled={none || !mail}
                />
                <Small
                  icon={<Tag size={16} />}
                  label="Phân loại ▾"
                  disabled={none || !mail}
                  onClick={(e) =>
                    dropdown(e, [
                      ...settings.categories.map((c) => ({ label: c.name, swatch: c.color, onClick: () => a.setCategory(c.name) })),
                      { separator: true },
                      { label: 'Xoá phân loại', onClick: () => a.setCategory(null) },
                      { label: 'Sửa danh sách phân loại…', onClick: () => a.openSettings('categories') }
                    ])
                  }
                />
              </div>
            </Group>
            <Group label="Di chuyển">
              <div className="rcol">
                <Small icon={<FolderInput size={16} />} label="Chuyển tới…" title="Chuyển tới thư mục (Ctrl+Shift+V)" onClick={a.openMove} disabled={none || !mail} />
                <Small icon={<Wand2 size={16} />} label="Quy tắc…" onClick={() => a.openSettings('rules')} />
              </div>
            </Group>
          </>
        )}
        {tab === 'sendrecv' && (
          <>
            <Group label="Gửi và nhận">
              <Big
                icon={<RefreshCw size={24} className={props.busy ? 'spin' : ''} />}
                label="Gửi/Nhận tất cả"
                title="Đồng bộ mọi tài khoản (F9)"
                onClick={a.syncAll}
              />
            </Group>
            <Group label="Tài khoản">
              <Big icon={<UserPlus size={24} />} label="Thêm tài khoản" onClick={a.addAccount} />
              <Big icon={<Settings size={24} />} label="Quản lý tài khoản" onClick={() => a.openSettings('accounts')} />
            </Group>
          </>
        )}
        {tab === 'folder' && (
          <>
            <Group label="Thư mục">
              <Big icon={<FolderPlus size={24} />} label="Thư mục mới" onClick={a.newFolder} />
              <div className="rcol">
                <Small icon={<FolderPen size={16} />} label="Đổi tên" onClick={a.renameFolder} disabled={!props.folder || !!props.folder.specialUse} />
                <Small icon={<FolderX size={16} />} label="Xoá thư mục" onClick={a.deleteFolder} disabled={!props.folder || !!props.folder.specialUse} />
              </div>
            </Group>
            <Group label="Dọn dẹp">
              <div className="rcol">
                <Small icon={<CheckCheck size={16} />} label="Đánh dấu tất cả đã đọc" onClick={a.markAllRead} disabled={!props.folder} />
                <Small
                  icon={<Trash2 size={16} />}
                  label="Xoá toàn bộ thư…"
                  onClick={a.emptyFolder}
                  title="Xoá nhanh toàn bộ thư trong thư mục đang mở (Hộp thư đến → vào Thùng rác; Thư rác / Thùng rác → xoá vĩnh viễn)"
                />
              </div>
            </Group>
            <Group label="Công cụ">
              <div className="rcol">
                <Small icon={<Wand2 size={16} />} label="Chạy quy tắc ngay" onClick={a.runRules} disabled={!props.folder} />
                <Small icon={<Download size={16} />} label="Xuất .mbox" onClick={a.exportMbox} disabled={!props.folder} />
              </div>
            </Group>
          </>
        )}
        {tab === 'view' && (
          <>
            <Group label="Ngăn đọc">
              <div className="rcol">
                <Small icon={<PanelRight size={16} />} label="Bên phải" on={settings.readingPane === 'right'} onClick={() => a.setSettings({ readingPane: 'right' })} />
                <Small icon={<PanelBottom size={16} />} label="Bên dưới" on={settings.readingPane === 'bottom'} onClick={() => a.setSettings({ readingPane: 'bottom' })} />
              </div>
              <div className="rcol">
                <Small icon={<PanelRightClose size={16} />} label="Tắt" on={settings.readingPane === 'off'} onClick={() => a.setSettings({ readingPane: 'off' })} />
              </div>
            </Group>
            <Group label="Sắp xếp">
              <div className="rcol">
                <Small
                  icon={<ArrowDownUp size={16} />}
                  label={`${SORTS.find((s) => s.v === props.sort)?.label} ▾`}
                  onClick={(e) => dropdown(e, SORTS.map((s) => ({ label: s.label, onClick: () => props.onSort(s.v) })))}
                />
              </div>
            </Group>
            <Group label="Hội thoại">
              <div className="rcol">
                <Small
                  icon={<MessagesSquare size={16} />}
                  label="Gom theo hội thoại"
                  title="Gom thư gốc và các thư trả lời thành một cuộc hội thoại (khi sắp xếp theo ngày)"
                  on={settings.conversationView}
                  onClick={() => a.setSettings({ conversationView: !settings.conversationView })}
                />
              </div>
            </Group>
            <Group label="Mật độ">
              <div className="rcol">
                <Small icon={<Rows4 size={16} />} label="Gọn" on={settings.density === 'compact'} onClick={() => a.setSettings({ density: 'compact' })} />
                <Small icon={<Rows3 size={16} />} label="Thoáng" on={settings.density === 'normal'} onClick={() => a.setSettings({ density: 'normal' })} />
              </div>
            </Group>
            <Group label="Giao diện">
              <div className="rcol">
                <Small icon={<Sun size={16} />} label="Sáng" on={settings.theme === 'light'} onClick={() => a.setSettings({ theme: 'light' })} />
                <Small icon={<Moon size={16} />} label="Tối" on={settings.theme === 'dark'} onClick={() => a.setSettings({ theme: 'dark' })} />
              </div>
              <div className="rcol">
                <Small icon={<SunMoon size={16} />} label="Theo hệ thống" on={settings.theme === 'system'} onClick={() => a.setSettings({ theme: 'system' })} />
              </div>
            </Group>
          </>
        )}
        {tab === 'help' && (
          <>
            <Group label="Trợ giúp">
              <Big icon={<BookOpen size={24} />} label="Hướng dẫn sử dụng" title="Mở tài liệu hướng dẫn sử dụng (F1)" onClick={a.openGuide} />
              <Big icon={<Keyboard size={24} />} label="Phím tắt" title="Danh sách phím tắt (Ctrl+/)" onClick={a.openShortcuts} />
            </Group>
            <Group label="Thông tin">
              <Big icon={<Info size={24} />} label="Giới thiệu" title="Phiên bản, tác giả, kiểm tra bản mới" onClick={a.openAbout} />
            </Group>
          </>
        )}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </header>
  )
}
