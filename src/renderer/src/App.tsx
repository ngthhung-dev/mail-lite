import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, Mail, Maximize2, Minimize2, Settings, Users, X } from 'lucide-react'
import type {
  Account,
  AdvancedSearch,
  AppSettings,
  Draft,
  Folder,
  ListQuery,
  MessageDetail,
  MessageSummary,
  SyncStatus
} from '../../shared/types.ts'
import { APP_NAME, DEFAULT_SETTINGS, SCOPE_LABEL, advActive } from '../../shared/types.ts'
import { api, onEvent } from './api.ts'
import { buildReply, draftFromMessage, emptyDraft, folderLabel } from './util.ts'
import { ConfirmDialog, ContextMenu, PromptDialog, Toasts } from './components/ui.tsx'
import type { MenuItem, Toast } from './components/ui.tsx'
import { AboutDialog, ShortcutsDialog } from './components/HelpDialogs.tsx'
import { Ribbon } from './components/Ribbon.tsx'
import { FolderPane } from './components/FolderPane.tsx'
import { MessageList } from './components/MessageList.tsx'
import type { ListRow } from './components/MessageList.tsx'
import { ReadingPane } from './components/ReadingPane.tsx'
import { Compose } from './components/Compose.tsx'
import { AccountDialog } from './components/AccountDialog.tsx'
import { SettingsDialog } from './components/SettingsDialog.tsx'
import { MoveDialog } from './components/MoveDialog.tsx'
import { MergeDialog } from './components/MergeDialog.tsx'
import { CalendarView } from './components/CalendarView.tsx'
import { PeopleView } from './components/PeopleView.tsx'

export type Selection = { folderId: number } | { virtual: 'all-inbox' | 'flagged' | 'unread' }
export type View = 'mail' | 'calendar' | 'people'
const PAGE = 200

type Dialog =
  | { type: 'account'; account?: Account }
  | { type: 'settings'; tab?: string }
  | { type: 'merge' }
  | { type: 'about' }
  | { type: 'shortcuts' }
  | { type: 'move'; ids: number[]; accountId: number }
  | { type: 'prompt'; title: string; label: string; initial?: string; okLabel?: string; onOk: (v: string) => void }
  | { type: 'confirm'; title: string; message: string; okLabel: string; danger?: boolean; onOk: () => void }

