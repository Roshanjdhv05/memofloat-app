import { forwardRef, useState } from 'react'
import { X } from 'lucide-react'
import { LIMITS } from '@shared/constants'
import { normalizeTag } from '../lib/tags'

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
}

/** Paper-styled tag chips. Enter or comma adds a tag; Backspace in the empty field removes the last one. */
export const TagEditor = forwardRef<HTMLInputElement, Props>(function TagEditor({ tags, onChange }, ref) {
  const [text, setText] = useState('')

  const commit = (raw: string) => {
    const tag = normalizeTag(raw)
    setText('')
    if (!tag || tags.includes(tag) || tags.length >= LIMITS.tagsMax) return
    onChange([...tags, tag])
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tags">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-black/[0.07] py-0.5 pr-1 pl-2 text-xs text-[var(--ink)]">
          {tag}
          <button type="button" className="grid size-4 place-items-center rounded-full hover:bg-black/10" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter((t) => t !== tag))}>
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={text}
        maxLength={LIMITS.tagMax}
        placeholder={tags.length ? '' : 'Add tag'}
        aria-label="Add a tag"
        onChange={(e) => (e.target.value.endsWith(',') ? commit(e.target.value.slice(0, -1)) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(text)
          } else if (e.key === 'Backspace' && text === '' && tags.length) {
            onChange(tags.slice(0, -1))
          }
        }}
        onBlur={() => text && commit(text)}
        className="paper-field min-w-16 flex-1 py-0.5 text-xs"
        style={{ fontFamily: 'var(--font-sans)' }}
      />
    </div>
  )
})
