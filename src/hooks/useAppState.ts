import { useEffect, useState } from 'react'
import type { AppState } from '@shared/types'
import { api, unwrap } from '../lib/api'

export function useAppState(): AppState {
  const [state, setState] = useState<AppState>({ focusMode: false, notesHidden: false })
  useEffect(() => {
    let alive = true
    unwrap(api().app.state())
      .then((s) => alive && setState(s))
      .catch(() => undefined)
    const off = api().on('app:state', setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}