export interface Actions {
  compose(patch?: Partial<Draft>): void
  reply(mode: 'reply' | 'replyAll' | 'forward'): void
  remove(): void
  archive(): void
  junk(): void
  setRead(value: boolean): void
  toggleFlag(): void
  togglePin(): void
  setCategory(c: string | null): void
  openMove(): void
  syncAll(): void
  openSettings(tab?: string): void
  openMerge(): void
  addAccount(): void
  newFolder(): void
  renameFolder(): void
  deleteFolder(): void
  emptyFolder(): void
  exportMbox(): void
  runRules(): void
  markAllRead(): void
  saveEml(): void
  setSettings(patch: Partial<AppSettings>): void
  openGuide(): void
  openShortcuts(): void
  openAbout(): void
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Thanh kéo giữa hai ngăn. Nhấp đúp để về kích thước mặc định. */
function Splitter(props: { horizontal?: boolean; label: string; onDrag: (x: number, y: number) => void; onDone: () => void; onReset: () => void }) {
  const dragging = useRef(false)
  return (
    <div
      className={`splitter ${props.horizontal ? 'h' : 'v'}`}
      role="separator"
      aria-orientation={props.horizontal ? 'horizontal' : 'vertical'}
      title={`${props.label} (nhấp đúp để về mặc định)`}
      onPointerDown={(e) => {
        e.preventDefault()
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add(props.horizontal ? 'resizing-h' : 'resizing-v')
      }}
      onPointerMove={(e) => dragging.current && props.onDrag(e.clientX, e.clientY)}
      onPointerUp={(e) => {
        if (!dragging.current) return
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.classList.remove('resizing-h', 'resizing-v')
        props.onDone()
      }}
      onDoubleClick={props.onReset}
    />
  )
}

/** Thanh "Hoàn tác" hiện trong lúc thư còn được giữ lại trước khi gửi thật. */
function UndoBar(props: { items: { id: number; subject: string; until: number }[]; onUndo: (id: number) => void; onNow: (id: number) => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="undobar" role="status">
      {props.items.map((p) => {
        const left = Math.max(0, Math.ceil((p.until - Date.now()) / 1000))
        return (
          <div key={p.id} className="undo-item">
            <span className="undo-text">
              {left > 0 ? `Sẽ gửi sau ${left} giây` : 'Đang gửi…'}: <b>{p.subject || '(Không có tiêu đề)'}</b>
            </span>
            <button className="btn" onClick={() => props.onUndo(p.id)} disabled={left === 0}>
              Hoàn tác
            </button>
            <button className="link" onClick={() => props.onNow(p.id)} disabled={left === 0}>
              Gửi ngay
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function App() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [statuses, setStatuses] = useState<Record<number, SyncStatus>>({})
  const [loaded, setLoaded] = useState(false)
  const [version, setVersion] = useState('')
  const [view, setView] = useState<View>('mail')
  const [sel, setSel] = useState<Selection>({ virtual: 'all-inbox' })
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [limit, setLimit] = useState(PAGE)
  const [filter, setFilter] = useState<NonNullable<ListQuery['filter']>>('all')
  const [sort, setSort] = useState<NonNullable<ListQuery['sort']>>('date-desc')
  const [search, setSearch] = useState('')
  const [adv, setAdv] = useState<AdvancedSearch>({})
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [activeId, setActiveId] = useState<number | null>(null)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [compose, setCompose] = useState<{ key: number; draft: Draft } | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [threads, setThreads] = useState<Record<string, MessageSummary[]>>({})
  const [reader, setReader] = useState<{ id: number; max: boolean } | null>(null)
  const [pending, setPending] = useState<{ id: number; subject: string; until: number }[]>([])
  const composeRef = useRef(false)
  const [merge, setMerge] = useState<{ running: boolean; done: number; total: number; remaining: number } | null>(null)
  const [sideW, setSideW] = useState(DEFAULT_SETTINGS.sideWidth)
  const [listW, setListW] = useState(DEFAULT_SETTINGS.listWidth)
  const [listH, setListH] = useState(DEFAULT_SETTINGS.listHeightPct)
  const mailRef = useRef<HTMLElement>(null)
  useEffect(() => {
    setSideW(settings.sideWidth)
    setListW(settings.listWidth)
    setListH(settings.listHeightPct)
  }, [settings.sideWidth, settings.listWidth, settings.listHeightPct])
  const anchor = useRef<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4000)
  }, [])
  const run = useCallback(
    async (p: Promise<unknown>, okMsg?: string): Promise<boolean> => {
      try {
        await p
        if (okMsg) toast(okMsg, 'ok')
        return true
      } catch (e) {
        toast((e as Error).message, 'error')
        return false
      }
    },
    [toast]
  )

  // ---------- Tải dữ liệu ----------
  const reloadMeta = useCallback(async () => {
    const [a, f] = await Promise.all([api.listAccounts(), api.listFolders()])
    setAccounts(a)
    setFolders(f)
    return a
  }, [])

  const grouping = settings.conversationView && (sort === 'date-desc' || sort === 'date-asc')
  /** đang lọc theo thẻ hoặc tìm kiếm: hội thoại chỉ gồm những thư khớp điều kiện */
  const narrowed = filter !== 'all' || !!search.trim() || advActive(adv)
  const query = useMemo<ListQuery>(() => {
    // thẻ lọc nhanh (Tất cả / Chưa đọc / Có cờ / Có tệp) luôn áp dụng cùng với tìm kiếm;
    // phạm vi khác "thư mục hiện tại" do phần lõi xử lý thay cho thư mục đang mở
    const q: ListQuery = { filter, sort, limit, threads: grouping, search: search.trim() || undefined, adv: advActive(adv) ? adv : undefined }
    return 'folderId' in sel ? { ...q, folderId: sel.folderId } : { ...q, virtual: sel.virtual }
  }, [sel, filter, sort, limit, search, adv, grouping])
  const queryRef = useRef(query)
  queryRef.current = query

  const reloadList = useCallback(async () => {
    const q = queryRef.current
    const list = await api.listMessages(q)
    if (queryRef.current === q) setMessages(list)
  }, [])

  useEffect(() => {
    void (async () => {
      const [s, a, st] = await Promise.all([api.getSettings(), reloadMeta(), api.statuses()])
      setSettingsState(s)
      setStatuses(Object.fromEntries(st.map((x) => [x.accountId, x])))
      void api.appInfo().then((i) => setVersion(i.build ? `${i.version} (build ${i.build})` : i.version))
      setLoaded(true)
      if (a.length === 0) setDialog({ type: 'account' })
      // đợt trộn thư còn dở từ lần mở trước → nhắc để người dùng bấm gửi tiếp
      const m = await api.mergeStatus()
      if (m && (m.running || m.remaining > 0)) {
        setMerge({ running: m.running, done: m.results.length, total: m.total, remaining: m.remaining })
        if (!m.running) toast(`Còn một đợt trộn thư gửi dở (${m.results.length}/${m.total}). Bấm vào thanh trạng thái để gửi tiếp.`, 'info')
      }
    })()
  }, [reloadMeta])

  useEffect(() => {
    void reloadList()
  }, [query, reloadList])

  // đổi thư mục / tìm kiếm → về đầu danh sách
  useEffect(() => {
    setLimit(PAGE)
    setExpanded(new Set())
    setThreads({})
    setSelected(new Set())
    setActiveId(null)
    anchor.current = null
  }, [sel, search, adv, filter])

  // Sự kiện từ tiến trình chính
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const refresh = (): void => {
      if (t) return
      t = setTimeout(() => {
        t = null
        void reloadList()
        void api.listFolders().then(setFolders)
      }, 250)
    }
    const off = onEvent((e) => {
      if (e.type === 'sync-status') setStatuses((s) => ({ ...s, [e.status.accountId]: e.status }))
      else if (e.type === 'mail-changed') refresh()
      else if (e.type === 'folders-changed' || e.type === 'accounts-changed') void reloadMeta()
      else if (e.type === 'reminder') toast(`Nhắc lịch: ${e.event.title}`, 'info')
      else if (e.type === 'merge-progress') {
        setMerge({ running: e.running, done: e.done, total: e.total, remaining: e.remaining })
        if (!e.running && e.total > 0) toast(e.stopped ? `Trộn thư đã dừng ở ${e.done}/${e.total}.` : `Trộn thư xong: đã xử lý ${e.done}/${e.total} dòng.`, e.stopped ? 'error' : 'ok')
      }
      else if (e.type === 'send-result') {
        setPending((p) => p.filter((x) => x.id !== e.id))
        if (e.ok) toast('Đã gửi thư.', 'ok')
        else if (e.draft && !composeRef.current) {
          // gửi lỗi sau thời gian chờ → mở lại thư để người dùng sửa/gửi lại, không để mất nội dung
          toast(e.error ?? 'Gửi thư thất bại.', 'error')
          setCompose({ key: Date.now(), draft: e.draft })
        } else if (e.draft) {
          const d = e.draft
          void api.saveDraft(d).then(
            () => toast(`Gửi “${e.subject}” thất bại: ${e.error}. Thư đã được lưu vào Thư nháp.`, 'error'),
            () => toast(`Gửi “${e.subject}” thất bại: ${e.error}`, 'error')
          )
        }
      } else if (e.type === 'menu') menuAction.current(e.action)
    })
    return () => {
      off()
      if (t) clearTimeout(t)
    }
  }, [reloadList, reloadMeta, toast])

  const readerId = reader?.id ?? null
  // Tải nội dung thư đang mở
  useEffect(() => {
    if (activeId == null) {
      setDetail(null)
      return
    }
    let stale = false
    setDetailLoading(true)
    void api
      .getMessage(activeId)
      .then((d) => {
        if (stale) return
        setDetail(d)
        // khi ngăn đọc tắt, chọn thư chưa phải là đọc — chỉ đánh dấu đã đọc khi mở cửa sổ đọc thư
        if (d && !d.seen && settings.markReadOnOpen && (settings.readingPane !== 'off' || readerId === d.id)) void api.setFlag([d.id], 'seen', true)
      })
      .catch(() => !stale && setDetail(null))
      .finally(() => !stale && setDetailLoading(false))
    return () => {
      stale = true
    }
  }, [activeId, settings.markReadOnOpen, settings.readingPane, readerId])

  // thư đang mở trong cửa sổ đọc bị xoá/chuyển, hoặc người dùng chọn thư khác → đóng cửa sổ
  useEffect(() => {
    if (reader && activeId !== reader.id) setReader(null)
  }, [activeId, reader])

  // Giao diện sáng / tối
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.documentElement.dataset.density = settings.density
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme, settings.density])

  // ---------- Dẫn xuất ----------
  const currentFolder = 'folderId' in sel ? folders.find((f) => f.id === sel.folderId) : undefined
  // ---------- Gom hội thoại ----------
  const rows = useMemo<ListRow[]>(() => {
    const tidOf = (m: MessageSummary): string => (grouping && m.threadKey ? `${m.accountId}|${m.threadKey}` : '')
    const inList = new Map<string, MessageSummary[]>()
    for (const m of messages) {
      const t = tidOf(m)
      if (t) inList.set(t, [...(inList.get(t) ?? []), m])
    }
    const out: ListRow[] = []
    const done = new Set<string>()
    for (const m of messages) {
      const tid = tidOf(m)
      const sibs = tid ? inList.get(tid)! : [m]
      const count = !tid ? 1 : narrowed ? sibs.length : Math.max(m.threadCount, sibs.length)
      if (!tid || count <= 1) {
        out.push({ m, kind: 'single', tid: '', count: 1, open: false, unread: !m.seen })
        continue
      }
      if (done.has(tid)) continue // các thư cùng hội thoại gom dưới dòng đại diện
      done.add(tid)
      // dòng đại diện là thư mới nhất của hội thoại, đặt ở vị trí thư đầu tiên gặp trong danh sách
      const head = sibs.reduce((a, b) => (b.date > a.date ? b : a))
      const open = expanded.has(tid)
      out.push({ m: head, kind: 'head', tid, count, open, unread: sibs.some((x) => !x.seen) })
      if (open) {
        const all = narrowed ? sibs : (threads[tid] ?? sibs)
        for (const c of [...all].sort((a, b) => b.date - a.date)) {
          if (c.id !== head.id) out.push({ m: c, kind: 'child', tid, count, open, unread: !c.seen })
        }
      }
    }
    return out
  }, [messages, grouping, expanded, threads, narrowed])
  /** Các thư đang hiện trên danh sách theo đúng thứ tự (kể cả thư con của hội thoại đang mở). */
  const visible = useMemo(() => rows.map((r) => r.m), [rows])
  /** Số thư khớp với danh sách đang hiện: mỗi hội thoại tính đủ số thư của nó (kể cả thư mình đã gửi). */
  const shownCount = useMemo(() => rows.reduce((n, r) => n + (r.kind === 'child' ? 0 : r.count), 0), [rows])

  const loadThread = useCallback((tid: string, preferFolderId?: number) => {
    const i = tid.indexOf('|')
    void api.listThread(Number(tid.slice(0, i)), tid.slice(i + 1), preferFolderId).then((list) => setThreads((t) => ({ ...t, [tid]: list })))
  }, [])
  // danh sách vừa tải lại (thư mới về, đổi cờ…) → làm mới các hội thoại đang mở
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const folderIdRef = useRef<number | undefined>(undefined)
  folderIdRef.current = 'folderId' in sel ? sel.folderId : undefined
  useEffect(() => {
    for (const tid of expandedRef.current) loadThread(tid, folderIdRef.current)
  }, [messages, loadThread])

  const selectedList = useMemo(() => visible.filter((m) => selected.has(m.id)), [visible, selected])
  const activeAccount = useMemo(() => {
    const id = selectedList[0]?.accountId ?? currentFolder?.accountId ?? accounts[0]?.id
    return accounts.find((a) => a.id === id)
  }, [selectedList, currentFolder, accounts])
  const title =
    adv.scope && adv.scope !== 'folder'
      ? `Kết quả tìm kiếm — ${SCOPE_LABEL[adv.scope]}`
      : currentFolder
        ? folderLabel(currentFolder)
        : 'virtual' in sel
          ? { 'all-inbox': 'Tất cả hộp thư đến', flagged: 'Thư đã gắn cờ', unread: 'Thư chưa đọc' }[sel.virtual]
          : ''

  // ---------- Chọn thư ----------
  const selectMessage = useCallback(
    (id: number, mode: 'single' | 'toggle' | 'range') => {
      if (mode === 'toggle') {
        setSelected((s) => {
          const n = new Set(s)
          if (n.has(id)) n.delete(id)
          else n.add(id)
          return n
        })
        anchor.current = id
        setActiveId(id)
        return
      }
      if (mode === 'range' && anchor.current != null) {
        const a = visible.findIndex((m) => m.id === anchor.current)
        const b = visible.findIndex((m) => m.id === id)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          setSelected(new Set(visible.slice(lo, hi + 1).map((m) => m.id)))
          setActiveId(id)
          return
        }
      }
      anchor.current = id
      setSelected(new Set([id]))
      setActiveId(id)
    },
    [visible]
  )

  /** Sau khi xoá/chuyển: chọn thư kế tiếp như Outlook. */
  const afterRemoval = (ids: number[]): void => {
    const gone = new Set(ids)
    const idx = visible.findIndex((m) => gone.has(m.id))
    const rest = visible.filter((m) => !gone.has(m.id))
    setMessages((ms) => ms.filter((m) => !gone.has(m.id)))
    setThreads((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.filter((m) => !gone.has(m.id))])))
    const next = rest[Math.min(idx, rest.length - 1)]
    if (next) {
      setSelected(new Set([next.id]))
      setActiveId(next.id)
      anchor.current = next.id
    } else {
      setSelected(new Set())
      setActiveId(null)
    }
  }

  const ids = (): number[] => selectedList.map((m) => m.id)
  const patchLocal = (list: number[], patch: Partial<MessageSummary>): void => {
    const s = new Set(list)
    setMessages((ms) => ms.map((m) => (s.has(m.id) ? { ...m, ...patch } : m)))
    setThreads((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.map((m) => (s.has(m.id) ? { ...m, ...patch } : m))])))
    setDetail((d) => (d && s.has(d.id) ? { ...d, ...patch } : d))
  }

  const openCompose = (draft: Draft): void => setCompose({ key: Date.now(), draft })
  composeRef.current = !!compose

  const needFolder = (): Folder | null => {
    if (!currentFolder) toast('Hãy chọn một thư mục cụ thể trước.', 'info')
    return currentFolder ?? null
  }

  const actions: Actions = {
    compose(patch) {
      if (!accounts.length) return setDialog({ type: 'account' })
      openCompose(emptyDraft(activeAccount ?? accounts[0], patch))
    },
    reply(mode) {
      void (async () => {
        const id = activeId ?? selectedList[0]?.id
        if (id == null) return
        const d = detail?.id === id ? detail : await api.getMessage(id)
        const acc = accounts.find((a) => a.id === d?.accountId)
        if (!d || !acc) return
        if (!d.bodyAvailable) toast('Chưa tải được nội dung thư gốc (đang offline?).', 'info')
        openCompose(buildReply(d, acc, mode))
      })()
    },
    remove() {
      const list = ids()
      if (!list.length) return
      afterRemoval(list)
      void run(api.deleteMessages(list))
    },
    archive() {
      const list = ids()
      if (!list.length) return
      void run(api.moveToSpecial(list, 'archive')).then((ok) => (ok ? afterRemoval(list) : undefined))
    },
    junk() {
      const list = ids()
      if (!list.length) return
      void run(api.moveToSpecial(list, 'junk')).then((ok) => (ok ? afterRemoval(list) : undefined))
    },
    setRead(value) {
      const list = ids()
      if (!list.length) return
      patchLocal(list, { seen: value })
      void run(api.setFlag(list, 'seen', value))
    },
    togglePin() {
      const list = ids()
      if (!list.length) return
      const value = !selectedList.every((m) => m.pinned)
      void run(api.setPinned(list, value), value ? 'Đã ghim cuộc hội thoại lên đầu danh sách.' : 'Đã bỏ ghim.')
    },
    toggleFlag() {
      const list = ids()
      if (!list.length) return
      const value = !selectedList.every((m) => m.flagged)
      patchLocal(list, { flagged: value })
      void run(api.setFlag(list, 'flagged', value))
    },
    setCategory(c) {
      const list = ids()
      if (!list.length) return
      patchLocal(list, { category: c })
      void run(api.setCategory(list, c))
    },
    openMove() {
      const list = ids()
      if (!list.length) return
      if (new Set(selectedList.map((m) => m.accountId)).size > 1) {
        return toast('Các thư đang chọn thuộc nhiều tài khoản — hãy chuyển từng tài khoản một.', 'info')
      }
      setDialog({ type: 'move', ids: list, accountId: selectedList[0].accountId })
    },
    syncAll() {
      if (!accounts.length) return setDialog({ type: 'account' })
      void api.syncAllAccounts()
    },
    openSettings(tab) {
      setDialog({ type: 'settings', tab })
    },
    addAccount() {
      setDialog({ type: 'account' })
    },
    openMerge() {
      if (!accounts.length) return setDialog({ type: 'account' })
      setDialog({ type: 'merge' })
    },
    newFolder() {
      const acc = currentFolder ? accounts.find((a) => a.id === currentFolder.accountId) : activeAccount
      if (!acc) return toast('Hãy thêm tài khoản trước.', 'info')
      const parent = currentFolder && !currentFolder.specialUse ? currentFolder : null
      setDialog({
        type: 'prompt',
        title: 'Thư mục mới',
        label: parent ? `Tên thư mục con trong “${folderLabel(parent)}” (${acc.name})` : `Tên thư mục (${acc.name})`,
        okLabel: 'Tạo',
        onOk: (name) => {
          setDialog(null)
          void run(api.createFolder(acc.id, parent?.id ?? null, name), 'Đã tạo thư mục.')
        }
      })
    },
    renameFolder() {
      const f = needFolder()
      if (!f) return
      if (f.specialUse) return toast('Không đổi tên được thư mục hệ thống.', 'info')
      setDialog({
        type: 'prompt',
        title: 'Đổi tên thư mục',
        label: 'Tên mới',
        initial: f.name,
        okLabel: 'Đổi tên',
        onOk: (name) => {
          setDialog(null)
          setSel({ virtual: 'all-inbox' })
          void run(api.renameFolder(f.id, name), 'Đã đổi tên thư mục.')
        }
      })
    },
    deleteFolder() {
      const f = needFolder()
      if (!f) return
      if (f.specialUse) return toast('Không xoá được thư mục hệ thống.', 'info')
      setDialog({
        type: 'confirm',
        title: 'Xoá thư mục',
        message: `Xoá thư mục “${f.name}” cùng ${f.total} thư bên trong, cả trên máy chủ? Không thể hoàn tác.`,
        okLabel: 'Xoá thư mục',
        danger: true,
        onOk: () => {
          setDialog(null)
          setSel({ virtual: 'all-inbox' })
          void run(api.deleteFolder(f.id), 'Đã xoá thư mục.')
        }
      })
    },
    emptyFolder() {
      // đang ở "Tất cả hộp thư đến" mà chỉ có một tài khoản → hiểu là hộp thư đến của tài khoản đó
      const inboxes = folders.filter((x) => x.specialUse === 'inbox')
      const f = currentFolder ?? ('virtual' in sel && sel.virtual === 'all-inbox' && inboxes.length === 1 ? inboxes[0] : null)
      if (!f) return toast('Hãy chọn một thư mục cụ thể (ví dụ Hộp thư đến của một tài khoản) rồi bấm lại.', 'info')
      const acc = accounts.find((x) => x.id === f.accountId)
      const hasTrash = folders.some((x) => x.accountId === f.accountId && x.specialUse === 'trash')
      const permanent = !hasTrash || f.specialUse === 'trash' || f.specialUse === 'junk' || f.specialUse === 'drafts'
      const name = `${folderLabel(f)} (${acc?.email ?? ''})`
      setDialog({
        type: 'confirm',
        title: `Xoá toàn bộ thư trong ${folderLabel(f)}`,
        message: permanent
          ? `Xoá VĨNH VIỄN toàn bộ thư trong ${name}, kể cả thư cũ trên máy chủ chưa tải về máy? Không thể hoàn tác.`
          : `Chuyển toàn bộ thư trong ${name} vào Thùng rác, kể cả thư cũ trên máy chủ chưa tải về máy? Bạn vẫn lấy lại được từ Thùng rác cho đến khi dọn Thùng rác.`,
        okLabel: permanent ? 'Xoá vĩnh viễn tất cả' : 'Chuyển tất cả vào Thùng rác',
        danger: true,
        onOk: () => {
          setDialog(null)
          setSelected(new Set())
          setActiveId(null)
          void api.emptyFolder(f.id).then(
            (r) => toast(r === 'deleted' ? `Đã xoá toàn bộ thư trong ${folderLabel(f)}.` : `Đã chuyển toàn bộ thư trong ${folderLabel(f)} vào Thùng rác.`, 'ok'),
            (e: Error) => toast(e.message, 'error')
          )
        }
      })
    },
    exportMbox() {
      const f = needFolder()
      if (!f) return
      void api
        .exportMboxAs(f.id)
        .then((n) => n != null && toast(`Đã xuất ${n} thư ra tệp .mbox.`, 'ok'))
        .catch((e: Error) => toast(e.message, 'error'))
    },
    runRules() {
      const f = needFolder()
      if (!f) return
      void api
        .runRules(f.id)
        .then((n) => toast(n ? `Đã áp dụng quy tắc cho ${n} thư.` : 'Không có thư nào khớp quy tắc.', 'ok'))
        .catch((e: Error) => toast(e.message, 'error'))
    },
    openGuide() {
      void api.openGuide().catch((e: Error) => toast(e.message, 'error'))
    },
    openShortcuts() {
      setDialog({ type: 'shortcuts' })
    },
    openAbout() {
      setDialog({ type: 'about' })
    },
    markAllRead() {
      const f = needFolder()
      if (!f) return
      void (async () => {
        const unread = await api.listMessages({ folderId: f.id, filter: 'unread', limit: 100000 })
        if (!unread.length) return
        patchLocal(
          unread.map((m) => m.id),
          { seen: true }
        )
        await run(api.setFlag(unread.map((m) => m.id), 'seen', true))
      })()
    },
    saveEml() {
      const id = activeId ?? selectedList[0]?.id
      if (id == null) return
      void api
        .exportEmlAs(id)
        .then((p) => p && toast('Đã lưu thư thành tệp .eml.', 'ok'))
        .catch((e: Error) => toast(e.message, 'error'))
    },
    setSettings(patch) {
      setSettingsState((s) => ({ ...s, ...patch }))
      // không áp lại kết quả trả về: nhiều lần lưu liên tiếp (kéo rồi nhấp đúp) sẽ làm giao diện giật về giá trị cũ
      void api.setSettings(patch).catch((e: Error) => toast(e.message, 'error'))
    }
  }

  const menuAction = useRef<(a: string) => void>(() => undefined)
  menuAction.current = (a) => {
    if (a === 'new-mail') actions.compose()
    else if (a === 'add-account') actions.addAccount()
    else if (a === 'merge') actions.openMerge()
    else if (a === 'sync') actions.syncAll()
    else if (a === 'settings') actions.openSettings()
    else if (a === 'view-mail') setView('mail')
    else if (a === 'view-calendar') setView('calendar')
    else if (a === 'view-people') setView('people')
  }

  // ---------- Phím tắt (giống Outlook) ----------
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined)
  keyHandler.current = (e) => {
    // Phím tắt toàn cục (trước đây nằm ở thanh menu hệ thống)
    const g = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (!compose && !dialog) {
      let hit = true
      if (g && key === '1') setView('mail')
      else if (g && key === '2') setView('calendar')
      else if (g && key === '3') setView('people')
      else if (g && !e.shiftKey && key === 'n') actions.compose()
      else if (g && e.shiftKey && key === 'm') actions.openMerge()
      else if (g && key === ',') actions.openSettings()
      else if (key === 'f9') actions.syncAll()
      else if (key === 'f1') actions.openGuide()
      else if (g && key === '/') actions.openShortcuts()
      else hit = false
      if (hit) {
        e.preventDefault()
        return
      }
    }
    if (compose || dialog || view !== 'mail') return
    if (reader) {
      // trong cửa sổ đọc thư: Esc để đóng; không cho phím mũi tên đổi thư phía sau
      if (e.key === 'Escape') {
        e.preventDefault()
        setReader(null)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) return
    }
    const t = e.target as HTMLElement
    const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'e') {
      e.preventDefault()
      searchRef.current?.focus()
      return
    }
    if (typing) return
    if (mod && e.shiftKey && k === 'r') actions.reply('replyAll')
    else if (mod && k === 'r') actions.reply('reply')
    else if (mod && k === 'f') actions.reply('forward')
    else if (mod && k === 'q') actions.setRead(true)
    else if (mod && k === 'u') actions.setRead(false)
    else if (mod && e.shiftKey && k === 'v') actions.openMove()
    else if (mod && k === 'a') {
      setSelected(new Set(visible.map((m) => m.id)))
    } else if (k === 'delete' || (k === 'backspace' && mod)) actions.remove()
    else if (k === 'insert') actions.toggleFlag()
    else if (k === 'arrowdown' || k === 'arrowup') {
      const i = visible.findIndex((m) => m.id === activeId)
      const next = visible[k === 'arrowdown' ? Math.min(i + 1, visible.length - 1) : Math.max(i - 1, 0)]
      if (next) {
        selectMessage(next.id, e.shiftKey ? 'range' : 'single')
        document.querySelector(`[data-mid="${next.id}"]`)?.scrollIntoView({ block: 'nearest' })
      }
    } else if (k === 'enter' && activeId != null) {
      const m = visible.find((x) => x.id === activeId)
      if (m?.draft) openDraft(m.id)
      else if (m && !reader) setReader({ id: m.id, max: false })
      return
    } else return
    e.preventDefault()
  }
  useEffect(() => {
    const h = (e: KeyboardEvent): void => keyHandler.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const openDraft = (id: number): void => {
    void api.getMessage(id).then((d) => d && openCompose(draftFromMessage(d)))
  }

  // ---------- Menu chuột phải ----------
  const messageMenu = (m: MessageSummary, x: number, y: number): void => {
    if (!selected.has(m.id)) selectMessage(m.id, 'single')
    const many = selected.has(m.id) && selected.size > 1
    setMenu({
      x,
      y,
      items: [
        ...(m.draft ? [{ label: 'Sửa thư nháp', onClick: () => openDraft(m.id) }] : []),
        { label: 'Trả lời', onClick: () => actionsRef.current.reply('reply'), disabled: many },
        { label: 'Trả lời tất cả', onClick: () => actionsRef.current.reply('replyAll'), disabled: many },
        { label: 'Chuyển tiếp', onClick: () => actionsRef.current.reply('forward'), disabled: many },
        { separator: true },
        { label: 'Đánh dấu đã đọc', onClick: () => actionsRef.current.setRead(true) },
        { label: 'Đánh dấu chưa đọc', onClick: () => actionsRef.current.setRead(false) },
        { label: m.flagged ? 'Bỏ gắn cờ' : 'Gắn cờ theo dõi', onClick: () => actionsRef.current.toggleFlag() },
        { label: m.pinned ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại lên đầu', onClick: () => actionsRef.current.togglePin() },
        { separator: true },
        ...settings.categories.map((c) => ({ label: `Phân loại: ${c.name}`, swatch: c.color, onClick: () => actionsRef.current.setCategory(c.name) })),
        { label: 'Xoá phân loại', onClick: () => actionsRef.current.setCategory(null), disabled: !m.category },
        { separator: true },
        { label: 'Chuyển tới thư mục…', onClick: () => actionsRef.current.openMove() },
        { label: 'Lưu trữ', onClick: () => actionsRef.current.archive() },
        { label: 'Báo thư rác', onClick: () => actionsRef.current.junk() },
        { label: 'Lưu thành tệp .eml…', onClick: () => actionsRef.current.saveEml(), disabled: many },
        { separator: true },
        { label: 'Xoá', danger: true, onClick: () => actionsRef.current.remove() }
      ]
    })
  }

  const folderMenu = (f: Folder, x: number, y: number): void => {
    setSel({ folderId: f.id })
    const withFolder = (fn: () => void) => () => setTimeout(fn, 0)
    setMenu({
      x,
      y,
      items: [
        { label: 'Đồng bộ tài khoản này', onClick: () => void api.syncAccount(f.accountId).catch((e: Error) => toast(e.message, 'error')) },
        { label: 'Đánh dấu tất cả đã đọc', onClick: withFolder(() => actionsRef.current.markAllRead()), disabled: !f.unread },
        { separator: true },
        { label: 'Thư mục con mới…', onClick: withFolder(() => actionsRef.current.newFolder()) },
        { label: 'Đổi tên…', onClick: withFolder(() => actionsRef.current.renameFolder()), disabled: !!f.specialUse },
        { label: 'Xoá thư mục…', danger: true, onClick: withFolder(() => actionsRef.current.deleteFolder()), disabled: !!f.specialUse },
        { separator: true },
        { label: 'Chạy quy tắc trên thư mục', onClick: withFolder(() => actionsRef.current.runRules()) },
        { label: 'Xuất ra tệp .mbox…', onClick: withFolder(() => actionsRef.current.exportMbox()) },
        { separator: true },
        { label: `Xoá toàn bộ thư trong ${folderLabel(f)}…`, danger: true, onClick: withFolder(() => actionsRef.current.emptyFolder()), disabled: !f.total && f.specialUse !== 'trash' && f.specialUse !== 'junk' && f.specialUse !== 'inbox' }
      ]
    })
  }
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const dropOnFolder = (folderId: number, dragged: number[]): void => {
    afterRemoval(dragged)
    void run(api.moveMessages(dragged, folderId))
  }

  // ---------- Thanh trạng thái ----------
  const statusList = Object.values(statuses).filter((s) => accounts.some((a) => a.id === s.accountId))
  const busy = statusList.find((s) => s.state === 'syncing' || s.state === 'connecting')
  const errors = statusList.filter((s) => s.state === 'error')
  const accName = (id: number): string => accounts.find((a) => a.id === id)?.name ?? ''
  const statusText = busy
    ? `${accName(busy.accountId)}: ${busy.message}${busy.progress ? ` (${busy.progress.done}/${busy.progress.total})` : ''}`
    : errors.length
      ? `Lỗi ${accName(errors[0].accountId)}: ${errors[0].message}`
      : statusList.some((s) => s.state === 'offline')
        ? 'Đang ngoại tuyến — vẫn đọc được thư đã đồng bộ'
        : accounts.length
          ? 'Tất cả thư mục đã cập nhật'
          : 'Chưa có tài khoản'

  if (!loaded) return <div className="splash">Đang mở {APP_NAME}…</div>

  return (
    <div className="app">
      <Ribbon
        view={view}
        actions={actions}
        settings={settings}
        selection={selectedList}
        folder={currentFolder}
        sort={sort}
        onSort={setSort}
        busy={!!busy}
      />
      <div className="body">
        <aside className="side" style={{ width: sideW }}>
          {view === 'mail' ? (
            <FolderPane
              accounts={accounts}
              folders={folders}
              statuses={statuses}
              sel={sel}
              onSelect={(s) => {
                setSearch('')
                setAdv({})
                setSel(s)
              }}
              onFolderMenu={folderMenu}
              onDropMessages={dropOnFolder}
              onAddAccount={actions.addAccount}
              onReorderFolders={(ids) => {
                // đổi ngay trên giao diện, lưu xuống sau
                setFolders((fs) => fs.map((f) => (ids.includes(f.id) ? { ...f, sortOrder: ids.indexOf(f.id) + 1 } : f)))
                void api.reorderFolders(ids).catch((e: Error) => toast(e.message, 'error'))
              }}
              onReorderAccounts={(ids) => {
                // đổi ngay trên giao diện, lưu xuống sau
                setAccounts((as) => ids.map((id) => as.find((x) => x.id === id)!).filter(Boolean))
                void api.reorderAccounts(ids).catch((e: Error) => toast(e.message, 'error'))
              }}
            />
          ) : (
            <div className="side-note">
              {view === 'calendar' ? 'Lịch lưu trên máy này. Nhắc việc hiện qua thông báo hệ thống.' : 'Danh bạ tự thu thập từ người bạn đã gửi thư, và các liên hệ bạn thêm tay.'}
            </div>
          )}
          <nav className="nav" aria-label="Chuyển khu vực">
            <button className={view === 'mail' ? 'on' : ''} onClick={() => setView('mail')} title="Thư (Ctrl+1)">
              <Mail size={20} />
            </button>
            <button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')} title="Lịch (Ctrl+2)">
              <Calendar size={20} />
            </button>
            <button className={view === 'people' ? 'on' : ''} onClick={() => setView('people')} title="Danh bạ (Ctrl+3)">
              <Users size={20} />
            </button>
            <span className="grow" />
            <button onClick={() => actions.openSettings()} title="Cài đặt">
              <Settings size={20} />
            </button>
          </nav>
        </aside>
        <Splitter
          label="Kéo để đổi độ rộng cây thư mục"
          onDrag={(x) => setSideW(clamp(x, 170, Math.min(520, window.innerWidth - 420)))}
          onDone={() => actions.setSettings({ sideWidth: sideW })}
          onReset={() => actions.setSettings({ sideWidth: DEFAULT_SETTINGS.sideWidth })}
        />

        {view === 'mail' && (
          <main
            ref={mailRef}
            className={`mail pane-${settings.readingPane}`}
            style={{ '--list-w': `${listW}px`, '--list-h': `${listH}%` } as React.CSSProperties}
          >
            <MessageList
              title={title}
              rows={rows}
              currentFolderId={currentFolder?.id}
              folderLabelOf={(id) => {
                const f = folders.find((x) => x.id === id)
                return f ? folderLabel(f) : ''
              }}
              onToggleThread={(row) => {
                const opening = !expanded.has(row.tid)
                setExpanded((e) => {
                  const n = new Set(e)
                  if (opening) n.add(row.tid)
                  else n.delete(row.tid)
                  return n
                })
                if (opening) loadThread(row.tid, currentFolder?.id)
              }}
              onToggleRead={(m) => {
                patchLocal([m.id], { seen: !m.seen })
                void run(api.setFlag([m.id], 'seen', !m.seen))
              }}
              onTogglePin={(m) => void run(api.setPinned([m.id], !m.pinned))}
              accounts={accounts}
              settings={settings}
              showAccount={!currentFolder && accounts.length > 1}
              sentView={currentFolder?.specialUse === 'sent' || currentFolder?.specialUse === 'drafts'}
              selected={selected}
              activeId={activeId}
              filter={filter}
              onFilter={setFilter}
              searching={!!search.trim() || advActive(adv)}
              search={search}
              adv={adv}
              folderName={currentFolder ? folderLabel(currentFolder) : 'virtual' in sel ? { 'all-inbox': 'Tất cả hộp thư đến', flagged: 'Thư đã gắn cờ', unread: 'Thư chưa đọc' }[sel.virtual] : ''}
              searchRef={searchRef}
              onSearch={setSearch}
              onApplySearch={(text, a) => {
                setSearch(text)
                setAdv(a)
              }}
              empty={accounts.length === 0}
              onSelect={selectMessage}
              onOpen={(m) => {
                if (m.draft) return openDraft(m.id)
                // nhấp đúp: mở thư trong cửa sổ riêng (hữu ích nhất khi ngăn đọc đang tắt)
                anchor.current = m.id
                setSelected(new Set([m.id]))
                setActiveId(m.id)
                setReader({ id: m.id, max: false })
              }}
              onMenu={messageMenu}
              onToggleFlag={(m) => {
                patchLocal([m.id], { flagged: !m.flagged })
                void run(api.setFlag([m.id], 'flagged', !m.flagged))
              }}
              onMore={() => messages.length >= limit && setLimit((l) => l + PAGE)}
              onAddAccount={actions.addAccount}
            />
            {settings.readingPane !== 'off' && (
              <Splitter
                horizontal={settings.readingPane === 'bottom'}
                label="Kéo để đổi kích thước danh sách thư và ngăn đọc"
                onDrag={(x, y) => {
                  const r = mailRef.current?.getBoundingClientRect()
                  if (!r) return
                  if (settings.readingPane === 'bottom') setListH(clamp(((y - r.top) / r.height) * 100, 18, 82))
                  else setListW(clamp(x - r.left, 240, Math.max(240, r.width - 260)))
                }}
                onDone={() => actions.setSettings(settings.readingPane === 'bottom' ? { listHeightPct: Math.round(listH) } : { listWidth: Math.round(listW) })}
                onReset={() => actions.setSettings({ listWidth: DEFAULT_SETTINGS.listWidth, listHeightPct: DEFAULT_SETTINGS.listHeightPct })}
              />
            )}
            {settings.readingPane !== 'off' && (
              <ReadingPane
                detail={detail}
                loading={detailLoading}
                count={selected.size}
                settings={settings}
                actions={actions}
                onError={(m) => toast(m, 'error')}
                onInfo={(m) => toast(m, 'ok')}
                onEditDraft={openDraft}
              />
            )}
          </main>
        )}
        {view === 'calendar' && <CalendarView onError={(m) => toast(m, 'error')} />}
        {view === 'people' && (
          <PeopleView onError={(m) => toast(m, 'error')} onCompose={(to) => actions.compose({ to })} />
        )}
      </div>
      <footer className="status">
        <span className="tagline">Phiên bản {version}</span>
        <span>{view === 'mail' ? `${shownCount}${messages.length >= limit ? '+' : ''} thư${selected.size > 1 ? ` · đã chọn ${selected.size}` : ''}` : ''}</span>
        <span className="grow" />
        {merge && (merge.running || merge.remaining > 0) && (
          <button className="status-merge" onClick={() => setDialog({ type: 'merge' })} title="Mở cửa sổ trộn thư">
            {merge.running && <span className="spinner" />}
            {merge.running ? `Trộn thư: ${merge.done}/${merge.total}` : `Trộn thư gửi dở ${merge.done}/${merge.total} — bấm để gửi tiếp`}
          </button>
        )}
        <span className={`status-text ${errors.length && !busy ? 'err' : ''}`} title={statusText}>
          {busy && <span className="spinner" />}
          {statusText}
        </span>
      </footer>

      {reader && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setReader(null)}>
          <div className={`reader ${reader.max ? 'max' : ''}`} role="dialog" aria-label="Đọc thư">
            <div className="modal-head">
              <span>{detail?.id === reader.id ? detail.subject || '(Không có tiêu đề)' : 'Đang mở thư…'}</span>
              <span>
                <button className="icon-btn" onClick={() => setReader({ ...reader, max: !reader.max })} title={reader.max ? 'Thu nhỏ' : 'Phóng to'}>
                  {reader.max ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                <button className="icon-btn" onClick={() => setReader(null)} title="Đóng (Esc)">
                  <X size={16} />
                </button>
              </span>
            </div>
            <ReadingPane
              detail={detail?.id === reader.id ? detail : null}
              loading={detailLoading || detail?.id !== reader.id}
              count={1}
              settings={settings}
              actions={actions}
              onError={(m) => toast(m, 'error')}
              onInfo={(m) => toast(m, 'ok')}
              onEditDraft={openDraft}
            />
          </div>
        </div>
      )}
      {compose && (
        <Compose
          key={compose.key}
          initial={compose.draft}
          accounts={accounts}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null)
            toast('Đã gửi thư.', 'ok')
          }}
          undoSec={settings.undoSendSec}
          onQueued={(id, subject, sec) => {
            setCompose(null)
            setPending((p) => [...p, { id, subject, until: Date.now() + sec * 1000 }])
          }}
          onSaved={() => {
            setCompose(null)
            toast('Đã lưu vào Thư nháp.', 'ok')
          }}
          onError={(m) => toast(m, 'error')}
        />
      )}
      {dialog?.type === 'account' && (
        <AccountDialog
          account={dialog.account}
          settings={settings}
          onClose={() => setDialog(null)}
          onSaved={(a) => {
            setDialog(null)
            toast(`Đã lưu tài khoản ${a.email}. Đang đồng bộ thư về máy…`, 'ok')
            void reloadMeta()
          }}
          onOpenOAuthSettings={() => setDialog({ type: 'settings', tab: 'oauth' })}
        />
      )}
      {dialog?.type === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog?.type === 'about' && <AboutDialog onClose={() => setDialog(null)} onGuide={() => actions.openGuide()} />}
      {dialog?.type === 'settings' && (
        <SettingsDialog
          tab={dialog.tab}
          accounts={accounts}
          folders={folders}
          settings={settings}
          onSettings={actions.setSettings}
          onClose={() => setDialog(null)}
          onEditAccount={(a) => setDialog({ type: 'account', account: a })}
          onAddAccount={() => setDialog({ type: 'account' })}
          onChanged={() => void reloadMeta()}
          toast={toast}
        />
      )}
      {dialog?.type === 'merge' && (
        <MergeDialog accounts={accounts} defaultAccountId={activeAccount?.id} onClose={() => setDialog(null)} toast={toast} />
      )}
      {dialog?.type === 'move' && (
        <MoveDialog
          folders={folders.filter((f) => f.accountId === dialog.accountId)}
          onClose={() => setDialog(null)}
          onPick={(fid) => {
            const list = dialog.ids
            setDialog(null)
            afterRemoval(list)
            void run(api.moveMessages(list, fid))
          }}
        />
      )}
      {dialog?.type === 'prompt' && <PromptDialog {...dialog} onClose={() => setDialog(null)} />}
      {dialog?.type === 'confirm' && <ConfirmDialog {...dialog} onClose={() => setDialog(null)} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {pending.length > 0 && (
        <UndoBar
          items={pending}
          onUndo={(id) => {
            setPending((p) => p.filter((x) => x.id !== id))
            void api.cancelSend(id).then((d) => {
              if (d) openCompose(d)
              else toast('Thư đã được gửi đi, không hoàn tác kịp.', 'info')
            })
          }}
          onNow={(id) => {
            // đổi ngay sang "Đang gửi…" — phần chờ còn lại là thời gian máy chủ thư nhận thư
            setPending((p) => p.map((x) => (x.id === id ? { ...x, until: 0 } : x)))
            void api.sendNow(id)
          }}
        />
      )}
      <Toasts items={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  )
}
