import type { Note, Settings } from '@shared/types'

export interface CoreEvents {
  /** A note was created or changed. */
  'note:upserted': { note: Note; created: boolean }
  'note:deleted': { noteId: string }
  'reminders:changed': { noteId: string | null }
  'timetable:changed': { timetableId: string | null }
  /** Bulk change (import): every view must reload. */
  'data:imported': Record<string, never>
  'settings:changed': { settings: Settings; previous: Settings }
}

type Listener<T> = (payload: T) => void

/** Minimal typed synchronous event emitter used between services inside the main process. */
export class EventBus {
  private readonly listeners = new Map<keyof CoreEvents, Set<Listener<never>>>()

  on<K extends keyof CoreEvents>(event: K, listener: Listener<CoreEvents[K]>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener<never>)
    return () => set.delete(listener as Listener<never>)
  }

  emit<K extends keyof CoreEvents>(event: K, payload: CoreEvents[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of [...set]) {
      try {
        ;(listener as Listener<CoreEvents[K]>)(payload)
      } catch (error) {
        // A faulty subscriber must never break the write that triggered it.
        console.error(`Listener for "${event}" threw`, error)
      }
    }
  }
}

export type Clock = () => Date
export const systemClock: Clock = () => new Date()
