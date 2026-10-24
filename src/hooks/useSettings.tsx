import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MotionConfig, useReducedMotion } from 'framer-motion'
import { DEFAULT_SHORTCUTS } from '@shared/constants'
import type { SettingsPatch } from '@shared/schemas'
import type { Settings } from '@shared/types'
import { api, messageOf, unwrap } from '../lib/api'

const FALLBACK: Settings = {
  theme: 'light',
  defaultNoteColor: 'yellow',
  launchAtLogin: false,
  reducedMotion: 'system',
  notificationsEnabled: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  edgeDock: true,
  trayHintShown: false
}

interface SettingsContextValue {
  settings: Settings
  loaded: boolean
  update: (patch: SettingsPatch) => Promise<Settings>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(FALLBACK)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    unwrap(api().settings.get())
      .then((s) => {
        if (alive) setSettings(s)
      })
      .catch(() => undefined) // defaults keep the UI usable; the next change event repairs state
      .finally(() => alive && setLoaded(true))
    const off = api().on('settings:changed', setSettings)
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset['reducedMotion'] = settings.reducedMotion === 'on' ? 'on' : 'off'
    document.documentElement.dataset['theme'] = settings.theme
  }, [settings.reducedMotion, settings.theme])

  const update = useCallback(async (patch: SettingsPatch) => {
    try {
      const next = await unwrap(api().settings.update(patch))
      setSettings(next)
      return next
    } catch (error) {
      throw new Error(messageOf(error), { cause: error })
    }
  }, [])

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update])
  const motion = settings.reducedMotion === 'on' ? 'always' : settings.reducedMotion === 'off' ? 'never' : 'user'

  return (
    <SettingsContext.Provider value={value}>
      <MotionConfig reducedMotion={motion}>{children}</MotionConfig>
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>')
  return ctx
}

/** False when the user (or their OS) asked for reduced motion; use it to gate pointer-driven effects. */
export function useMotionAllowed(): boolean {
  const { settings } = useSettings()
  const system = useReducedMotion()
  if (settings.reducedMotion === 'on') return false
  if (settings.reducedMotion === 'off') return true
  return !system
}
