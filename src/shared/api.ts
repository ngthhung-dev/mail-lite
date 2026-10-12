import type {
  Account,
  AccountInput,
  AppEvent,
  AppSettings,
  CalendarEvent,
  Contact,
  Draft,
  Folder,
  ListQuery,
  MergeCheck,
  MergeData,
  MergeJob,
  MergeProgress,
  MessageDetail,
  MessageSummary,
  OutgoingAttachment,
  Rule,
  ServerPreset,
  SyncStatus
} from './types.ts'

/** Các hàm tiến trình chính cung cấp cho giao diện (qua IPC). */
export interface Api {
  // tài khoản
  listAccounts(): Promise<Account[]>
  discover(email: string): Promise<ServerPreset>
  saveAccount(input: AccountInput): Promise<Account>
  oauthLogin(input: AccountInput): Promise<Account>
  removeAccount(id: number): Promise<void>
  reorderAccounts(ids: number[]): Promise<void>
  reorderFolders(ids: number[]): Promise<void>
  syncAccount(id: number): Promise<void>
  syncAllAccounts(): Promise<void>
  statuses(): Promise<SyncStatus[]>
  // thư mục
  listFolders(): Promise<Folder[]>
  createFolder(accountId: number, parentFolderId: number | null, name: string): Promise<void>
  renameFolder(folderId: number, name: string): Promise<void>
  deleteFolder(folderId: number): Promise<void>
  emptyFolder(folderId: number): Promise<'deleted' | 'trashed'>
  // thư
  listMessages(q: ListQuery): Promise<MessageSummary[]>
  listThread(accountId: number, threadKey: string, preferFolderId?: number): Promise<MessageSummary[]>
  getMessage(id: number): Promise<MessageDetail | null>
  setFlag(ids: number[], flag: 'seen' | 'flagged' | 'answered', value: boolean): Promise<void>
  setCategory(ids: number[], category: string | null): Promise<void>
  moveMessages(ids: number[], targetFolderId: number): Promise<void>
  deleteMessages(ids: number[], permanent?: boolean): Promise<void>
  moveToSpecial(ids: number[], special: 'archive' | 'junk' | 'inbox'): Promise<void>
  setPinned(ids: number[], value: boolean): Promise<void>
  send(d: Draft): Promise<void>
  sendLater(d: Draft, delaySec: number): Promise<number>
  cancelSend(id: number): Promise<Draft | null>
  sendNow(id: number): Promise<void>
  saveDraft(d: Draft): Promise<void>
  // trộn thư
  mergeRead(file: string, sheet?: string): Promise<MergeData>
  mergeCheck(job: MergeJob): Promise<MergeCheck>
  mergeTest(job: MergeJob, index: number): Promise<string>
  mergeStart(job: MergeJob): Promise<void>
  mergeCancel(): Promise<void>
  /** gửi tiếp các dòng còn lại của đợt gần nhất (kể cả sau khi mở lại ứng dụng) */
  mergeResume(): Promise<void>
  mergeDiscard(): Promise<void>
  mergeStatus(): Promise<MergeProgress | null>
  pickMergeFile(): Promise<string | null>
  saveTextFile(defaultName: string, content: string): Promise<string | null>
  // quy tắc
  listRules(): Promise<Rule[]>
  saveRule(r: Omit<Rule, 'id'> & { id?: number }): Promise<void>
  deleteRule(id: number): Promise<void>
  runRules(folderId: number): Promise<number>
  // danh bạ, lịch, cài đặt
  listContacts(search?: string, limit?: number): Promise<Contact[]>
  saveContact(c: Partial<Contact> & { email: string }): Promise<void>
  deleteContact(id: number): Promise<void>
  listEvents(from: number, to: number): Promise<CalendarEvent[]>
  saveEvent(e: Omit<CalendarEvent, 'id'> & { id?: number }): Promise<number>
  deleteEvent(id: number): Promise<void>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  // chỉ có ở lớp vỏ Electron (hộp thoại hệ điều hành)
  pickAttachments(): Promise<OutgoingAttachment[]>
  openAttachment(attachmentId: number): Promise<void>
  saveAttachmentAs(attachmentId: number): Promise<string | null>
  saveAllAttachments(messageId: number): Promise<number>
  exportEmlAs(messageId: number): Promise<string | null>
  exportMboxAs(folderId: number): Promise<number | null>
  openExternal(url: string): Promise<void>
  openDataDir(): Promise<void>
  /** chọn thư mục mới, chép dữ liệu sang rồi khởi động lại; trả về false nếu người dùng huỷ */
  changeDataDir(): Promise<boolean>
  resetDataDir(): Promise<boolean>
  appInfo(): Promise<{ version: string; dataDir: string; defaultDataDir: string; customDataDir: boolean; secureStorage: boolean; platform: string }>
}

export const ENGINE_METHODS = [
  'listAccounts', 'discover', 'saveAccount', 'oauthLogin', 'removeAccount', 'reorderAccounts', 'reorderFolders', 'syncAccount', 'syncAllAccounts', 'statuses',
  'listFolders', 'createFolder', 'renameFolder', 'deleteFolder', 'emptyFolder',
  'listMessages', 'listThread', 'getMessage', 'setFlag', 'setCategory', 'moveMessages', 'deleteMessages', 'moveToSpecial', 'setPinned', 'send', 'sendLater', 'cancelSend', 'sendNow', 'saveDraft',
  'mergeRead', 'mergeCheck', 'mergeTest', 'mergeStart', 'mergeCancel', 'mergeStatus', 'mergeResume', 'mergeDiscard',
  'listRules', 'saveRule', 'deleteRule', 'runRules',
  'listContacts', 'saveContact', 'deleteContact', 'listEvents', 'saveEvent', 'deleteEvent', 'getSettings', 'setSettings'
] as const

export interface Bridge {
  call(method: string, args: unknown[]): Promise<unknown>
  on(cb: (e: AppEvent) => void): () => void
  platform: string
}
