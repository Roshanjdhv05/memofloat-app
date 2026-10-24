import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, X } from 'lucide-react'
import { LIMITS } from '@shared/constants'
import type { ChecklistItem } from '@shared/types'
import { newId } from '../lib/format'

interface Props {
  items: ChecklistItem[]
  onChange: (items: ChecklistItem[]) => void
  /** Id of an item that should receive focus (e.g. just added from the menu). */
  focusId?: string | null
}

/** Paper-styled checklist: Enter adds an item, Backspace on an empty item removes it. */
export function ChecklistEditor({ items, onChange, focusId }: Props) {
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const pendingFocus = useRef<string | null>(focusId ?? null)

  useEffect(() => {
    if (focusId) pendingFocus.current = focusId
  }, [focusId])

  useEffect(() => {
    const id = pendingFocus.current
    if (id && inputs.current.has(id)) {
      inputs.current.get(id)?.focus()
      pendingFocus.current = null
    }
  })

  const update = (id: string, patch: Partial<ChecklistItem>) => onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  const addAfter = (index: number) => {
    if (items.length >= LIMITS.checklistItemsMax) return
    const item: ChecklistItem = { id: newId(), text: '', checked: false }
    const next = [...items]
    next.splice(index + 1, 0, item)
    pendingFocus.current = item.id
    onChange(next)
  }

  const remove = (index: number, focusPrevious: boolean) => {
    const previous = items[index - 1] ?? items[index + 1]
    if (focusPrevious && previous) pendingFocus.current = previous.id
    onChange(items.filter((_, i) => i !== index))
  }

  const done = items.filter((i) => i.checked).length

  return (
    <div aria-label="Checklist" role="group" className="mt-3">
      <ul className="space-y-0.5">
        <AnimatePresence initial={false}>
          {items.map((item, index) => (
            <motion.li
              key={item.id}
              layout="position"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16 }}
              className="group flex items-center gap-2 overflow-hidden"
            >
              <input
                type="checkbox"
                className="checkbox-paper"
                checked={item.checked}
                aria-label={`Done: ${item.text || 'untitled item'}`}
                onChange={(e) => update(item.id, { checked: e.target.checked })}
              />
              <input
                ref={(el) => {
                  if (el) inputs.current.set(item.id, el)
                  else inputs.current.delete(item.id)
                }}
                type="text"
                value={item.text}
                maxLength={LIMITS.checklistTextMax}
                placeholder="List item"
                aria-label={`Checklist item ${index + 1}`}
                onChange={(e) => update(item.id, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addAfter(index)
                  } else if (e.key === 'Backspace' && item.text === '') {
                    e.preventDefault()
                    remove(index, true)
                  }
                }}
                className={`paper-field min-w-0 flex-1 py-1 text-[15px] leading-snug transition-[color,opacity] ${item.checked ? 'line-through opacity-55' : ''}`}
              />
              <button type="button" className="ink-btn size-6 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" aria-label={`Remove item ${index + 1}`} onClick={() => remove(index, false)}>
                <X className="size-3.5" aria-hidden />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <div className="mt-1 flex items-center justify-between">
        <button type="button" className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[13px] text-[var(--ink-soft)] hover:text-[var(--ink)]" onClick={() => addAfter(items.length - 1)}>
          <Plus className="size-3.5" aria-hidden /> Add item
        </button>
        {items.length > 0 && (
          <span className="text-xs text-[var(--ink-soft)]" aria-label={`${done} of ${items.length} done`}>
            {done}/{items.length}
          </span>
        )}
      </div>
    </div>
  )
}
