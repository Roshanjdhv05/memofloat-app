import { useId, type ReactNode } from 'react'
import { motion } from 'framer-motion'

interface SwitchProps {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        {description && <p className="mt-0.5 text-sm text-soft">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'border-transparent bg-accent' : 'border-line-strong bg-surface-3'
        }`}
      >
        <motion.span
          className="absolute top-0.5 size-[18px] rounded-full bg-white shadow"
          initial={false}
          animate={{ left: checked ? 22 : 3 }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        />
      </button>
    </div>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
  id?: string
}

/** Single-choice button group, exposed to assistive tech as a radio group. */
export function Segmented<T extends string>({ value, options, onChange, label, id }: SegmentedProps<T>) {
  const group = useId()
  return (
    <div role="radiogroup" aria-label={label} id={id} className="inline-flex rounded-xl border border-line bg-surface p-0.5">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`relative rounded-[10px] px-3 py-1 text-sm transition-colors ${selected ? 'text-text' : 'text-soft hover:text-text'}`}
          >
            {selected && (
              <motion.span
                layoutId={`seg-${group}`}
                className="absolute inset-0 rounded-[10px] bg-surface-3"
                transition={{ type: 'spring', stiffness: 520, damping: 36 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-[15px] font-semibold text-text">{title}</h2>
      {description && <p className="mt-1 max-w-prose text-sm text-soft">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}
