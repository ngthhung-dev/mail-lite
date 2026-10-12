// Máy chủ IMAP + SMTP giả lập với dữ liệu mẫu, dùng để chạy thử giao diện mà không cần tài khoản thật.
//   node --experimental-strip-types test/demo-server.ts
// Đăng nhập: testuser / testpass — IMAP 127.0.0.1:11143 (STARTTLS/không mã hoá), SMTP 127.0.0.1:11025
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const hoodiecrow = require('hoodiecrow-imap')
const { SMTPServer } = require('smtp-server')

/** Tên thư mục IMAP dùng modified UTF-7 (RFC 3501) cho ký tự có dấu. */
function utf7(name: string): string {
  return name.replace(/&/g, '&-').replace(/[^\x20-\x7e]+/g, (run) => {
    const be = Buffer.from(run, 'utf16le').swap16()
    return '&' + be.toString('base64').replace(/\//g, ',').replace(/=+$/, '') + '-'
  })
}
const H = 3600_000
const b64 = (s: string) => Buffer.from(s).toString('base64')
const enc = (s: string) => `=?UTF-8?B?${b64(s)}?=`
let n = 0
function mail(o: { from: string; email: string; subject: string; html: string; hoursAgo: number; to?: string; cc?: string; attach?: string; replyTo?: number }) {
  n++
  const head = [
    `From: ${enc(o.from)} <${o.email}>`,
    `To: ${o.to ?? 'Người Dùng Thử <testuser@example.com>'}`,
    ...(o.cc ? [`Cc: ${o.cc}`] : []),
    `Subject: ${enc(o.subject)}`,
    `Message-ID: <demo${n}@example.com>`,
    ...(o.replyTo ? [`In-Reply-To: <demo${o.replyTo}@example.com>`, `References: <demo${o.replyTo}@example.com>`] : []),
    `Date: ${new Date(Date.now() - o.hoursAgo * H).toUTCString()}`,
    'MIME-Version: 1.0'
  ]
  const htmlPart = `Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(o.html)}`
  if (!o.attach) return [...head, htmlPart].join('\r\n')
  return [
    ...head,
    'Content-Type: multipart/mixed; boundary="MIX"',
    '',
    '--MIX',
    htmlPart,
    '--MIX',
    `Content-Type: application/octet-stream; name="${o.attach}"`,
    `Content-Disposition: attachment; filename="${o.attach}"`,
    'Content-Transfer-Encoding: base64',
    '',
    b64('Noi dung tep mau '.repeat(400)),
    '--MIX--',
    ''
  ].join('\r\n')
}

const inbox = [
  { raw: mail({ from: 'Trần Thị Mai', email: 'mai.tran@congty.vn', subject: 'Báo cáo doanh thu quý 3 — cần duyệt trước thứ sáu', hoursAgo: 1, cc: 'ketoan@congty.vn', attach: 'Bao-cao-Q3.xlsx', html: '<p>Chào anh,</p><p>Em gửi <b>báo cáo doanh thu quý 3</b>. Một số điểm chính:</p><ul><li>Doanh thu tăng 12% so với cùng kỳ</li><li>Chi phí vận hành giảm 4%</li><li>Ba hợp đồng lớn dự kiến ký trong tháng 10</li></ul><p>Anh xem và duyệt giúp em trước thứ sáu để kịp gửi ban giám đốc. Chi tiết tại <a href="https://example.com/bao-cao">đường dẫn này</a>.</p><p>Trân trọng,<br>Mai</p>' }) },
  { raw: mail({ from: 'Lê Hoàng Nam', email: 'nam.le@doitac.com.vn', subject: 'RE: Lịch họp triển khai dự án kho vận', hoursAgo: 3, html: '<p>Anh ơi, bên em chốt <b>9h30 sáng thứ ba</b> tại văn phòng bên anh nhé. Em sẽ mang theo bản kế hoạch chi tiết và danh sách nhân sự tham gia.</p><p>Nam</p>' }) },
  { raw: mail({ from: 'Phòng Nhân sự', email: 'nhansu@congty.vn', subject: 'Thông báo lịch nghỉ lễ và đăng ký teambuilding', hoursAgo: 6, html: '<p>Kính gửi toàn thể anh chị em,</p><p>Phòng Nhân sự thông báo lịch nghỉ lễ sắp tới và mở đăng ký teambuilding tại Đà Nẵng. Hạn đăng ký: hết ngày 20.</p><img src="https://example.com/banner.png" width="500" alt="banner">' }), flags: ['\\Seen'] },
  { raw: mail({ from: 'Ngân hàng ACB', email: 'no-reply@acb.example', subject: 'Sao kê tài khoản tháng 9', hoursAgo: 26, attach: 'Sao-ke-T9.pdf', html: '<p>Quý khách vui lòng xem sao kê tháng 9 trong tệp đính kèm.</p>' }), flags: ['\\Seen'] },
  { raw: mail({ from: 'Phạm Quốc Bảo', email: 'bao.pham@congty.vn', subject: 'Hoá đơn nhà cung cấp cần thanh toán', hoursAgo: 30, html: '<p>Anh duyệt giúp em 3 hoá đơn của nhà cung cấp, tổng 184.500.000đ. Hạn thanh toán ngày 15.</p>' }), flags: ['\\Flagged'] },
  { raw: mail({ from: 'GitHub', email: 'noreply@github.example', subject: '[maillite] Pull request #42: Sửa lỗi đồng bộ thư mục', hoursAgo: 52, html: '<p>Một pull request mới đang chờ bạn review.</p>' }), flags: ['\\Seen'] },
  { raw: mail({ from: 'Nguyễn Thu Hà', email: 'ha.nguyen@khachhang.vn', subject: 'Yêu cầu báo giá gói dịch vụ doanh nghiệp', hoursAgo: 75, html: '<p>Chào anh, công ty em cần báo giá cho 50 người dùng, thời hạn 12 tháng. Anh gửi giúp em trong tuần này nhé.</p>' }), flags: ['\\Seen', '\\Answered'] },
  { raw: mail({ from: 'Đỗ Minh Khoa', email: 'khoa.do@congty.vn', subject: 'Biên bản họp giao ban tuần trước', hoursAgo: 200, attach: 'Bien-ban-hop.docx', html: '<p>Em gửi biên bản họp giao ban, anh chị xem và phản hồi nếu cần bổ sung.</p>' }), flags: ['\\Seen'] },
  { raw: mail({ from: 'Viettel Post', email: 'cskh@vtpost.example', subject: 'Đơn hàng của bạn đã được giao thành công', hoursAgo: 500, html: '<p>Đơn hàng VT123456 đã giao thành công.</p>' }), flags: ['\\Seen'] }
]

const imap = hoodiecrow({
  plugins: ['ID', 'IDLE', 'UIDPLUS', 'MOVE', 'SPECIAL-USE', 'LITERALPLUS', 'UNSELECT', 'ENABLE', 'NAMESPACE', 'SASL-IR'],
  storage: {
    INBOX: { messages: inbox },
    '': {
      separator: '/',
      folders: {
        [utf7('Thư đã gửi')]: { 'special-use': '\\Sent', messages: [{ raw: mail({ from: 'Người Dùng Thử', email: 'testuser@example.com', to: 'ha.nguyen@khachhang.vn', subject: 'RE: Yêu cầu báo giá gói dịch vụ doanh nghiệp', hoursAgo: 70, replyTo: 7, html: '<p>Chào chị Hà, em gửi báo giá như đính kèm.</p>' }), flags: ['\\Seen'] }] },
        [utf7('Thư nháp')]: { 'special-use': '\\Drafts' },
        [utf7('Thùng rác')]: { 'special-use': '\\Trash' },
        [utf7('Thư rác')]: { 'special-use': '\\Junk' },
        [utf7('Lưu trữ')]: { 'special-use': '\\Archive' },
        [utf7('Dự án')]: { folders: { [utf7('Kho vận')]: {}, [utf7('Website mới')]: {} } },
        [utf7('Kế toán')]: {}
      }
    }
  }
})
const smtp = new SMTPServer({
  disabledCommands: ['STARTTLS'],
  allowInsecureAuth: true,
  onAuth(auth: any, _s: any, cb: any) {
    if (auth.username === 'testuser' && auth.password === 'testpass') cb(null, { user: 'testuser' })
    else cb(new Error('Invalid credentials'))
  },
  onData(stream: any, session: any, cb: any) {
    stream.resume()
    stream.on('end', () => {
      console.log('SMTP nhận thư gửi tới:', session.envelope.rcptTo.map((r: any) => r.address).join(', '))
      cb()
    })
  }
})
imap.listen(11143, () => console.log('IMAP demo: 127.0.0.1:11143 (testuser / testpass)'))
smtp.listen(11025, '127.0.0.1', () => console.log('SMTP demo: 127.0.0.1:11025'))
