import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoteColor } from '@shared/constants'
import type { ChecklistItem, Note } from '@shared/types'
import { api, messageOf, unwrap } from '../lib/api'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface Draft {
  title: string
  body: string
  color: NoteColor
  tags: string[]
  checklist: ChecklistItem[]
}
type DraftField = keyof Draft

export interface NoteEditor {
  note: Note | null
  draft: Draft | null
  status: SaveStatus
  error: string | null
  loadError: string | null
  /** The note was deleted elsewhere. */
  gone: boolean
  setField: <K extends DraftField>(field: K, value: Draft[K]) => void
  setFlag: (flag: 'isPinned' | 'isArchived', value: boolean) => Promise<void>
  /** Writes every pending change now. Resolves when the database has acknowledged it. */
  flush: () => Promise<void>
  retry: () => void
}

const DEBOUNCE_MS = 600
const SAVED_VISIBLE_MS = 1800
const RETRY_MS = 3000

function toDraft(note: Note): Draft {
  return { title: note.title, body: note.body, color: note.color, tags: note.tags, checklist: note.checklist }
}

/**
 * Autosaving editor state for one note.
 *
 * Guarantees
 * - Only fields the user actually changed are sent, so an edit made elsewhere (pin, archive,
 *   another field) is never overwritten by a stale full-note save.
 * - Saves are serialised through one promise chain: they reach the database in the order they
 *   were made, and a flush always waits for the save already in flight.
 * - Fields that are dirty (pending or in flight) are never replaced by data fetched from the
 *   server, and responses older than the newest revision already seen are ignored.
 * - A failed save keeps its changes pending and retries; nothing is ever dropped silently.
 * - `flush` runs when the main process asks (window closing / app quitting), on `pagehide`
 *   and on unmount.
 */
export function useNoteEditor(noteId: string, debounceMs = DEBOUNCE_MS): NoteEditor {
  const [note, setNote] = useState<Note | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [gone, setGone] = useState(false)

  const pending = useRef<Partial<Draft>>({})
  const pendingFlags = useRef<{ isPinned?: boolean; isArchived?: boolean }>({})
  const inflight = useRef<Set<string>>(new Set())
  const chain = useRef<Promise<void>>(Promise.resolve())
  const knownRevision = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const fetchSeq = useRef(0)

  const hasPending = () => Object.keys(pending.current).length > 0 || Object.keys(pendingFlags.current).length > 0

  const applyServer = useCallback((server: Note) => {
    if (server.revision < knownRevision.current) return // older than something we already saw
    knownRevision.current = server.revision
    setNote(server)
    setDraft((current) => {
      if (!current) return toDraft(server)
      const next: Draft = { ...current }
      const dirty = (f: DraftField) => f in pending.current || inflight.current.has(f)
      if (!dirty('title')) next.title = server.title
      if (!dirty('body')) next.body = server.body
      if (!dirty('color')) next.color = server.color
      if (!dirty('tags')) next.tags = server.tags
      if (!dirty('checklist')) next.checklist = server.checklist
      return next
    })
  }, [])

  const doFlush = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (retryTimer.current) {
      clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    if (hasPending()) {
      const patch = { ...pending.current, ...pendingFlags.current }
      pending.current = {}
      pendingFlags.current = {}
      const fields = Object.keys(patch)
      fields.forEach((f) => inflight.current.add(f))
      chain.current = chain.current.then(async () => {
        if (mounted.current) setStatus('saving')
        try {
          const saved = await unwrap(api().notes.update(noteId, patch))
          fields.forEach((f) => inflight.current.delete(f))
          if (!mounted.current) return
          if (saved.revision >= knownRevision.current) {
            knownRevision.current = saved.revision
            setNote(saved)
          }
          setError(null)
          if (hasPending() || inflight.current.size > 0) return
          setStatus('saved')
          if (savedTimer.current) clearTimeout(savedTimer.current)
          savedTimer.current = setTimeout(() => mounted.current && setStatus((s) => (s === 'saved' ? 'idle' : s)), SAVED_VISIBLE_MS)
        } catch (e) {
          fields.forEach((f) => inflight.current.delete(f))
          // Keep the unsaved changes: re-queue anything the user has not since changed again.
          for (const f of fields) {
            if (f === 'isPinned' || f === 'isArchived') {
              if (!(f in pendingFlags.current)) pendingFlags.current[f] = (patch as Record<string, boolean>)[f]
            } else if (!(f in pending.current)) {
              ;(pending.current as Record<string, unknown>)[f] = (patch as Record<string, unknown>)[f]
            }
          }
          if (!mounted.current) return
          setError(messageOf(e))
          setStatus('error')
          if (retryTimer.current) clearTimeout(retryTimer.current)
          retryTimer.current = setTimeout(() => void doFlush(), RETRY_MS)
        }
      })
    }
    return chain.current
  }, [noteId])

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void doFlush(), debounceMs)
  }, [debounceMs, doFlush])

  const setField = useCallback(
    <K extends DraftField>(field: K, value: Draft[K]) => {
      ;(pending.current as Record<string, unknown>)[field] = value
      setDraft((d) => (d ? { ...d, [field]: value } : d))
      if (savedTimer.current) clearTimeout(savedTimer.current)
      setStatus((s) => (s === 'error' ? s : 'idle'))
      schedule()
    },
    [schedule]
  )

  const setFlag = useCallback(
    async (flag: 'isPinned' | 'isArchived', value: boolean) => {
      pendingFlags.current[flag] = value
      setNote((n) => (n ? { ...n, [flag]: value } : n)) // optimistic
      await doFlush()
    },
    [doFlush]
  )

  const fetchLatest = useCallback(async () => {
    const mine = ++fetchSeq.current
    try {
      const server = await unwrap(api().notes.get(noteId))
      if (!mounted.current || mine !== fetchSeq.current) return
      applyServer(server)
      setLoadError(null)
    } catch (e) {
      if (!mounted.current) return
      const code = (e as { code?: string }).code
      if (code === 'NOT_FOUND') setGone(true)
      else setLoadError(messageOf(e))
    }
  }, [noteId, applyServer])

  // Initial load + live updates from other windows.
  useEffect(() => {
    mounted.current = true
    void fetchLatest()
    const offChanged = api().on('notes:changed', (event) => {
      if (event.kind === 'delete' && event.noteId === noteId) setGone(true)
      else if (event.kind === 'reset' || (event.kind === 'upsert' && event.noteId === noteId)) void fetchLatest()
    })
    const offFlush = api().on('window:flush', ({ requestId }) => {
      void doFlush().finally(() => void api().windows.ackFlush(requestId))
    })
    const onPageHide = () => void doFlush()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      offChanged()
      offFlush()
      window.removeEventListener('pagehide', onPageHide)
      void doFlush()
      mounted.current = false
      for (const t of [timer, savedTimer, retryTimer]) if (t.current) clearTimeout(t.current)
    }
  }, [noteId, fetchLatest, doFlush])

  return { note, draft, status, error, loadError, gone, setField, setFlag, flush: doFlush, retry: () => void doFlush() }
}
