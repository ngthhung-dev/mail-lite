import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bridge', {
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('api', method, args),
  on: (cb: (e: unknown) => void) => {
    const fn = (_: unknown, e: unknown): void => cb(e)
    ipcRenderer.on('event', fn)
    return () => ipcRenderer.removeListener('event', fn)
  },
  platform: process.platform
})
