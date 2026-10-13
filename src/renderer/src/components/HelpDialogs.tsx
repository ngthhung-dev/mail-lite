import { useEffect, useState } from 'react'
import { BookOpen, ExternalLink } from 'lucide-react'
import { api } from '../api.ts'
import { APP_NAME, APP_TAGLINE, AUTHOR } from '../../../shared/types.ts'
import { Modal } from './ui.tsx'
import icon from '../../../../resources/icon.png'

export const RELEASES_URL = 'https://github.com/ngthhung-dev/mail-lite/releases'

const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const CTRL = mac ? '⌘' : 'Ctrl'

/** Danh sách phím tắt — dùng chung cho hộp thoại "Phím tắt" (khớp với xử lý phím trong App.tsx / Compose / RichEditor). */
export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Chung',
    items: [
      [`${CTRL}+N`, 'Thư mới'],
      [`${CTRL}+Shift+M`, 'Trộn thư (gửi hàng loạt từ Excel)'],
      ['F9', 'Gửi/Nhận tất cả'],
      [`${CTRL}+1 / 2 / 3`, 'Chuyển sang Thư / Lịch / Danh bạ'],
      [`${CTRL}+,`, 'Cài đặt'],
      ['F1', 'Hướng dẫn sử dụng'],
      [`${CTRL}+/`, 'Bảng phím tắt này'],
      ['Esc', 'Đóng hộp thoại hoặc cửa sổ trên cùng']
    ]
  },
  {
    group: 'Danh sách và đọc thư',
    items: [
      ['↑ / ↓', 'Thư trước / thư sau'],
      ['Shift+↑ / ↓', 'Chọn thêm thư liền kề'],
      [`${CTRL}+A`, 'Chọn tất cả thư đang hiện'],
      ['Enter', 'Mở thư trong cửa sổ đọc'],
      [`${CTRL}+E`, 'Đưa con trỏ vào ô tìm kiếm'],
      [`${CTRL}+R`, 'Trả lời'],
      [`${CTRL}+Shift+R`, 'Trả lời tất cả'],
      [`${CTRL}+F`, 'Chuyển tiếp'],
      [`${CTRL}+Q / ${CTRL}+U`, 'Đánh dấu đã đọc / chưa đọc'],
      ['Insert', 'Gắn / bỏ cờ'],
      [`${CTRL}+Shift+V`, 'Chuyển tới thư mục'],
      ['Delete', 'Xoá thư đang chọn']
    ]
  },
  {
    group: 'Soạn thư',
    items: [
      [`${CTRL}+Enter`, 'Gửi'],
      [`${CTRL}+S`, 'Lưu nháp'],
      [`${CTRL}+B / I / U`, 'Đậm / nghiêng / gạch chân'],
      [`${CTRL}+K`, 'Chèn liên kết'],
      [`${CTRL}+Z / ${CTRL}+Y`, 'Hoàn tác / làm lại'],
      ['Tab (trong bảng)', 'Sang ô kế; ở ô cuối thì thêm dòng mới'],
      ['Esc', 'Đóng cửa sổ soạn (hỏi lưu nháp nếu chưa gửi)']
    ]
  }
]

export function ShortcutsDialog(props: { onClose: () => void }) {
  return (
    <Modal title="Phím tắt" width={620} onClose={props.onClose} className="help-keys">
      <div className="keys-grid">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h4>{g.group}</h4>
            <table>
              <tbody>
                {g.items.map(([k, d]) => (
                  <tr key={k + d}>
                    <td className="k">
                      {k.split(/( \/ |\+)/).map((p, i) =>
                        p === '+' || p === ' / ' ? <span key={i} className="sep">{p.trim()}</span> : <kbd key={i}>{p}</kbd>
                      )}
                    </td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Modal>
  )
}

export function AboutDialog(props: { onClose: () => void; onGuide: () => void }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.appInfo>> | null>(null)
  useEffect(() => {
    void api.appInfo().then(setInfo)
  }, [])
  const ver = info ? `${info.version}${info.build ? ` (build ${info.build})` : ''}` : ''
  return (
    <Modal
      title={`Giới thiệu ${APP_NAME}`}
      width={460}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={() => void api.openExternal(RELEASES_URL)}>
            <ExternalLink size={15} /> Kiểm tra bản mới
          </button>
          <button className="btn" onClick={props.onGuide}>
            <BookOpen size={15} /> Hướng dẫn sử dụng
          </button>
          <button className="btn primary" onClick={props.onClose}>
            Đóng
          </button>
        </>
      }
    >
      <div className="about">
        <img src={icon} alt="" width={72} height={72} />
        <div className="about-name">{APP_NAME}</div>
        <div className="about-tag">{APP_TAGLINE}</div>
        <div className="about-ver">Phiên bản {ver}</div>
        <p>
          Ứng dụng đọc và gửi thư trên máy tính: nhiều tài khoản (Gmail, Microsoft 365, mail công ty), đồng bộ thư về máy để đọc cả khi mất mạng,
          trộn thư từ Excel, quy tắc, lịch và danh bạ.
        </p>
        <div className="about-copy">Copyright © {new Date().getFullYear()} {AUTHOR.name}</div>
        {info && (
          <dl>
            <dt>Tác giả</dt>
            <dd>{AUTHOR.name}</dd>
            <dt>Email</dt>
            <dd>
              <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal(`mailto:${AUTHOR.email}`))}>
                {AUTHOR.email}
              </a>
            </dd>
            <dt>Điện thoại</dt>
            <dd>{AUTHOR.phone}</dd>
            <dt>Nền tảng</dt>
            <dd>
              Electron {info.electron} · Chromium {info.chrome} · Node {info.node}
            </dd>
            <dt>Dữ liệu</dt>
            <dd className="path">{info.dataDir}</dd>
          </dl>
        )}
      </div>
    </Modal>
  )
}
