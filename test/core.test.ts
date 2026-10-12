// Kiểm thử phần lõi với máy chủ IMAP/SMTP giả lập chạy ngay trên máy (không cần mạng).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ImapFlow } from 'imapflow'
import { Engine, safeFileName } from '../src/main/engine.ts'
import type { AppEvent, AccountInput, MergeJob } from '../src/shared/types.ts'
import { parseCsv } from '../src/main/merge.ts'
import { Store } from '../src/main/store.ts'
import { copyData, planTarget, readConfig, resolveDataDir, writeConfig } from '../src/main/datadir.ts'
import { DatabaseSync } from 'node:sqlite'
import { renderTemplate, rowRecord, templateFields } from '../src/shared/merge.ts'

const require = createRequire(import.meta.url)
const hoodiecrow = require('hoodiecrow-imap')
const { SMTPServer } = require('smtp-server')

const IMAP_PORT = 12143
const SMTP_PORT = 12025
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const mail = (n: number, subject: string, body: string, daysAgo: number, extra = '') =>
  [
    `From: "Nguyễn Văn An" <an@congty.vn>`,
    `To: testuser@example.com`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `Message-ID: <m${n}@congty.vn>`,
    `Date: ${new Date(Date.now() - daysAgo * 86400000).toUTCString()}`,
    `MIME-Version: 1.0`,
    extra ||
      `Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(`<p>${body}</p>`).toString('base64')}`
  ].join('\r\n')

const withAttachment = [
  'Content-Type: multipart/mixed; boundary="B1"',
  '',
  '--B1',
  'Content-Type: multipart/related; boundary="B2"',
  '',
  '--B2',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Xem logo <img src="cid:logo1"> va tep dinh kem</p>',
  '--B2',
  'Content-Type: image/png',
  'Content-ID: <logo1>',
  'Content-Disposition: inline; filename="logo.png"',
  'Content-Transfer-Encoding: base64',
  '',
  png,
  '--B2--',
  '--B1',
  'Content-Type: text/csv; name="bao-cao.csv"',
  'Content-Disposition: attachment; filename="bao-cao.csv"',
  '',
  'a,b,c',
  '1,2,3',
  '--B1--',
  ''
].join('\r\n')

const imapServer = hoodiecrow({
  plugins: ['ID', 'IDLE', 'UIDPLUS', 'MOVE', 'SPECIAL-USE', 'LITERALPLUS', 'UNSELECT', 'ENABLE', 'NAMESPACE', 'SASL-IR'],
  storage: {
    INBOX: {
      messages: [
        { raw: mail(1, 'Báo cáo doanh thu quý 3', 'Gửi anh chị báo cáo doanh thu, vui lòng xem giúp.', 2), flags: ['\\Seen'] },
        { raw: mail(2, 'Lịch họp tuần', 'Họp giao ban sáng thứ hai lúc 9 giờ.', 1) },
        { raw: mail(3, 'Hợp đồng kèm tệp', '', 0, withAttachment) },
        { raw: mail(4, 'Thư cũ năm ngoái', 'Nội dung rất cũ.', 400) }
      ]
    },
    '': {
      separator: '/',
      folders: {
        Sent: { 'special-use': '\\Sent' },
        Drafts: { 'special-use': '\\Drafts' },
        Trash: { 'special-use': '\\Trash' },
        Junk: { 'special-use': '\\Junk' },
        'Du an': { folders: { 'Khach hang A': {} } }
      }
    }
  }
})

const received: { from: string; to: string[]; raw: string }[] = []
const smtpServer = new SMTPServer({
  disabledCommands: ['STARTTLS'],
  allowInsecureAuth: true,
  onAuth(auth: any, _s: any, cb: any) {
    if (auth.username === 'testuser' && auth.password === 'testpass') cb(null, { user: 'testuser' })
    else cb(new Error('Invalid credentials'))
  },
  onData(stream: any, session: any, cb: any) {
    const chunks: Buffer[] = []
    stream.on('data', (c: Buffer) => chunks.push(c))
    stream.on('end', () => {
      received.push({
        from: session.envelope.mailFrom.address,
        to: session.envelope.rcptTo.map((r: any) => r.address),
        raw: Buffer.concat(chunks).toString()
      })
      cb()
    })
  }
})

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maillite-test-'))
const events: AppEvent[] = []
let passed = 0
const ok = (name: string) => {
  passed++
  console.log(`  ✓ ${name}`)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean | Promise<boolean>, what: string, timeout = 15000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await cond()) return
    await wait(100)
  }
  throw new Error('Quá thời gian chờ: ' + what)
}

async function serverUids(mailbox: string, flag?: string): Promise<number[]> {
  const c = new ImapFlow({ host: '127.0.0.1', port: IMAP_PORT, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false })
  await c.connect()
  const lock = await c.getMailboxLock(mailbox)
  try {
    const r = await c.search(flag ? { keyword: flag } : { all: true }, { uid: true })
    if (!flag) return r || []
    const out: number[] = []
    if (c.mailbox && c.mailbox.exists)
      for await (const m of c.fetch('1:*', { uid: true, flags: true })) if (m.flags?.has(flag)) out.push(m.uid)
    return out
  } finally {
    lock.release()
    await c.logout()
  }
}
async function serverAppend(mailbox: string, raw: string): Promise<void> {
  const c = new ImapFlow({ host: '127.0.0.1', port: IMAP_PORT, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false })
  await c.connect()
  await c.append(mailbox, Buffer.from(raw), [])
  await c.logout()
}

