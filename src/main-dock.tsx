import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DockApp } from './app/dock/DockApp'
import { SemicircleDockApp } from './app/dock/SemicircleDockApp'
import { LayeredPaperDrawerDockApp } from './app/dock/LayeredPaperDrawerDockApp'
import { PaperBloomDockApp } from './app/dock/PaperBloomDockApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { SettingsProvider } from './hooks/useSettings'
import { initGlobalFont } from './lib/fonts'
import './styles/index.css'

initGlobalFont()
document.documentElement.classList.add('dock-page')

const DOCK_STYLE_KEY = 'memofloat.dockStyle'

function DockRouter() {
  const [style, setStyle] = useState<string>(() => {
    try { return localStorage.getItem(DOCK_STYLE_KEY) ?? 'standard' } catch { return 'standard' }
  })

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DOCK_STYLE_KEY) setStyle(e.newValue ?? 'standard')
    }
    window.addEventListener('storage', onStorage)
    // Also poll — dashboard and dock are different windows, storage events may not fire cross-window in Electron
    const timer = setInterval(() => {
      try {
        const v = localStorage.getItem(DOCK_STYLE_KEY) ?? 'standard'
        setStyle((prev) => (prev !== v ? v : prev))
      } catch { /* ignore */ }
    }, 1000)
    return () => { window.removeEventListener('storage', onStorage); clearInterval(timer) }
  }, [])

  if (style === 'bloom') return <PaperBloomDockApp />
  if (style === 'drawer') return <LayeredPaperDrawerDockApp />
  if (style === 'semicircle') return <SemicircleDockApp />
  return <DockApp />
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary area="dock">
      <SettingsProvider>
        <ToastProvider>
          <DockRouter />
        </ToastProvider>
      </SettingsProvider>
    </ErrorBoundary>
  </StrictMode>
)
