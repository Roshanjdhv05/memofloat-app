import { useEffect, useState } from 'react'
import { FolderOpen, Download, DatabaseBackup, Upload } from 'lucide-react'
import { SHORTCUT_ACTIONS, SHORTCUT_LABELS, type ShortcutAction } from '@shared/constants'
import { acceleratorFromKeyEvent } from '@shared/accelerator'
import type { ImportStrategy } from '@shared/schemas'
import type { AppInfo, ImportPreview, ShortcutStatus } from '@shared/types'
import { ColorPicker } from '../../components/ColorPicker'
import { Section, Segmented, Switch } from '../../components/Controls'
import { GhostButton, PrimaryButton } from '../../components/EmptyState'
import { useToast } from '../../components/Toast'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { useSettings } from '../../hooks/useSettings'
import { api, messageOf, unwrap } from '../../lib/api'
import { formatWhen, plural } from '../../lib/format'

const STATUS_TEXT: Record<ShortcutStatus['status'], string> = {
  registered: 'Active',
  disabled: 'Disabled',
  failed: 'Could not be registered',
  conflict: 'In use by another app',
  invalid: 'Not a valid shortcut'
}

function ShortcutRow({ action, value, status, onChange }: { action: ShortcutAction; value: string; status?: ShortcutStatus; onChange: (v: string) => Promise<void> }) {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const bad = status && status.status !== 'registered' && status.status !== 'disabled'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{SHORTCUT_LABELS[action]}</div>
        <div role="status" className={`text-xs ${bad ? 'text-danger' : 'text-faint'}`}>
          {hint ?? (status ? `${STATUS_TEXT[status.status]}${status.message ? ` — ${status.message}` : ''}` : '')}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`${SHORTCUT_LABELS[action]}: ${value || 'none'}. Press to record a new shortcut`}
          onClick={() => { setRecording(true); setHint('Press the new shortcut, or Escape to cancel') }}
          onBlur={() => { setRecording(false); setHint(null) }}
          onKeyDown={(e) => {
            if (!recording) return
            e.preventDefault()
            if (e.key === 'Escape') { setRecording(false); setHint(null); return }
            const acc = acceleratorFromKeyEvent(e)
            if (!acc) { setHint('Use Ctrl, Alt or Win together with a key'); return }
            setRecording(false)
            setHint(null)
            void onChange(acc).catch((err) => setHint(messageOf(err)))
          }}
          className={`min-w-40 rounded-lg border px-3 py-1.5 font-mono text-sm ${recording ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2 hover:border-line-strong'}`}
        >
          {recording ? 'Press keys…' : value || 'Not set'}
        </button>
        <GhostButton onClick={() => void onChange('').catch((err) => setHint(messageOf(err)))} disabled={!value}>Clear</GhostButton>
      </div>
    </div>
  )
}