async function main(): Promise<void> {
  await new Promise<void>((r) => imapServer.listen(IMAP_PORT, r))
  await new Promise<void>((r) => smtpServer.listen(SMTP_PORT, '127.0.0.1', r))

  const engine = new Engine({
    dataDir,
    encrypt: (s) => 'enc:' + Buffer.from(s).toString('base64'),
    decrypt: (s) => Buffer.from(s.slice(4), 'base64').toString(),
    openExternal: () => undefined,
    emit: (e) => events.push(e)
  })

  const input: AccountInput = {
    name: 'Mail công ty',
    email: 'testuser@example.com',
    displayName: 'Người Dùng Thử',
    provider: 'imap',
    authType: 'password',
    imapHost: '127.0.0.1',
    imapPort: IMAP_PORT,
    imapSecure: false,
    smtpHost: '127.0.0.1',
    smtpPort: SMTP_PORT,
    smtpSecure: false,
    username: 'testuser',
    password: 'sai-mat-khau',
    syncDays: 0
  }

  console.log('Tài khoản')
  await assert.rejects(() => engine.saveAccount(input), /Đăng nhập thất bại/)
  assert.equal(engine.listAccounts().length, 0)
  ok('mật khẩu sai bị từ chối, không lưu tài khoản')

  const acc = await engine.saveAccount({ ...input, password: 'testpass' })
  assert.ok(!engine.store.getSecret(acc.id).includes('testpass'))
  ok('thêm tài khoản, mật khẩu được mã hoá trước khi lưu')
  {
    // đổi thứ tự tài khoản: dùng bản ghi tạm trong CSDL (không kết nối máy chủ)
    const st = engine.store
    const mk = (email: string) => st.saveAccount({ ...st.getAccount(acc.id)!, id: undefined, email } as any).id
    const b = mk('b@example.com'), c = mk('c@example.com')
    const order = () => engine.listAccounts().map((x) => x.id)
    assert.deepEqual(order(), [acc.id, b, c], 'tài khoản mới xếp cuối')
    engine.reorderAccounts([c, acc.id, b])
    assert.deepEqual(order(), [c, acc.id, b])
    const d = mk('d@example.com')
    assert.deepEqual(order(), [c, acc.id, b, d], 'tài khoản thêm sau khi đã sắp xếp vẫn nằm cuối')
    for (const id of [b, c, d]) st.deleteAccount(id)
    engine.reorderAccounts([acc.id])
  }
  ok('kéo thả đổi thứ tự tài khoản, tài khoản mới luôn nằm cuối')

  console.log('Đồng bộ')
  await until(() => events.some((e) => e.type === 'sync-status' && e.status.state === 'idle'), 'đồng bộ lần đầu')
  const folders = engine.listFolders()
  const f = (su: string | null, name?: string) => folders.find((x) => (su ? x.specialUse === su : x.name === name))!
  assert.deepEqual(
    ['inbox', 'sent', 'drafts', 'trash', 'junk'].map((s) => !!f(s)),
    [true, true, true, true, true]
  )
  assert.ok(folders.some((x) => x.path === 'Du an/Khach hang A'))
  ok(`nhận ${folders.length} thư mục, gồm thư mục con và thư mục hệ thống`)

  const inbox = f('inbox')
  let list = engine.listMessages({ folderId: inbox.id })
  assert.equal(list.length, 4)
  assert.equal(list[0].subject, 'Hợp đồng kèm tệp')
  assert.equal(inbox.unread, 3)
  ok('tải 4 thư, sắp xếp mới nhất trước, đếm đúng thư chưa đọc')

  const m3 = (await engine.getMessage(list[0].id))!
  assert.ok(m3.bodyAvailable)
  assert.ok(m3.html.includes('data:image/png;base64,'), 'ảnh cid phải được nhúng')
  const atts = m3.attachments.filter((a) => !a.inline)
  assert.equal(atts.length, 1)
  assert.equal(atts[0].filename, 'bao-cao.csv')
  assert.ok(list[0].hasAttachments)
  const emlFile = path.join(dataDir, 'mail', String(acc.id), String(inbox.id), `${list[0].uid}.eml`)
  assert.ok(fs.existsSync(emlFile))
  ok('nội dung + tệp .eml gốc lưu về máy, ảnh nhúng hiển thị offline')

  const dest = path.join(dataDir, 'out.csv')
  await engine.saveAttachment(atts[0].id, dest)
  assert.match(fs.readFileSync(dest, 'utf8'), /a,b,c\r?\n1,2,3/)
  ok('lưu tệp đính kèm ra đĩa')

  assert.equal(engine.listMessages({ search: 'bao cao doanh thu' }).length, 1)
  assert.equal(engine.listMessages({ search: 'họp giao' }).length, 1)
  assert.equal(engine.listMessages({ search: 'khongtontai' }).length, 0)
  assert.equal(engine.listMessages({ search: 'x" OR (' }).length, 0)
  ok('tìm kiếm toàn văn, gõ không dấu vẫn ra tiếng Việt có dấu')
  const nInboxBefore = (await serverUids('INBOX')).length
  // Tìm nhiều từ: thư chứa đúng cả cụm được ưu tiên; thư chỉ có các từ rải rác không lẫn vào
  await serverAppend('INBOX', mail(61, 'Dự kiến các khoản cần thanh toán tuần 41', 'Mọi người điền chi phí.', 0))
  await serverAppend('INBOX', mail(62, 'Vấn đề chậm trễ thủ tục thanh toán', 'Dự kiến tuần sau xong. Các bộ phận cần gửi hồ sơ, nhiều khoản còn thiếu, toán lại số liệu.', 0))
  await until(() => engine.listMessages({ folderId: inbox.id }).some((m) => m.subject.startsWith('Vấn đề chậm trễ') && m.snippet !== ''), 'thư thử tìm cụm từ')
  const found = (t: string) => engine.listMessages({ search: t }).map((m) => m.subject)
  assert.deepEqual(found('DỰ KIẾN CÁC KHOẢN CẦN THANH TOÁN'), ['Dự kiến các khoản cần thanh toán tuần 41'])
  assert.deepEqual(found('du kien cac khoan can thanh to'), ['Dự kiến các khoản cần thanh toán tuần 41'], 'từ cuối đang gõ dở vẫn khớp')
  assert.equal(found('thanh toán khoản').length, 2)
  await engine.deleteMessages(engine.listMessages({ search: 'thanh toán khoản' }).map((m) => m.id), true)
  await until(async () => (await serverUids('INBOX')).length === nInboxBefore, 'dọn thư thử tìm cụm từ')
  ok('tìm nhiều từ: ưu tiên thư chứa đúng cả cụm, không lẫn thư chỉ có các từ rải rác')

  // Tìm kiếm nâng cao
  const A = (adv: any, extra: any = {}) => engine.listMessages({ folderId: inbox.id, adv, ...extra }).map((m) => m.subject).sort()
  assert.equal(A({ from: 'nguyen van an' }).length, 4, 'người gửi: gõ không dấu khớp tên có dấu')
  assert.equal(A({ from: 'AN@CONGTY' }).length, 4, 'người gửi: khớp theo một phần địa chỉ, không phân biệt hoa thường')
  assert.equal(A({ from: 'khong-co-ai' }).length, 0)
  assert.deepEqual(A({ subject: 'bao cao quy' }), ['Báo cáo doanh thu quý 3'])
  assert.deepEqual(A({ to: 'testuser', hasAttachment: true }), ['Hợp đồng kèm tệp'])
  assert.deepEqual(A({ read: 'read' }), ['Báo cáo doanh thu quý 3'])
  assert.equal(A({ read: 'unread' }).length, 3)
  assert.deepEqual(A({ dateTo: Date.now() - 100 * 86400000 }), ['Thư cũ năm ngoái'])
  assert.deepEqual(A({ dateFrom: Date.now() - 36 * 3600000, dateTo: Date.now() - 12 * 3600000 }), ['Lịch họp tuần'])
  assert.deepEqual(A({ without: 'giao doanh' }), ['Hợp đồng kèm tệp', 'Thư cũ năm ngoái'], 'loại thư chứa bất kỳ từ nào trong ô “Không có”')
  assert.deepEqual(A({ sizeOp: 'gt', sizeMb: 0.0006 }), ['Hợp đồng kèm tệp'])
  assert.equal(A({ sizeOp: 'lt', sizeMb: 0.0006 }).length, 3)
  assert.deepEqual(A({ from: 'an', subject: 'lich' }, { search: 'giao ban' }), ['Lịch họp tuần'], 'kết hợp nhiều ô + từ khoá')
  assert.equal(A({ cc: 'ai-do' }).length, 0)
  assert.equal(engine.listMessages({ adv: { subject: "x' OR 1=1 --" } }).length, 0, 'giá trị lạ không phá câu truy vấn')
  assert.deepEqual(A({ from: 'an' }, { filter: 'unread' }).length, 3, 'thẻ lọc nhanh áp dụng cùng tìm kiếm')
  assert.deepEqual(engine.listMessages({ folderId: inbox.id, search: 'bao cao', filter: 'unread' }).length, 0, 'tìm nhanh trong thẻ Chưa đọc chỉ ra thư chưa đọc')
  assert.deepEqual(engine.listMessages({ folderId: inbox.id, search: 'hop dong', filter: 'attachments' }).length, 1)
  ok('tìm kiếm nâng cao: người gửi/nhận, chủ đề, ngày, đã đọc, tệp đính kèm, kích thước, loại trừ từ')

  assert.equal(engine.listMessages({ virtual: 'all-inbox', filter: 'unread' }).length, 3)
  assert.equal(engine.listMessages({ folderId: inbox.id, filter: 'attachments' }).length, 1)
  ok('hộp thư gộp và bộ lọc')

  console.log('Thao tác')
  const m2 = list.find((m) => m.subject === 'Lịch họp tuần')!
  engine.setFlag([m2.id], 'seen', true)
  engine.setFlag([m2.id], 'flagged', true)
  await until(async () => (await serverUids('INBOX', '\\Flagged')).includes(m2.uid), 'cờ lên máy chủ')
  assert.ok((await serverUids('INBOX', '\\Seen')).includes(m2.uid))
  ok('đánh dấu đã đọc / gắn cờ được đẩy lên máy chủ')

  const oldMsg = list.find((m) => m.subject === 'Thư cũ năm ngoái')!
  engine.setPinned([oldMsg.id], true)
  let top = engine.listMessages({ folderId: inbox.id })[0]
  assert.ok(top.id === oldMsg.id && top.pinned, 'thư ghim phải lên đầu dù là thư cũ nhất')
  // thư trả lời trong cùng hội thoại về sau cũng phải tự được ghim
  await serverAppend('INBOX', mail(40, 'RE: Thư cũ năm ngoái', 'Trả lời trong hội thoại đã ghim.', 0).replace('MIME-Version', 'In-Reply-To: <m4@congty.vn>\r\nReferences: <m4@congty.vn>\r\nMIME-Version'))
  await until(() => engine.listMessages({ folderId: inbox.id }).some((m) => m.subject === 'RE: Thư cũ năm ngoái' && m.snippet !== ''), 'thư trả lời về')
  const pinnedNow = engine.listMessages({ folderId: inbox.id }).filter((m) => m.pinned)
  assert.deepEqual(pinnedNow.map((m) => m.subject).sort(), ['RE: Thư cũ năm ngoái', 'Thư cũ năm ngoái'])
  engine.setPinned([pinnedNow.find((m) => m.subject.startsWith('RE:'))!.id], false)
  assert.equal(engine.listMessages({ folderId: inbox.id }).filter((m) => m.pinned).length, 0, 'bỏ ghim một thư = bỏ ghim cả hội thoại')
  top = engine.listMessages({ folderId: inbox.id })[0]
  assert.equal(top.subject, 'RE: Thư cũ năm ngoái')
  // Gom hội thoại: thư gốc + thư trả lời chung một khoá, đếm đúng, lấy được cả chuỗi
  assert.equal(top.threadKey, '<m4@congty.vn>')
  assert.equal(top.threadCount, 2)
  assert.equal(engine.listMessages({ folderId: inbox.id }).find((m) => m.subject === 'Lịch họp tuần')!.threadCount, 1)
  // thư trả lời tiếp chỉ có In-Reply-To (không có References) vẫn phải về đúng hội thoại gốc
  await serverAppend('INBOX', mail(41, 'RE: RE: Thư cũ năm ngoái', 'Trả lời lần hai.', 0).replace('MIME-Version', 'In-Reply-To: <m40@congty.vn>\r\nMIME-Version'))
  await until(() => engine.listMessages({ folderId: inbox.id }).some((m) => m.subject === 'RE: RE: Thư cũ năm ngoái'), 'thư trả lời lần hai')
  const conv = engine.listThread(acc.id, '<m4@congty.vn>', inbox.id)
  assert.deepEqual(conv.map((m) => m.subject), ['RE: RE: Thư cũ năm ngoái', 'RE: Thư cũ năm ngoái', 'Thư cũ năm ngoái'])
  assert.ok(conv.every((m) => m.threadCount === 3))
  assert.deepEqual(engine.listThread(acc.id, ''), [])
  // Lọc theo thẻ khi xem theo hội thoại: chỉ lấy thư khớp, kể cả thư mình đã gửi (ở Thư đã gửi) thuộc hội thoại này
  const sentF = f('sent')
  await serverAppend('Sent', mail(42, 'RE: Thư cũ năm ngoái (mình gửi)', 'Mình trả lời.', 0).replace('MIME-Version', 'References: <m4@congty.vn>\r\nMIME-Version'))
  await serverAppend('Sent', mail(43, 'Thư gửi không liên quan', 'Khác hội thoại.', 0))
  await (engine as any).sync(acc.id).syncFolder(sentF.id)
  const mine = engine.listMessages({ folderId: sentF.id })
  assert.equal(mine.length, 2)
  engine.setFlag(mine.map((m) => m.id), 'flagged', true)
  engine.setFlag([conv[1].id], 'flagged', true)
  const subj = (q: object) => engine.listMessages({ folderId: inbox.id, ...q }).map((m) => m.subject).filter((x) => x !== 'Lịch họp tuần')
  assert.deepEqual(subj({ filter: 'flagged' }), ['RE: Thư cũ năm ngoái'], 'không xem theo hội thoại: chỉ thư trong thư mục')
  assert.deepEqual(subj({ filter: 'flagged', threads: true }).sort(), ['RE: Thư cũ năm ngoái', 'RE: Thư cũ năm ngoái (mình gửi)'])
  engine.setFlag([conv[1].id], 'flagged', false)
  assert.deepEqual(subj({ filter: 'flagged', threads: true }), ['RE: Thư cũ năm ngoái (mình gửi)'], 'thư đã gửi có cờ vẫn hiện dù thư đến không có cờ')
  assert.ok(!subj({ threads: true }).some((x) => x.includes('mình gửi')), 'không lọc thì danh sách thư mục giữ nguyên')
  assert.deepEqual(subj({ search: 'mình trả lời', threads: true }), ['RE: Thư cũ năm ngoái (mình gửi)'])
  await engine.deleteMessages(mine.map((m) => m.id), true)
  await until(async () => (await serverUids('Sent')).length === 0, 'dọn thư gửi thử')
  ok('lọc Chưa đọc / Có cờ / Có tệp theo hội thoại: chỉ thư khớp, gồm cả thư đã gửi trong hội thoại')
  await engine.deleteMessages([conv[0].id], true)
  await engine.deleteMessages([top.id], true)
  await until(async () => (await serverUids('INBOX')).length === 4, 'xoá thư trả lời thử')
  ok('ghim cuộc hội thoại: lên đầu danh sách, thư trả lời mới tự ghim theo, bỏ ghim cả chuỗi')
  ok('gom hội thoại: thư gốc và các thư trả lời chung một cuộc, kể cả thư chỉ có In-Reply-To')

  // Ảnh đính kèm kiểu Gmail điện thoại / Outlook: có Content-ID và "inline" nhưng nội dung thư không hề dùng tới
  const phonePhoto = [
    'Content-Type: multipart/mixed; boundary="P1"',
    '',
    '--P1',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Gui anh anh chup man hinh</p>',
    '--P1',
    'Content-Type: image/png; name="man-hinh.png"',
    'Content-ID: <ii_abc123>',
    'Content-Disposition: inline; filename="man-hinh.png"',
    'Content-Transfer-Encoding: base64',
    '',
    png,
    '--P1--',
    ''
  ].join('\r\n')
  await serverAppend('INBOX', mail(42, 'Ảnh chụp màn hình', '', 0, phonePhoto))
  await until(() => !!engine.listMessages({ folderId: inbox.id }).find((m) => m.subject === 'Ảnh chụp màn hình')?.snippet, 'thư có ảnh đính kèm')
  const photo = engine.listMessages({ folderId: inbox.id }).find((m) => m.subject === 'Ảnh chụp màn hình')!
  assert.ok(photo.hasAttachments, 'danh sách thư phải hiện biểu tượng đính kèm')
  const photoDetail = (await engine.getMessage(photo.id))!
  assert.deepEqual(photoDetail.attachments.map((a) => [a.filename, a.inline]), [['man-hinh.png', false]])
  // còn ảnh thật sự nhúng trong nội dung (thư m3) vẫn là ảnh nhúng, không lặp lại trong danh sách tệp
  assert.deepEqual(m3.attachments.filter((a) => a.inline).map((a) => a.filename), ['logo.png'])
  await engine.deleteMessages([photo.id], true)
  await until(async () => (await serverUids('INBOX')).length === 4, 'xoá thư ảnh thử')
  ok('tệp đính kèm: ảnh gắn kèm bị đánh dấu “inline” nhưng không dùng trong nội dung vẫn hiện là tệp đính kèm')

  const proj = folders.find((x) => x.path === 'Du an/Khach hang A')!
  await engine.moveMessages([m2.id], proj.id)
  await until(() => engine.listMessages({ folderId: proj.id }).length === 1, 'thư xuất hiện ở thư mục đích')
  assert.equal((await serverUids('Du an/Khach hang A')).length, 1)
  assert.equal(engine.listMessages({ folderId: inbox.id }).length, 3)
  const moved = engine.listMessages({ folderId: proj.id })[0]
  assert.ok(moved.flagged && moved.seen)
  ok('chuyển thư sang thư mục khác, giữ nguyên cờ')

  const old = list.find((m) => m.subject === 'Thư cũ năm ngoái')!
  await engine.deleteMessages([old.id])
  const trash = f('trash')
  await until(() => engine.listMessages({ folderId: trash.id }).length === 1, 'thư vào thùng rác')
  await engine.emptyFolder(trash.id)
  await until(async () => (await serverUids('Trash')).length === 0, 'dọn thùng rác')
  ok('xoá vào Thùng rác rồi dọn sạch Thùng rác')

  console.log('Gửi thư')
  const tmpAtt = path.join(dataDir, 'ghi-chu.txt')
  fs.writeFileSync(tmpAtt, 'xin chào')
  await engine.send({
    accountId: acc.id,
    to: '"Trần Bình" <binh@doitac.vn>; lan@doitac.vn',
    cc: '',
    bcc: 'sep@congty.vn',
    subject: 'RE: Hợp đồng kèm tệp',
    html: '<p>Đã nhận, cảm ơn anh.</p>',
    attachments: [
      { filename: 'ghi-chu.txt', path: tmpAtt, size: 8 },
      { filename: 'bao-cao.csv', size: 11, fromAttachmentId: atts[0].id }
    ],
    inReplyTo: m3.messageId,
    references: m3.messageId,
    sourceMessageId: m3.id,
    mode: 'reply'
  })
  assert.equal(received.length, 1)
  assert.deepEqual(received[0].to.sort(), ['binh@doitac.vn', 'lan@doitac.vn', 'sep@congty.vn'])
  assert.ok(!/^Bcc:/im.test(received[0].raw), 'Bcc không được lộ trong thư gửi đi')
  assert.match(received[0].raw, /In-Reply-To: <m3@congty.vn>/)
  assert.match(received[0].raw, /bao-cao\.csv/)
  ok('gửi qua SMTP: đủ người nhận, ẩn Bcc, kèm tệp mới và tệp chuyển tiếp')

  const sent = f('sent')
  await until(() => engine.listMessages({ folderId: sent.id }).length === 1, 'bản sao trong Thư đã gửi')
  await until(async () => (await serverUids('INBOX', '\\Answered')).includes(m3.uid), 'cờ đã trả lời')
  assert.ok(engine.listContacts('binh').some((c) => c.email === 'binh@doitac.vn' && c.name === 'Trần Bình'))
  ok('lưu bản sao vào Thư đã gửi, đánh dấu đã trả lời, tự thêm danh bạ')

  await engine.saveDraft({ accountId: acc.id, to: 'x@y.vn', cc: '', bcc: '', subject: 'Nháp thử', html: '<p>đang viết</p>', attachments: [] })
  const drafts = f('drafts')
  await until(() => engine.listMessages({ folderId: drafts.id }).length === 1, 'thư nháp')
  assert.ok(engine.listMessages({ folderId: drafts.id })[0].draft)
  ok('lưu thư nháp lên máy chủ')

  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
  assert.equal(safeFileName('C:\\Users\\a\\bao cao: quy 3?.xlsx'), 'bao cao_ quy 3_.xlsx')
  assert.equal(safeFileName('CON.txt'), 'tep-dinh-kem.txt')
  assert.equal(safeFileName(''), 'tep-dinh-kem')
  ok('tên tệp đính kèm được làm sạch (không thoát thư mục, hợp lệ trên Windows)')

  console.log('Quy tắc + thư mới')
  await serverAppend('INBOX', mail(9, 'Thư đẩy tức thời', 'Không cần bấm Gửi/Nhận.', 0))
  await until(() => engine.listMessages({ folderId: inbox.id }).some((m) => m.subject === 'Thư đẩy tức thời'), 'thư mới qua IDLE', 12000)
  ok('thư mới tự về qua kết nối đẩy (IMAP IDLE), không cần đồng bộ thủ công')
  engine.saveRule({
    name: 'Hoá đơn',
    enabled: true,
    accountId: null,
    match: 'all',
    conditions: [{ field: 'subject', op: 'contains', value: 'hoá đơn' }],
    actions: [{ type: 'category', value: 'Đỏ' }, { type: 'move', folderPath: 'Du an' }],
    sort: 0
  })
  events.length = 0
  await serverAppend('INBOX', mail(10, 'Hoá đơn tháng 10', 'Đính kèm hoá đơn.', 0))
  await serverAppend('INBOX', mail(11, 'Chào bạn', 'Thư thường.', 0))
  await engine.syncAccount(acc.id)
  await until(() => events.some((e) => e.type === 'new-mail' && e.subject === 'Chào bạn'), 'thông báo thư mới')
  const duan = folders.find((x) => x.path === 'Du an')!
  await until(() => engine.listMessages({ folderId: duan.id }).length === 1, 'quy tắc chuyển thư')
  assert.ok(engine.listMessages({ folderId: inbox.id }).some((m) => m.subject === 'Chào bạn'))
  assert.equal(engine.listMessages({ search: 'hoa don dinh kem' }).length, 1, 'gõ "d" phải khớp "đ"')
  assert.equal(engine.listMessages({ search: 'Đính kèm hoá đơn' }).length, 1)
  const notes = events.filter((e) => e.type === 'new-mail')
  assert.ok(notes.some((e) => e.subject === 'Chào bạn'))
  assert.ok(!notes.some((e) => e.subject.startsWith('Hoá đơn')), 'thư đã bị quy tắc chuyển đi thì không báo')
  ok('quy tắc tự chuyển thư khớp điều kiện; chỉ báo thư mới còn lại trong Hộp thư đến')
  {
    // đổi thứ tự thư mục: lưu trên máy và giữ nguyên sau khi đồng bộ lại danh sách thư mục từ máy chủ
    const fs0 = engine.listFolders().filter((f) => f.accountId === acc.id)
    const ids = fs0.map((f) => f.id).reverse()
    engine.reorderFolders(ids)
    await engine.syncAccount(acc.id)
    const after = engine.listFolders().filter((f) => f.accountId === acc.id)
    assert.ok(after.every((f) => f.sortOrder === ids.indexOf(f.id) + 1), 'đồng bộ lại không được xoá thứ tự đã kéo thả')
    assert.ok(events.some((e) => e.type === 'folders-changed'))
  }
  ok('kéo thả đổi thứ tự thư mục, giữ nguyên sau khi đồng bộ lại')

  engine.saveRule({
    name: 'Chuyển sếp',
    enabled: true,
    accountId: null,
    match: 'all',
    conditions: [{ field: 'subject', op: 'contains', value: 'chuyển giúp' }],
    actions: [{ type: 'forward', to: 'sep@congty.vn; thuky@congty.vn' }, { type: 'markRead' }],
    sort: 1
  })
  const before = received.length
  await serverAppend('INBOX', mail(12, 'Nhờ chuyển giúp hồ sơ', '', 0, withAttachment))
  await until(() => received.length === before + 1, 'quy tắc chuyển tiếp gửi thư')
  const fw = received[received.length - 1]
  assert.deepEqual(fw.to.sort(), ['sep@congty.vn', 'thuky@congty.vn'])
  assert.match(fw.raw, /X-MailLite-Auto-Forwarded: 1/i)
  assert.ok(fw.raw.includes('bao-cao.csv'), 'chuyển tiếp phải kèm tệp đính kèm')
  const fwParsed = await require('mailparser').simpleParser(fw.raw)
  assert.equal(fwParsed.subject, 'FW: Nhờ chuyển giúp hồ sơ')
  await until(() => !!engine.listMessages({ folderId: inbox.id }).find((m) => m.subject === 'Nhờ chuyển giúp hồ sơ')?.seen, 'hành động tiếp theo của quy tắc')
  assert.ok((await engine.runRules(inbox.id)) >= 1)
  await wait(500)
  assert.equal(received.length, before + 1, 'chạy quy tắc thủ công không được chuyển tiếp lại')
  ok('quy tắc “chuyển tiếp thư”: gửi kèm tệp tới nhiều địa chỉ, không gửi lại khi chạy thủ công')

  console.log('Hoàn tác gửi')
  const quick = { accountId: acc.id, to: 'nham@doitac.vn', cc: '', bcc: '', subject: 'Gửi nhầm', html: '<p>ôi</p>', attachments: [] }
  const n0 = received.length
  const pid = engine.sendLater(quick, 60)
  await wait(300)
  const back = engine.cancelSend(pid)
  assert.equal(back?.subject, 'Gửi nhầm')
  assert.equal(engine.cancelSend(pid), null)
  await wait(300)
  assert.equal(received.length, n0, 'thư đã hoàn tác không được gửi đi')
  events.length = 0
  engine.sendLater({ ...quick, subject: 'Gửi sau 1 giây' }, 1)
  assert.equal(received.length, n0)
  await until(() => events.some((e) => e.type === 'send-result' && e.ok), 'thư tự gửi khi hết thời gian chờ', 8000)
  assert.equal(received.length, n0 + 1)
  assert.throws(() => engine.sendLater({ ...quick, to: '' }, 5), /người nhận/)
  ok('hoàn tác gửi: lấy lại được thư trong thời gian chờ, hết giờ thì tự gửi')

  // Phạm vi tìm kiếm (không phụ thuộc thư mục đang mở)
  const S = (scope: any, extra: any = {}) => engine.listMessages({ folderId: drafts.id, adv: { scope, ...extra } })
  await until(() => engine.listMessages({ folderId: sent.id }).length >= 3, 'Thư đã gửi đồng bộ xong')
  const nInbox = engine.listMessages({ folderId: inbox.id }).length
  const nSent = engine.listMessages({ folderId: sent.id }).length
  const nDrafts = engine.listMessages({ folderId: drafts.id }).length
  await engine.deleteMessages([engine.listMessages({ folderId: inbox.id }).find((m) => m.subject === 'Chào bạn')!.id])
  await until(() => engine.listMessages({ folderId: trash.id }).length === 1, 'một thư vào thùng rác')
  assert.equal(S('inbox').length, nInbox - 1)
  assert.equal(S('sent').length, nSent)
  assert.ok(nSent >= 2 && S('sent').every((m) => m.folderId === sent.id))
  assert.equal(S('drafts').length, nDrafts)
  assert.deepEqual(S('trash').map((m) => m.subject), ['Chào bạn'])
  assert.equal(S('junk').length, 0)
  const everything = S('everything').length
  assert.equal(S('all').length, everything - 1, '“Tất cả thư” không gồm Thùng rác/Thư rác')
  assert.ok(S('all').every((m) => m.folderId !== trash.id))
  assert.equal(S('read').length + S('unread').length, S('all').length)
  assert.ok(S('unread').every((m) => !m.seen) && S('read').every((m) => m.seen))
  assert.ok(S('flagged').length >= 1 && S('flagged').every((m) => m.flagged))
  assert.equal(S('sent', { subject: 'hop dong' }).length, 1, 'phạm vi kết hợp với điều kiện khác')
  assert.equal(engine.listMessages({ folderId: drafts.id, adv: { scope: 'folder' } }).length, nDrafts)
  ok('phạm vi tìm kiếm: tất cả thư, hộp thư đến, đã gửi, nháp, rác, thùng rác, có cờ, đã đọc/chưa đọc')

  console.log('Xoá toàn bộ thư trong thư mục')
  const kha = folders.find((x) => x.path === 'Du an/Khach hang A')!
  await serverAppend('Du an/Khach hang A', mail(13, 'Thư chưa kịp đồng bộ', 'x', 0)) // có trên máy chủ nhưng chưa về máy
  assert.equal(engine.listMessages({ folderId: kha.id }).length, 1)
  assert.equal(await engine.emptyFolder(kha.id), 'trashed')
  assert.equal(engine.listMessages({ folderId: kha.id }).length, 0)
  await until(async () => (await serverUids('Du an/Khach hang A')).length === 0, 'thư mục trống trên máy chủ')
  await until(async () => (await serverUids('Trash')).length === 3, 'thư vào thùng rác trên máy chủ')
  await until(() => engine.listMessages({ folderId: trash.id }).length === 3, 'thùng rác hiện đủ thư')
  assert.equal(await engine.emptyFolder(trash.id), 'deleted')
  await until(async () => (await serverUids('Trash')).length === 0, 'thùng rác trống')
  assert.equal(await engine.emptyFolder(trash.id), 'deleted') // thư mục đã trống: không lỗi
  await wait(300)
  assert.equal(engine.store.pendingOps(acc.id).length, 0)
  ok('xoá nhanh cả thư mục: thư thường vào Thùng rác, Thùng rác xoá vĩnh viễn, tính cả thư chưa đồng bộ')

  console.log('Xuất dữ liệu, danh bạ, lịch')
  const mbox = path.join(dataDir, 'inbox.mbox')
  const n = await engine.exportMbox(inbox.id, mbox)
  assert.equal(n, engine.listMessages({ folderId: inbox.id }).length)
  assert.equal(fs.readFileSync(mbox, 'latin1').match(/^From /gm)?.length, n)
  ok(`xuất ${n} thư ra .mbox`)

  engine.saveContact({ name: 'Lê Chi', email: 'chi@abc.vn', company: 'ABC' })
  assert.throws(() => engine.saveContact({ email: 'khong-hop-le' }))
  assert.equal(engine.listContacts('ABC').length, 1)
  const now = Date.now()
  const evId = engine.saveEvent({ title: 'Họp dự án', location: 'P.301', start: now + 600000, end: now + 4200000, allDay: false, notes: '', reminderMin: 15, color: '#0f6cbd' })
  assert.equal(engine.listEvents(now, now + 86400000).length, 1)
  assert.equal(engine.store.dueReminders(now).length, 1)
  assert.equal(engine.store.dueReminders(now).length, 0)
  engine.deleteEvent(evId)
  ok('danh bạ, lịch và nhắc việc')

  console.log('Trộn thư')
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Công nợ')
  ws.addRow(['Họ tên', 'Email', 'Công ty', 'Số tiền', 'Hạn', 'Tệp', 'Tỷ lệ'])
  ws.addRow(['Trần Thị Mai', 'mai@kh1.vn', 'Công ty <A&B>', 15500000, new Date(Date.UTC(2026, 9, 15)), 'hd/mai.txt', 0.125])
  ws.addRow(['Lê Nam', 'nam@kh2.vn; ketoan@kh2.vn', 'Kho Vận Nam', { formula: 'D2*2', result: 31000000 }, new Date(Date.UTC(2026, 10, 1)), '', 0.5])
  ws.addRow([])
  ws.addRow(['Không Email', '', 'X', 1, null, '', 0])
  ws.addRow(['Sai Email', 'khong-phai-email', 'Y', 2, null, '', 0])
  ws.addRow(['Thiếu Tệp', 'thieu@kh3.vn', 'Z', 3, null, 'hd/khong-co.pdf', 0])
  ws.addRow(['Phạm Bảo', { text: 'bao@kh4.vn', hyperlink: 'mailto:bao@kh4.vn' }, 'Bảo Tín', 2000000.5, null, '', 1])
  ws.getColumn(4).numFmt = '#,##0'
  ws.getColumn(7).numFmt = '0.0%'
  wb.addWorksheet('Trang khác').addRow(['a'])
  const xlsx = path.join(dataDir, 'cong-no.xlsx')
  await wb.xlsx.writeFile(xlsx)
  fs.mkdirSync(path.join(dataDir, 'hd'))
  fs.writeFileSync(path.join(dataDir, 'hd', 'mai.txt'), 'hoá đơn của Mai')

  const data = await engine.mergeRead(xlsx)
  assert.deepEqual(data.sheets, ['Công nợ', 'Trang khác'])
  assert.deepEqual(data.columns, ['Họ tên', 'Email', 'Công ty', 'Số tiền', 'Hạn', 'Tệp', 'Tỷ lệ'])
  assert.equal(data.rows.length, 6)
  assert.deepEqual(data.rowNumbers, [2, 3, 5, 6, 7, 8])
  assert.deepEqual(data.rows[0].slice(3, 5), ['15.500.000', '15/10/2026'])
  assert.equal(data.rows[0][6], '12,5%')
  assert.equal(data.rows[1][3], '31.000.000', 'ô công thức lấy kết quả')
  assert.equal(data.rows[5][1], 'bao@kh4.vn', 'ô có liên kết lấy chữ hiển thị')
  await assert.rejects(() => engine.mergeRead(path.join(dataDir, 'x.xls')), /\.xls/)
  ok('đọc .xlsx: tiêu đề cột, bỏ dòng trống, định dạng số/ngày/phần trăm, công thức, liên kết')

  assert.deepEqual(parseCsv('﻿Tên;Email;Ghi chú\r\n"Nguyễn; Văn A";a@b.vn;"dòng 1\ndòng ""2"""\r\nB;b@b.vn;\r\n'), [
    ['Tên', 'Email', 'Ghi chú'],
    ['Nguyễn; Văn A', 'a@b.vn', 'dòng 1\ndòng "2"'],
    ['B', 'b@b.vn', '']
  ])
  const csvFile = path.join(dataDir, 'ds.csv')
  fs.writeFileSync(csvFile, 'Ten,Mail\nAn,an@x.vn\n')
  assert.deepEqual((await engine.mergeRead(csvFile)).rows, [['An', 'an@x.vn']])
  ok('đọc .csv: tự nhận dấu phân cách, ô có ngoặc kép và xuống dòng')

  const rec = rowRecord(['Họ tên', 'Công ty'], ['Mai', '<b>A&B</b>\nTầng 2'])
  assert.equal(renderTemplate('Chào {{ họ  TÊN }} - {{Công ty}} - {{Lạ}}', rec, false), 'Chào Mai - <b>A&B</b> Tầng 2 - {{Lạ}}')
  assert.equal(renderTemplate('<p>{{Họ&nbsp;tên}}: {{<b>Công ty</b>}}</p>', rec, true), '<p>Mai: &lt;b&gt;A&amp;B&lt;/b&gt;<br>Tầng 2</p>')
  assert.deepEqual(templateFields('{{A}} {{ a }} {{B}} {{}}'), ['a', 'B'])
  ok('ghép mẫu: không phân biệt hoa thường, giá trị được escape trong HTML, trường lạ giữ nguyên')

  const commonFile = path.join(dataDir, 'bang-gia.txt')
  fs.writeFileSync(commonFile, 'bảng giá chung')
  const job: MergeJob = {
    accountId: acc.id,
    subject: 'Thông báo công nợ {{Công ty}} — {{Số tiền}}đ',
    html: '<p>Kính gửi anh/chị <b>{{Họ tên}}</b>,</p><p>Số tiền {{Số tiền}}đ, hạn {{Hạn}}.</p>',
    columns: data.columns,
    rows: data.rows,
    rowNumbers: data.rowNumbers,
    toColumn: 'Email',
    attachColumn: 'Tệp',
    baseDir: data.baseDir,
    attachments: [{ path: commonFile, filename: 'bang-gia.txt', size: 14 }],
    delayMs: 0
  }
  const check = await engine.mergeCheck({ ...job, subject: job.subject + ' {{Mã KH}}' })
  assert.equal(check.sendable, 3)
  assert.deepEqual(check.unknownFields, ['Mã KH'])
  assert.deepEqual(
    check.issues.map((i) => [i.row, i.level]),
    [[5, 'skip'], [6, 'error'], [7, 'error']]
  )
  assert.match(check.issues[2].message, /khong-co\.pdf/)
  ok('rà soát trước khi gửi: dòng thiếu email, email sai, tệp đính kèm không tồn tại, trường không khớp cột')

  received.length = 0
  assert.equal(await engine.mergeTest(job, 0), 'testuser@example.com')
  assert.deepEqual(received[0].to, ['testuser@example.com'])
  assert.match(received[0].raw, /Subject: =\?UTF-8\?.*\r?\n?/)
  assert.ok(received[0].raw.includes('mai.txt') && received[0].raw.includes('bang-gia.txt'))
  ok('gửi thử một dòng về chính hộp thư của mình')

  received.length = 0
  events.length = 0
  await engine.mergeStart(job)
  assert.throws(() => engine.mergeStart(job), /Đang có một đợt/)
  await until(() => engine.mergeStatus()?.running === false, 'trộn thư xong')
  const st = engine.mergeStatus()!
  assert.deepEqual(
    st.results.map((r) => [r.row, r.status]),
    [[2, 'sent'], [3, 'sent'], [5, 'skipped'], [6, 'failed'], [7, 'failed'], [8, 'sent']]
  )
  assert.equal(received.length, 3)
  assert.deepEqual(received.map((r) => r.to), [['mai@kh1.vn'], ['nam@kh2.vn', 'ketoan@kh2.vn'], ['bao@kh4.vn']])
  const { simpleParser } = require('mailparser')
  const first = await simpleParser(received[0].raw)
  assert.equal(first.subject, 'Thông báo công nợ Công ty <A&B> — 15.500.000đ')
  assert.ok(first.html.includes('<b>Trần Thị Mai</b>') && first.html.includes('hạn 15/10/2026'))
  assert.deepEqual(first.attachments.map((a: any) => a.filename).sort(), ['bang-gia.txt', 'mai.txt'])
  const second = await simpleParser(received[1].raw)
  assert.deepEqual(second.attachments.map((a: any) => a.filename), ['bang-gia.txt'])
  assert.ok(!received[1].raw.includes('mai@kh1.vn'), 'người nhận không thấy địa chỉ của người khác')
  assert.equal(events.filter((e) => e.type === 'merge-progress' && e.last).length, 6)
  await until(() => engine.listMessages({ folderId: sent.id }).length >= 4, 'bản sao trộn thư trong Thư đã gửi')
  ok('gửi hàng loạt: mỗi người một thư riêng, đúng nội dung + tệp riêng, bỏ qua/báo lỗi từng dòng, lưu Thư đã gửi')

  received.length = 0
  await engine.mergeStart({ ...job, rows: [data.rows[0], data.rows[1], data.rows[5]], rowNumbers: [2, 3, 8], delayMs: 60000 })
  await until(() => received.length === 1, 'thư đầu của đợt 2')
  await engine.mergeCancel()
  await until(() => engine.mergeStatus()?.running === false, 'dừng trộn thư', 3000)
  assert.equal(received.length, 1)
  assert.equal(engine.mergeStatus()!.results.length, 1)
  assert.match(engine.mergeStatus()!.stopped ?? '', /dừng/)
  assert.equal(engine.mergeStatus()!.remaining, 2)
  ok('bấm dừng giữa chừng: dừng ngay cả khi đang nghỉ giữa hai thư, không gửi thêm')

  console.log('Đổi nơi lưu dữ liệu + nâng cấp CSDL cũ')
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'maillite-ud-'))
  assert.deepEqual(resolveDataDir(ud), { dir: path.join(ud, 'data'), custom: false })
  const srcDir = path.join(ud, 'data')
  fs.mkdirSync(path.join(srcDir, 'mail', '1'), { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'maillite.db'), 'db')
  fs.writeFileSync(path.join(srcDir, 'mail', '1', '5.eml'), 'x'.repeat(1000))
  const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'maillite-d-'))
  assert.deepEqual(planTarget(drive), { target: drive, existing: false }) // thư mục trống: dùng luôn
  fs.writeFileSync(path.join(drive, 'tai-lieu-khac.txt'), 'x')
  const plan = planTarget(drive) // đã có tệp khác: tạo thư mục con, không trộn lẫn
  assert.deepEqual(plan, { target: path.join(drive, 'Mail Lite Data'), existing: false })
  assert.deepEqual(await copyData(srcDir, plan.target), { files: 2, bytes: 1002 })
  assert.equal(fs.readFileSync(path.join(plan.target, 'mail', '1', '5.eml'), 'utf8').length, 1000)
  await assert.rejects(() => copyData(srcDir, path.join(srcDir, 'ben-trong')), /bên trong/)
  assert.deepEqual(planTarget(drive), { target: plan.target, existing: true }) // lần sau trỏ lại ổ đó: nhận ra dữ liệu có sẵn
  writeConfig(ud, { dataDir: plan.target })
  assert.deepEqual(resolveDataDir(ud), { dir: plan.target, custom: true })
  assert.deepEqual(resolveDataDir(ud, '/tmp/x').dir, path.resolve('/tmp/x'))
  writeConfig(ud, {})
  assert.deepEqual(readConfig(ud), {})
  assert.equal(resolveDataDir(ud).custom, false)
  fs.writeFileSync(path.join(ud, 'config.json'), '{hỏng')
  assert.equal(resolveDataDir(ud).custom, false, 'tệp cấu hình hỏng không được làm app không mở được')
  ok('đổi nơi lưu: chọn đích an toàn, chép đủ và đối chiếu, nhớ vị trí mới, quay về mặc định')

  // CSDL của bản trước (chưa có cột ghim/hội thoại) phải được nâng cấp tại chỗ, không mất thư
  const oldDb = path.join(ud, 'old.db')
  new Store(oldDb).close()
  const raw = new DatabaseSync(oldDb)
  raw.exec('DROP INDEX idx_msg_thread; DROP TABLE pinned_threads; ALTER TABLE messages DROP COLUMN pinned; ALTER TABLE messages DROP COLUMN thread_key')
  raw.exec(`INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username) VALUES('a','a@b.vn','h',993,'h',465,'a');
    INSERT INTO folders(account_id,path,name) VALUES(1,'INBOX','INBOX');
    INSERT INTO messages(account_id,folder_id,uid,message_id,in_reply_to,refs,subject) VALUES
      (1,1,1,'<root@x>','','','Gốc'), (1,1,2,'<r2@x>','<r1@x>','<root@x> <r1@x>','Trả lời 2'), (1,1,3,'<solo@x>','','','Riêng')`)
  // dữ liệu do bản cũ ghi: ảnh đính kèm bị đánh dấu nhầm là ảnh nhúng
  raw.exec(`INSERT INTO messages(account_id,folder_id,uid,message_id,subject,body_fetched,body_html,has_attachments) VALUES
      (1,1,4,'<a4@x>','Ảnh kèm',1,'<p>khong dung cid</p>',0), (1,1,5,'<a5@x>','Ảnh nhúng',1,'<img src="cid:real1">',0);
    INSERT INTO attachments(message_id,idx,filename,content_type,content_id,inline) VALUES (4,0,'anh.png','image/png','abc',1), (5,0,'logo.png','image/png','real1',1);
    DELETE FROM settings WHERE key = '_fix_inline_1'`)
  raw.close()
  const up = new Store(oldDb)
  assert.deepEqual(up.getAttachments(4).map((a) => a.inline), [0], 'ảnh đính kèm bị ẩn ở bản cũ phải hiện lại')
  assert.deepEqual(up.getAttachments(5).map((a) => a.inline), [1])
  assert.deepEqual(up.listMessages({ folderId: 1, filter: 'attachments' }).map((m) => m.subject), ['Ảnh kèm'])
  assert.ok(!('_fix_inline_1' in up.getSettings()))
  up.setPinned([2], true)
  assert.deepEqual(up.listMessages({ folderId: 1 }).filter((m) => !m.subject.startsWith('Ảnh')).map((m) => [m.subject, m.pinned]).sort(), [['Gốc', true], ['Riêng', false], ['Trả lời 2', true]])
  up.close()
  ok('cơ sở dữ liệu của bản cũ được nâng cấp tại chỗ, giữ nguyên thư')

  console.log('Khởi động lại (offline)')
  const nBeforeQuit = received.length
  engine.sendLater({ accountId: acc.id, to: 'kip@doitac.vn', cc: '', bcc: '', subject: 'Đang chờ thì thoát app', html: '<p>x</p>', attachments: [] }, 600)
  await engine.stop()
  assert.equal(received.length, nBeforeQuit + 1, 'thư đang chờ hoàn tác phải được gửi nốt khi thoát app')
  await new Promise<void>((r) => imapServer.close(() => r()))
  const offline = new Engine({
    dataDir,
    encrypt: (s) => 'enc:' + Buffer.from(s).toString('base64'),
    decrypt: (s) => Buffer.from(s.slice(4), 'base64').toString(),
    openExternal: () => undefined,
    emit: () => undefined
  })
  // Đợt trộn thư dở phải còn nguyên sau khi mở lại, và gửi tiếp chỉ gửi các dòng chưa gửi
  let m = offline.mergeStatus()!
  assert.equal(m.running, false)
  assert.deepEqual([m.total, m.results.length, m.remaining], [3, 1, 2])
  assert.equal(m.results[0].status, 'sent')
  assert.match(m.subject, /Thông báo công nợ/)
  await offline.stop()
  // giả lập app bị tắt đột ngột đúng lúc đang gửi dòng 3
  fs.appendFileSync(path.join(dataDir, 'merge', 'results.jsonl'), JSON.stringify({ row: 3, to: 'nam@kh2.vn; ketoan@kh2.vn', status: 'sending', at: Date.now() }) + '\n')
  const resumed = new Engine({
    dataDir,
    encrypt: (s) => 'enc:' + Buffer.from(s).toString('base64'),
    decrypt: (s) => Buffer.from(s.slice(4), 'base64').toString(),
    openExternal: () => undefined,
    emit: () => undefined
  })
  m = resumed.mergeStatus()!
  assert.deepEqual([m.results.length, m.remaining], [2, 1])
  assert.ok(m.results[1].uncertain && m.results[1].row === 3)
  assert.match(m.stopped ?? '', /thoát/)
  received.length = 0
  resumed.mergeResume({ delayMs: 0 })
  assert.throws(() => resumed.mergeResume(), /đang chạy/)
  await until(() => resumed.mergeStatus()?.running === false, 'gửi tiếp xong', 20000)
  assert.deepEqual(received.map((r) => r.to), [['bao@kh4.vn']], 'chỉ gửi dòng còn lại, không gửi trùng')
  m = resumed.mergeStatus()!
  assert.deepEqual([m.results.length, m.remaining, m.stopped], [3, 0, undefined])
  assert.throws(() => resumed.mergeResume(), /không còn dòng nào/)
  await resumed.mergeDiscard()
  assert.equal(resumed.mergeStatus(), null)
  assert.ok(!fs.existsSync(path.join(dataDir, 'merge')))
  await resumed.stop()
  ok('trộn thư dở được lưu lại: mở lại app gửi tiếp đúng dòng còn thiếu, không gửi trùng, dòng “không rõ” không tự gửi lại')

  const offline2 = new Engine({
    dataDir,
    encrypt: (s) => 'enc:' + Buffer.from(s).toString('base64'),
    decrypt: (s) => Buffer.from(s.slice(4), 'base64').toString(),
    openExternal: () => undefined,
    emit: () => undefined
  })
  const again = offline2.listMessages({ folderId: inbox.id })
  assert.ok(again.length >= 3)
  const full = await offline2.getMessage(again.find((m) => m.subject === 'Hợp đồng kèm tệp')!.id)
  assert.ok(full?.bodyAvailable && full.html.includes('data:image/png'))
  offline2.setFlag([again[0].id], 'flagged', true)
  assert.equal(offline2.store.pendingOps(acc.id).length, 1)
  await offline2.stop()
  ok('mất mạng vẫn đọc được thư đã đồng bộ; thao tác được xếp hàng chờ đẩy lên sau')

  await new Promise<void>((r) => smtpServer.close(() => r()))
  fs.rmSync(dataDir, { recursive: true, force: true })
  console.log(`\n${passed} kiểm thử đạt.`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('\n✗ THẤT BẠI:', e)
    process.exit(1)
  }
)
