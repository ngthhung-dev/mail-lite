import { useMemo, useState } from 'react'
import { Folder as FolderIcon } from 'lucide-react'
import type { Folder } from '../../../shared/types.ts'
import { buildTree, flattenTree, folderLabel } from '../util.ts'
import { Modal } from './ui.tsx'

export function MoveDialog(props: { folders: Folder[]; onPick: (folderId: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<number | null>(null)
  const nodes = useMemo(() => flattenTree(buildTree(props.folders)), [props.folders])
  const shown = q.trim() ? nodes.filter((n) => folderLabel(n.folder).toLowerCase().includes(q.trim().toLowerCase())) : nodes
  return (
    <Modal
      title="Chuyển tới thư mục"
      onClose={props.onClose}
      width={400}
      footer={
        <>
          <button className="btn primary" disabled={pick == null} onClick={() => pick != null && props.onPick(pick)}>
            Chuyển
          </button>
          <button className="btn" onClick={props.onClose}>
            Huỷ
          </button>
        </>
      }
    >
      <input className="full" autoFocus placeholder="Lọc thư mục…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pick-list">
        {shown.map((n) => (
          <div
            key={n.folder.id}
            className={`pick ${pick === n.folder.id ? 'on' : ''}`}
            style={{ paddingLeft: 10 + (q.trim() ? 0 : n.depth * 16) }}
            onClick={() => setPick(n.folder.id)}
            onDoubleClick={() => props.onPick(n.folder.id)}
          >
            <FolderIcon size={15} /> {folderLabel(n.folder)}
          </div>
        ))}
      </div>
    </Modal>
  )
}
