import type { CSSProperties } from 'react'
import { NOTE_COLORS, NOTE_COLOR_LABELS, NOTE_PAPER, type NoteColor } from '@shared/constants'

export { NOTE_COLORS, NOTE_COLOR_LABELS }

/** Inline CSS variables for a paper colour; keeps shared/constants.ts the single source of truth. */
export function paperStyle(color: NoteColor): CSSProperties {
  const p = NOTE_PAPER[color]
  return {
    ['--paper' as string]: p.paper,
    ['--paper-deep' as string]: p.deep,
    ['--ink' as string]: p.ink,
    ['--ink-soft' as string]: p.inkSoft,
    ['--accent' as string]: p.accent
  }
}

/** Small deterministic tilt (degrees) so a grid of cards looks hand-placed, never random between renders. */
export function tiltFor(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return ((Math.abs(hash) % 100) / 100 - 0.5) * 1.6
}