export function SettingsView() {
  const { settings, update } = useSettings()
  const toast = useToast()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [strategy, setStrategy] = useState<ImportStrategy>('newer')
  const [busy, setBusy] = useState(false)
  const shortcuts = useLiveQuery(() => unwrap(api().settings.shortcutStatus()), [], ['shortcuts:status', 'settings:changed'], 100)

  useEffect(() => {
    unwrap(api().app.info()).then(setInfo).catch(() => undefined)
    return api().on('shortcuts:status', () => undefined)
  }, [])

  const change = async (patch: Parameters<typeof update>[0]) => {
    try { await update(patch) } catch (e) { toast.error(messageOf(e)) }
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { toast.error(messageOf(e)) } finally { setBusy(false) }
  }

  const exportJson = () => run(async () => { const r = await unwrap(api().data.exportJson()); if (r.path) toast.show('Notes exported') })
  const backup = () => run(async () => { const r = await unwrap(api().data.backupDatabase()); if (r.path) toast.show('Backup saved') })
  const choose = () => run(async () => setPreview(await unwrap(api().data.importPreview())))
  const commit = () => run(async () => {
    if (!preview) return
    const r = await unwrap(api().data.importCommit(preview.token, strategy))
    setPreview(null)
    toast.show(`Imported: ${plural(r.notesAdded, 'new note')}, ${r.notesOverwritten} replaced, ${r.notesSkipped} skipped`)
  })

  const [dockStyle, setDockStyle] = useState<'standard' | 'semicircle' | 'drawer' | 'bloom'>(() => {
    try {
      return (localStorage.getItem('memofloat.dockStyle') as 'standard' | 'semicircle' | 'drawer' | 'bloom') ?? 'standard'
    } catch {
      return 'standard'
    }
  })

  const changeDockStyle = (style: 'standard' | 'semicircle' | 'drawer' | 'bloom') => {
    setDockStyle(style)
    try {
      localStorage.setItem('memofloat.dockStyle', style)
      window.dispatchEvent(new StorageEvent('storage', { key: 'memofloat.dockStyle', newValue: style }))
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="scroll h-full px-6 pt-2 pb-10 max-sm:px-3">
      <h1 className="mb-4 text-[22px] font-semibold tracking-[-0.01em]">Settings</h1>
      <div className="mx-auto max-w-2xl space-y-4">
        <Section title="Appearance">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">Theme</span>
            <Segmented label="Theme" value={settings.theme} onChange={(theme) => void change({ theme })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">Reduce motion</span>
            <Segmented label="Reduce motion" value={settings.reducedMotion} onChange={(reducedMotion) => void change({ reducedMotion })} options={[{ value: 'system', label: 'Follow system' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">Default colour for new notes</span>
            <ColorPicker value={settings.defaultNoteColor} onChange={(defaultNoteColor) => void change({ defaultNoteColor })} label="Default note colour" />
          </div>
        </Section>

        <Section title="Edge dock" description="A thin strip on the right edge of your main screen. Move the pointer onto it and a tab for each note slides out, with a + button to create a new note. Click a tab to open that note.">
          <Switch label="Show the edge dock" checked={settings.edgeDock} onChange={(edgeDock) => void change({ edgeDock })} />
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line">
            <span className="text-sm font-medium">Dock appearance style</span>
            <Segmented
              label="Dock appearance style"
              value={dockStyle}
              onChange={(s) => changeDockStyle(s as 'standard' | 'semicircle' | 'drawer' | 'bloom')}
              options={[
                { value: 'standard', label: 'Standard Side' },
                { value: 'semicircle', label: 'Semicircle' },
                { value: 'drawer', label: 'Layered Paper Drawer' },
                { value: 'bloom', label: 'Paper Bloom (Flower)' }
              ]}
            />
          </div>
        </Section>

        <Section title="Startup and reminders" description={info?.reminderBehavior}>
          <Switch
            label="Launch MemoFloat when I sign in to Windows"
            description={info && !info.launchAtLoginSupported ? 'Available in the installed app (not in development builds).' : 'Starts quietly in the tray and restores your notes.'}
            checked={settings.launchAtLogin}
            disabled={!info?.launchAtLoginSupported}
            onChange={(launchAtLogin) => void change({ launchAtLogin })}
          />
          <Switch label="Reminder notifications" description="Show a Windows notification when a reminder is due. Clicking it opens the note." checked={settings.notificationsEnabled} onChange={(notificationsEnabled) => void change({ notificationsEnabled })} />
        </Section>

        <Section title="Global shortcuts" description="Work anywhere in Windows while MemoFloat is running. If another app already uses a shortcut you will see a warning here.">
          {SHORTCUT_ACTIONS.map((action) => (
            <ShortcutRow key={action} action={action} value={settings.shortcuts[action] ?? ""} status={shortcuts.data?.find((s) => s.action === action)} onChange={(v) => update({ shortcuts: { [action]: v } }).then(() => undefined)} />
          ))}
        </Section>

        <Section title="Your data" description="Everything is stored on this computer. Nothing is sent anywhere.">
          <div className="flex flex-wrap gap-2">
            <GhostButton disabled={busy} onClick={() => void exportJson()}><Download className="size-4" aria-hidden /> Export notes (JSON)</GhostButton>
            <GhostButton disabled={busy} onClick={() => void backup()}><DatabaseBackup className="size-4" aria-hidden /> Back up database</GhostButton>
            <GhostButton disabled={busy} onClick={() => void choose()}><Upload className="size-4" aria-hidden /> Import…</GhostButton>
            <GhostButton onClick={() => void run(async () => { await unwrap(api().data.openDataFolder()) })}><FolderOpen className="size-4" aria-hidden /> Open data folder</GhostButton>
          </div>
          {info && <p className="break-all text-xs text-faint">Location: {info.databasePath}</p>}

          {preview && (
            <div role="region" aria-label="Import preview" className="rounded-xl border border-line-strong bg-surface-2 p-4">
              <h3 className="text-sm font-semibold">Review before importing</h3>
              <p className="mt-1 text-sm text-soft">{preview.fileName} · exported {formatWhen(preview.exportedAt)}</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
                <li>{plural(preview.notes.total, 'note')} in the file: {preview.notes.added} new, {preview.notes.conflicts} already exist</li>
                <li>{plural(preview.reminders.total, 'reminder')}: {preview.reminders.added} to add, {preview.reminders.skipped} skipped</li>
              </ul>
              {preview.warnings.map((w) => <p key={w} className="mt-2 text-sm text-danger">{w}</p>)}
              {preview.conflicts.length > 0 && (
                <div className="mt-3">
                  <label htmlFor="strategy" className="text-sm font-medium">For notes that already exist</label>
                  <select id="strategy" value={strategy} onChange={(e) => setStrategy(e.target.value as ImportStrategy)} className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
                    <option value="newer">Keep whichever was edited most recently</option>
                    <option value="skip">Keep my current notes</option>
                    <option value="overwrite">Replace with the imported notes</option>
                    <option value="keepBoth">Keep both (import as copies)</option>
                  </select>
                  <ul className="mt-2 max-h-28 overflow-auto text-xs text-soft">
                    {preview.conflicts.slice(0, 20).map((c) => <li key={c.id}>{c.title || 'Untitled note'}</li>)}
                  </ul>
                </div>
              )}
              <p className="mt-3 text-xs text-faint">A backup of your current database is made automatically before anything changes.</p>
              <div className="mt-3 flex gap-2">
                <PrimaryButton disabled={busy} onClick={() => void commit()}>Import</PrimaryButton>
                <GhostButton disabled={busy} onClick={() => setPreview(null)}>Cancel</GhostButton>
              </div>
            </div>
          )}
        </Section>

        <Section title="About">
          {info ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-faint">Version</dt><dd>{info.version}</dd>
              <dt className="text-faint">Electron</dt><dd>{info.electronVersion}</dd>
              <dt className="text-faint">Time zone</dt><dd>{info.timeZone}</dd>
            </dl>
          ) : <p className="text-sm text-faint">Loading…</p>}
          <GhostButton onClick={() => void api().app.quit()}>Quit MemoFloat</GhostButton>
        </Section>
      </div>
    </div>
  )
}
