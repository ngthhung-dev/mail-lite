import type { Api, Bridge } from '../../shared/api.ts'
import type { AppEvent } from '../../shared/types.ts'

declare global {
  interface Window {
    bridge: Bridge
  }
}

function clean(msg: string): string {
  return msg.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(Error:\s*)+/, '')
}

export const api = new Proxy({} as Api, {
  get:
    (_t, method: string) =>
    (...args: unknown[]) =>
      window.bridge.call(method, args).catch((e: Error) => {
        throw new Error(clean(e?.message ?? String(e)))
      })
})

export function onEvent(cb: (e: AppEvent) => void): () => void {
  return window.bridge.on(cb)
}
