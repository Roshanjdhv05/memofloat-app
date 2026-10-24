import { NOTE_COLORS, type NoteColor } from '@shared/constants'

const COLOR_KEY = 'memofloat.lastCreatedColor'

/**
 * Returns the next note color in the rotation sequence, ensuring
 * consecutive notes always have different colors instead of a fixed default.
 */
export function getNextColor(notes?: Array<{ color: NoteColor; createdAt?: string }>): NoteColor {
  const colors = NOTE_COLORS
  let last: NoteColor | null = null

  try {
    last = localStorage.getItem(COLOR_KEY) as NoteColor | null
  } catch {
    /* ignore */
  }

  if (!last && notes && notes.length > 0) {
    const sorted = [...notes].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    last = sorted[0]?.color ?? null
  }

  const currentIdx = last ? colors.indexOf(last) : -1
  const next = colors[(currentIdx + 1) % colors.length]

  try {
    localStorage.setItem(COLOR_KEY, next)
  } catch {
    /* ignore */
  }

  return next
}
