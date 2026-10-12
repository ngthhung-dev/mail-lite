import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import type { CalendarEvent } from '../../../shared/types.ts'
import { api } from '../api.ts'
import { fmtTime, startOfDay } from '../util.ts'
import { Field, Modal } from './ui.tsx'

const DAY = 86400_000
const COLORS = ['#0f6cbd', '#107c10', '#d13438', '#8764b8', '#ca5010', '#038387']
const pad = (n: number): string => String(n).padStart(2, '0')
const toLocalInput = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
type Editing = Omit<CalendarEvent, 'id'> & { id?: number }

function EventDialog(props: { event: Editing; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [e, setE] = useState(props.event)
  const save = (): void =>
    void api.saveEvent(e).then(props.onSaved, (err: Error) => props.onError(err.message))
  return (
    <Modal
      title={e.id ? 'Sửa cuộc hẹn' : 'Cuộc hẹn mới'}
      onClose={props.onClose}
      width={520}
      footer={
        <>
          {e.id && (
            <button className="btn danger" onClick={() => void api.deleteEvent(e.id!).then(props.onSaved)}>
              <Trash2 size={15} /> Xoá
            </button>
          )}
          <span className="grow" />
          <button className="btn primary" onClick={save} disabled={!e.title.trim()}>Lưu</button>
          <button className="btn" onClick={props.onClose}>Huỷ</button>
        </>
      }
    >
      <div className="form">
        <Field label="Tiêu đề" wide>
          <input autoFocus value={e.title} onChange={(ev) => setE({ ...e, title: ev.target.value })} onKeyDown={(ev) => ev.key === 'Enter' && e.title.trim() && save()} />
        </Field>
        <Field label="Bắt đầu">
          <input type="datetime-local" value={toLocalInput(e.start)} onChange={(ev) => {
            const start = new Date(ev.target.value).getTime()
            if (!Number.isNaN(start)) setE({ ...e, start, end: start + Math.max(e.end - e.start, 0) })
          }} />
        </Field>
        <Field label="Kết thúc">
          <input type="datetime-local" value={toLocalInput(e.end)} onChange={(ev) => {
            const end = new Date(ev.target.value).getTime()
            if (!Number.isNaN(end)) setE({ ...e, end })
          }} />
        </Field>
        <Field label="Địa điểm">
          <input value={e.location} onChange={(ev) => setE({ ...e, location: ev.target.value })} />
        </Field>
        <Field label="Nhắc trước">
          <select value={e.reminderMin ?? ''} onChange={(ev) => setE({ ...e, reminderMin: ev.target.value === '' ? null : Number(ev.target.value) })}>
            <option value="">Không nhắc</option>
            <option value={0}>Đúng giờ</option>
            <option value={5}>5 phút</option>
            <option value={15}>15 phút</option>
            <option value={30}>30 phút</option>
            <option value={60}>1 giờ</option>
            <option value={1440}>1 ngày</option>
          </select>
        </Field>
        <Field label="Màu">
          <div className="colors">
            {COLORS.map((c) => (
              <button key={c} className={e.color === c ? 'on' : ''} style={{ background: c }} onClick={() => setE({ ...e, color: c })} aria-label={`Màu ${c}`} />
            ))}
          </div>
        </Field>
        <label className="check">
          <input type="checkbox" checked={e.allDay} onChange={(ev) => setE({ ...e, allDay: ev.target.checked })} /> Cả ngày
        </label>
        <Field label="Ghi chú" wide>
          <textarea rows={3} value={e.notes} onChange={(ev) => setE({ ...e, notes: ev.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

export function CalendarView(props: { onError: (m: string) => void }) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  })
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)

  const grid = useMemo(() => {
    const first = new Date(month)
    const offset = (first.getDay() + 6) % 7 // tuần bắt đầu thứ hai
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getTime())
  }, [month])

  const load = useCallback(() => {
    void api.listEvents(grid[0], grid[41] + DAY).then(setEvents)
  }, [grid])
  useEffect(load, [load])

  const shift = (n: number): void => {
    const d = new Date(month)
    setMonth(new Date(d.getFullYear(), d.getMonth() + n, 1).getTime())
  }
  const today = startOfDay(Date.now())
  const m = new Date(month)
  const newAt = (day: number): void => {
    const start = day + 9 * 3600_000
    setEditing({ title: '', location: '', start, end: start + 3600_000, allDay: false, notes: '', reminderMin: 15, color: COLORS[0] })
  }

  return (
    <main className="calendar">
      <div className="cal-head">
        <button className="btn primary" onClick={() => newAt(today)}><Plus size={15} /> Cuộc hẹn mới</button>
        <button className="btn" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime())}>Hôm nay</button>
        <button className="icon-btn" onClick={() => shift(-1)} title="Tháng trước"><ChevronLeft size={18} /></button>
        <button className="icon-btn" onClick={() => shift(1)} title="Tháng sau"><ChevronRight size={18} /></button>
        <h2>Tháng {m.getMonth() + 1} năm {m.getFullYear()}</h2>
      </div>
      <div className="cal-dow">
        {['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="cal-grid">
        {grid.map((day) => {
          const d = new Date(day)
          const list = events.filter((e) => e.start < day + DAY && e.end >= day)
          return (
            <div key={day} className={`cal-cell ${d.getMonth() !== m.getMonth() ? 'other' : ''} ${day === today ? 'today' : ''}`} onDoubleClick={() => newAt(day)} title="Nhấp đúp để tạo cuộc hẹn">
              <div className="cal-num">{d.getDate()}</div>
              {list.slice(0, 4).map((e) => (
                <button
                  key={e.id}
                  className="cal-ev"
                  style={{ borderLeftColor: e.color, background: e.color + '22' }}
                  onClick={() => setEditing(e)}
                  onDoubleClick={(ev) => ev.stopPropagation()}
                  title={`${e.title}${e.location ? ' · ' + e.location : ''}`}
                >
                  {!e.allDay && e.start >= day && <span className="t">{fmtTime(e.start)}</span>} {e.title}
                </button>
              ))}
              {list.length > 4 && <div className="muted small">+{list.length - 4} nữa</div>}
            </div>
          )
        })}
      </div>
      {editing && (
        <EventDialog
          event={editing}
          onClose={() => setEditing(null)}
          onError={props.onError}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </main>
  )
}
