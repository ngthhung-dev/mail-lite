import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// CSP chặt chỉ áp dụng cho bản build (chế độ dev cần script nội tuyến của Vite để tải nóng).
const csp = (): Plugin => ({
  name: 'maillite-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      injectTo: 'head-prepend',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; frame-src 'self' about:; connect-src 'none'; object-src 'none'; base-uri 'none'"
      }
    }
  ]
})

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react(), csp()] }
})
