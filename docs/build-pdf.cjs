// Xuất tài liệu hướng dẫn ra PDF:  node docs/build-pdf.cjs
const { chromium } = require('playwright-core')
const path = require('node:path')
;(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' })
  const p = await b.newPage()
  await p.goto('file://' + path.join(__dirname, 'huong-dan-su-dung.html'))
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => { throw new Error('Thiếu ảnh: ' + i.src) }))))
  const out = path.join(__dirname, 'Mail-Lite-Huong-dan-su-dung.pdf')
  await p.pdf({ path: out, format: 'A4', printBackground: true, outline: true, tagged: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font:8pt sans-serif;color:#777;padding:0 15mm;display:flex;justify-content:space-between"><span>Mail Lite — Hướng dẫn sử dụng</span><span>Trang <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' })
  await b.close()
  console.log(out)
})().catch((e) => { console.error(e.message); process.exit(1) })
