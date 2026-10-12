import { useCallback, useEffect, useState } from 'react'
import { Mail, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { Contact } from '../../../shared/types.ts'
import { api } from '../api.ts'
import { colorFor, initials } from '../util.ts'
import { Field, Modal } from './ui.tsx'

type Editing = Partial<Contact> & { email: string }

export function PeopleView(props: { onError: (m: string) => void; onCompose: (to: string) => void }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<Contact[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)
  const load = useCallback(() => void api.listContacts(q || undefined, 1000).then(setList), [q])
  useEffect(load, [load])

  const save = (): void => {
    if (!editing) return
    void api.saveContact(editing).then(
      () => {
        setEditing(null)
        load()
      },
      (e: Error) => props.onError(e.message)
    )
  }

  return (
    <main className="people">
      <div className="cal-head">
        <button className="btn primary" onClick={() => setEditing({ email: '', name: '', company: '', phone: '', notes: '' })}>
          <Plus size={15} /> Liên hệ mới
        </button>
        <div className="search inline">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, email, công ty…" aria-label="Tìm liên hệ" />
        </div>
        <span className="muted">{list.length} liên hệ</span>
      </div>
      <div className="people-list">
        {list.length === 0 && <p className="muted pad">{q ? 'Không tìm thấy liên hệ nào.' : 'Chưa có liên hệ. Người bạn gửi thư sẽ tự được thêm vào đây.'}</p>}
        {list.map((c) => (
          <div className="person" key={c.id}>
            <div className="avatar" style={{ background: colorFor(c.email) }}>{initials(c.name || c.email)}</div>
            <div className="grow">
              <div>
                <b>{c.name || c.email}</b> {c.auto && <span className="tag">tự thêm</span>}
              </div>
              <div className="muted small">
                {c.email}
                {c.company && ` · ${c.company}`}
                {c.phone && ` · ${c.phone}`}
              </div>
            </div>
            <button className="icon-btn" title="Gửi thư" onClick={() => props.onCompose(c.name ? `${c.name} <${c.email}>; ` : `${c.email}; `)}><Mail size={16} /></button>
            <button className="icon-btn" title="Sửa" onClick={() => setEditing(c)}><Pencil size={16} /></button>
            <button className="icon-btn" title="Xoá" onClick={() => void api.deleteContact(c.id).then(load)}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      {editing && (
        <Modal
          title={editing.id ? 'Sửa liên hệ' : 'Liên hệ mới'}
          onClose={() => setEditing(null)}
          width={480}
          footer={
            <>
              <button className="btn primary" onClick={save} disabled={!editing.email.trim()}>Lưu</button>
              <button className="btn" onClick={() => setEditing(null)}>Huỷ</button>
            </>
          }
        >
          <div className="form">
            <Field label="Họ tên"><input autoFocus value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Email"><input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            <Field label="Công ty"><input value={editing.company ?? ''} onChange={(e) => setEditing({ ...editing, company: e.target.value })} /></Field>
            <Field label="Điện thoại"><input value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            <Field label="Ghi chú" wide><textarea rows={3} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </main>
  )
}
