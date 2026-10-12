import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

const modalStack: object[] = []

export function Modal(props: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
}) {
  // Chỉ hộp thoại trên cùng nhận phím Esc (khi có hộp thoại lồng nhau)
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose
  useEffect(() => {
    const token = {}
    modalStack.push(token)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === token) {
        e.stopImmediatePropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      modalStack.splice(modalStack.indexOf(token), 1)
    }
  }, [])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.className ?? ''}`} style={{ width: props.width ?? 520 }} role="dialog" aria-label={props.title}>
        <div className="modal-head">
          <span>{props.title}</span>
          <button className="icon-btn" onClick={props.onClose} title="Đóng">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  )
}

export interface MenuItem {
  label?: string
  icon?: ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  swatch?: string
}

export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: props.x, y: props.y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.max(4, Math.min(props.x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(props.y, window.innerHeight - r.height - 4))
    })
  }, [props.x, props.y])
  useEffect(() => {
    const close = (): void => props.onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  })
  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()} role="menu">
      {props.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              props.onClose()
              it.onClick?.()
            }}
          >
            <span className="menu-icon">
              {it.swatch ? <span className="swatch" style={{ background: it.swatch }} /> : it.icon}
            </span>
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

export function PromptDialog(props: {
  title: string
  label: string
  initial?: string
  okLabel?: string
  onOk: (value: string) => void
  onClose: () => void
}) {
  const [v, setV] = useState(props.initial ?? '')
  const submit = (): void => {
    if (v.trim()) props.onOk(v.trim())
  }
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      width={380}
      footer={
        <>
          <button className="btn primary" onClick={submit} disabled={!v.trim()}>
            {props.okLabel ?? 'Đồng ý'}
          </button>
          <button className="btn" onClick={props.onClose}>
            Huỷ
          </button>
        </>
      }
    >
      <label className="field">
        <span>{props.label}</span>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </label>
    </Modal>
  )
}

export function ConfirmDialog(props: {
  title: string
  message: string
  okLabel: string
  danger?: boolean
  onOk: () => void
  onClose: () => void
}) {
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      width={420}
      footer={
        <>
          <button className={`btn ${props.danger ? 'danger' : 'primary'}`} autoFocus onClick={props.onOk}>
            {props.okLabel}
          </button>
          <button className="btn" onClick={props.onClose}>
            Huỷ
          </button>
        </>
      }
    >
      <p className="confirm-text">{props.message}</p>
    </Modal>
  )
}

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'ok'
}
export function Toasts(props: { items: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {props.items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          <button className="icon-btn" onClick={() => props.onDismiss(t.id)} title="Đóng">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function Field(props: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <label className={`field ${props.wide ? 'wide' : ''}`}>
      <span>{props.label}</span>
      {props.children}
      {props.hint && <small>{props.hint}</small>}
    </label>
  )
}
