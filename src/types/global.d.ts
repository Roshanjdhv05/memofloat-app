import type { MemoFloatApi } from '@shared/types'

declare global {
  interface Window {
    /** Typed bridge exposed by the preload script; the only way the UI talks to the main process. */
    memofloat: MemoFloatApi
  }
}

export {}
