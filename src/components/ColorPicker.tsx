import { motion } from 'framer-motion'
import { NOTE_PAPER, type NoteColor } from '@shared/constants'
import { NOTE_COLORS, NOTE_COLOR_LABELS } from '../lib/paper'

interface Props {
  value: NoteColor
  onChange: (color: NoteColor) => void
  label?: string
  /** Ring colour; defaults to the dashboard text colour. */
  ring?: string
}

/** Radio group of paper swatches. The selection ring glides between swatches. */
export function ColorPicker({ value, onChange, label = 'Note colour', ring = 'var(--text)' }: Props) {
  const move = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = NOTE_COLORS[(index + step + NOTE_COLORS.length) % NOTE_COLORS.length]
    onChange(next)
    const target = (event.currentTarget.parentElement?.children[(index + step + NOTE_COLORS.length) % NOTE_COLORS.length] as HTMLElement | undefined) ?? null
    target?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5">
      {NOTE_COLORS.map((color, index) => {
        const selected = color === value
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={NOTE_COLOR_LABELS[color]}
            title={NOTE_COLOR_LABELS[color]}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(color)}
            onKeyDown={(event) => move(event, index)}
            className="relative grid size-6 place-items-center rounded-full"
          >
            {selected && (
              <motion.span
                layoutId={`color-ring-${label}`}
                className="absolute -inset-0.5 rounded-full border-2"
                style={{ borderColor: ring }}
                transition={{ type: 'spring', stiffness: 520, damping: 32 }}
              />
            )}
            <span
              className="size-5 rounded-full border border-black/15 shadow-inner transition-transform hover:scale-110"
              style={{ background: NOTE_PAPER[color].deep }}
            />
          </button>
        )
      })}
    </div>
  )
}
