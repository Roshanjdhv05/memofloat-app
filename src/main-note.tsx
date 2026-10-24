import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NoteWindow } from './app/notes/NoteWindow'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { SettingsProvider } from './hooks/useSettings'
import { initGlobalFont } from './lib/fonts'
import './styles/index.css'

initGlobalFont()

const params = new URLSearchParams(window.location.search)
const noteId = params.get('noteId')
const fresh = params.get('fresh') === '1'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary area="note">
      <SettingsProvider>
        <ToastProvider>
          {noteId && /^[A-Za-z0-9_-]{1,64}$/.test(noteId) ? (
            <NoteWindow noteId={noteId} fresh={fresh} />
          ) : (
            <div className="grid h-screen place-items-center p-6 text-center" role="alert">
              This window was opened without a note.
            </div>
          )}
        </ToastProvider>
      </SettingsProvider>
    </ErrorBoundary>
  </StrictMode>
)
