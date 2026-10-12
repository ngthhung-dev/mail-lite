import { useState } from 'react'
import {
  AlertCircle, Archive, Ban, ChevronDown, ChevronRight, FilePen, Flag, Folder as FolderIcon, Inbox, MailWarning, Plus, Send, Trash2
} from 'lucide-react'
import type { Account, Folder, SyncStatus } from '../../../shared/types.ts'
import type { Selection } from '../App.tsx'
import { buildTree, folderLabel } from '../util.ts'
import type { FolderNode } from '../util.ts'

const ICONS: Record<string, typeof Inbox> = { inbox: Inbox, sent: Send, drafts: FilePen, trash: Trash2, junk: Ban, archive: Archive }
export const DRAG_TYPE = 'application/x-maillite-ids'
const ACCOUNT_DRAG = 'application/x-maillite-account'
const FOLDER_DRAG = 'application/x-maillite-folder'

export function FolderPane(props: {
  accounts: Account[]
  folders: Folder[]
  statuses: Record<number, SyncStatus>
  sel: Selection
  onSelect: (s: Selection) => void
  onFolderMenu: (f: Folder, x: number, y: number) => void
  onDropMessages: (folderId: number, ids: number[]) => void
  onAddAccount: () => void
  onReorderAccounts: (ids: number[]) => void
  onReorderFolders: (ids: number[]) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dropId, setDropId] = useState<number | null>(null)
  // kéo thả đổi thứ tự tài khoản: tài khoản đang kéo + vị trí sẽ thả (trước/sau tài khoản nào)
  const [dragAcc, setDragAcc] = useState<number | null>(null)
  const [accDrop, setAccDrop] = useState<{ id: number; after: boolean } | null>(null)
  // kéo thả đổi thứ tự thư mục: chỉ trong cùng một cấp của cùng một tài khoản
  const [dragFolder, setDragFolder] = useState<{ id: number; siblings: number[] } | null>(null)
  const [folderDrop, setFolderDrop] = useState<{ id: number; after: boolean } | null>(null)
  const endFolderDrag = (): void => {
    setDragFolder(null)
    setFolderDrop(null)
  }
  const dropAccount = (): void => {
    if (dragAcc == null || !accDrop || accDrop.id === dragAcc) return
    const ids = props.accounts.map((a) => a.id).filter((id) => id !== dragAcc)
    const i = ids.indexOf(accDrop.id)
    ids.splice(accDrop.after ? i + 1 : i, 0, dragAcc)
    if (ids.join() !== props.accounts.map((a) => a.id).join()) props.onReorderAccounts(ids)
  }
  const toggle = (k: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  const inboxes = props.folders.filter((f) => f.specialUse === 'inbox')
  const unreadInbox = inboxes.reduce((n, f) => n + f.unread, 0)
  const isVirtual = (v: string): boolean => 'virtual' in props.sel && props.sel.virtual === v

  const renderNode = (n: FolderNode, _i: number, list: FolderNode[]) => {
    const siblings = list.map((x) => x.folder.id)
    const sameLevel = !!dragFolder && dragFolder.siblings.join() === siblings.join()
    const f = n.folder
    const Icon = ICONS[f.specialUse ?? ''] ?? FolderIcon
    const key = `f${f.id}`
    const open = !collapsed.has(key)
    const active = 'folderId' in props.sel && props.sel.folderId === f.id
    // Thư nháp hiện tổng số thư, các thư mục khác hiện số chưa đọc — như Outlook
    const count = f.specialUse === 'drafts' ? f.total : f.unread
    return (
      <div key={f.id}>
        <div
          className={`fitem ${active ? 'on' : ''} ${dropId === f.id ? 'drop' : ''} ${f.unread ? 'unread' : ''} ${dragFolder?.id === f.id ? 'dragging' : ''} ${
            folderDrop?.id === f.id && dragFolder?.id !== f.id ? (folderDrop.after ? 'drop-after' : 'drop-before') : ''
          }`}
          draggable={siblings.length > 1}
          onDragStart={(e) => {
            e.stopPropagation()
            e.dataTransfer.setData(FOLDER_DRAG, String(f.id))
            e.dataTransfer.effectAllowed = 'move'
            setDragFolder({ id: f.id, siblings })
          }}
          onDragEnd={endFolderDrag}
          style={{ paddingLeft: 10 + n.depth * 14 }}
          onClick={() => props.onSelect({ folderId: f.id })}
          onContextMenu={(e) => {
            e.preventDefault()
            props.onFolderMenu(f, e.clientX, e.clientY)
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(FOLDER_DRAG)) {
              // chỉ cho thả giữa các thư mục cùng cấp; thả chỗ khác thì không có vạch, không làm gì
              if (!sameLevel) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const r = e.currentTarget.getBoundingClientRect()
              const after = e.clientY > r.top + r.height / 2
              setFolderDrop((d) => (d?.id === f.id && d.after === after ? d : { id: f.id, after }))
              return
            }
            if (e.dataTransfer.types.includes(DRAG_TYPE)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropId(f.id)
            }
          }}
          onDragLeave={() => setDropId((d) => (d === f.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault()
            setDropId(null)
            if (e.dataTransfer.types.includes(FOLDER_DRAG)) {
              if (dragFolder && folderDrop && sameLevel && folderDrop.id !== dragFolder.id) {
                const ids = siblings.filter((id) => id !== dragFolder.id)
                const i = ids.indexOf(folderDrop.id)
                ids.splice(folderDrop.after ? i + 1 : i, 0, dragFolder.id)
                if (ids.join() !== siblings.join()) props.onReorderFolders(ids)
              }
              endFolderDrag()
              return
            }
            try {
              const d = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as { ids: number[]; accountId: number }
              if (d.accountId === f.accountId && d.ids.length) props.onDropMessages(f.id, d.ids)
            } catch {
              /* dữ liệu kéo thả không hợp lệ */
            }
          }}
          title={f.path}
        >
          {n.children.length ? (
            <button
              className="twisty"
              onClick={(e) => {
                e.stopPropagation()
                toggle(key)
              }}
              aria-label={open ? 'Thu gọn' : 'Mở rộng'}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="twisty" />
          )}
          <Icon size={15} className="ficon" />
          <span className="fname">{folderLabel(f)}</span>
          {count > 0 && <span className={`fcount ${f.specialUse === 'drafts' ? 'plain' : ''}`}>{f.specialUse === 'drafts' ? `[${count}]` : count}</span>}
        </div>
        {open && n.children.map(renderNode)}
      </div>
    )
  }

  return (
    <div className="folders" role="tree">
      <div className="fsection" onClick={() => toggle('fav')}>
        {collapsed.has('fav') ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span>Mục ưa thích</span>
      </div>
      {!collapsed.has('fav') && (
        <>
          <div className={`fitem ${isVirtual('all-inbox') ? 'on' : ''} ${unreadInbox ? 'unread' : ''}`} style={{ paddingLeft: 10 }} onClick={() => props.onSelect({ virtual: 'all-inbox' })}>
            <span className="twisty" />
            <Inbox size={15} className="ficon" />
            <span className="fname">Tất cả hộp thư đến</span>
            {unreadInbox > 0 && <span className="fcount">{unreadInbox}</span>}
          </div>
          <div className={`fitem ${isVirtual('unread') ? 'on' : ''}`} style={{ paddingLeft: 10 }} onClick={() => props.onSelect({ virtual: 'unread' })}>
            <span className="twisty" />
            <MailWarning size={15} className="ficon" />
            <span className="fname">Thư chưa đọc</span>
          </div>
          <div className={`fitem ${isVirtual('flagged') ? 'on' : ''}`} style={{ paddingLeft: 10 }} onClick={() => props.onSelect({ virtual: 'flagged' })}>
            <span className="twisty" />
            <Flag size={15} className="ficon" />
            <span className="fname">Thư đã gắn cờ</span>
          </div>
        </>
      )}

      {props.accounts.map((a) => {
        const key = `a${a.id}`
        const st = props.statuses[a.id]
        const tree = buildTree(props.folders.filter((f) => f.accountId === a.id))
        return (
          <div key={a.id}>
            <div
              className={`fsection account ${dragAcc === a.id ? 'dragging' : ''} ${accDrop?.id === a.id && dragAcc !== a.id ? (accDrop.after ? 'drop-after' : 'drop-before') : ''}`}
              onClick={() => toggle(key)}
              title={st?.state === 'error' ? st.message : `${a.email}\nKéo thả để đổi thứ tự`}
              draggable={props.accounts.length > 1}
              onDragStart={(e) => {
                e.dataTransfer.setData(ACCOUNT_DRAG, String(a.id))
                e.dataTransfer.effectAllowed = 'move'
                setDragAcc(a.id)
              }}
              onDragEnd={() => {
                setDragAcc(null)
                setAccDrop(null)
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(ACCOUNT_DRAG)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const r = e.currentTarget.getBoundingClientRect()
                const after = e.clientY > r.top + r.height / 2
                setAccDrop((d) => (d?.id === a.id && d.after === after ? d : { id: a.id, after }))
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes(ACCOUNT_DRAG)) return
                e.preventDefault()
                dropAccount()
                setDragAcc(null)
                setAccDrop(null)
              }}
            >
              {collapsed.has(key) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span className="dot" style={{ background: a.color }} />
              <span className="fname">{a.email}</span>
              {st?.state === 'error' && <AlertCircle size={14} className="err" />}
            </div>
            {!collapsed.has(key) &&
              (tree.length ? tree.map(renderNode) : <div className="fempty">{st?.state === 'error' ? 'Không kết nối được' : 'Đang tải thư mục…'}</div>)}
          </div>
        )
      })}

      <button className="add-account" onClick={props.onAddAccount}>
        <Plus size={15} /> Thêm tài khoản
      </button>
    </div>
  )
}
