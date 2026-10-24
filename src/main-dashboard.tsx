import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DashboardApp } from './app/dashboard/DashboardApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { SettingsProvider } from './hooks/useSettings'
import { initGlobalFont } from './lib/fonts'
import './styles/index.css'

initGlobalFont()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary area="dashboard">
      <SettingsProvider>
        <ToastProvider>
          <DashboardApp />
        </ToastProvider>
      </SettingsProvider>
    </ErrorBoundary>
  </StrictMode>
)
