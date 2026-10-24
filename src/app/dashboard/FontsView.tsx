import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Check, ExternalLink, Sparkles, Type } from 'lucide-react'
import { FONTS, FONT_STORAGE_KEY, applyFontFamily, getStoredFontId, getFontById, type FontOption } from '../../lib/fonts'
import { useToast } from '../../components/Toast'

export function FontsView() {
  const toast = useToast()
  const [activeFontId, setActiveFontId] = useState<string>(() => getStoredFontId())

  const selectFont = (font: FontOption) => {
    setActiveFontId(font.id)
    try {
      localStorage.setItem(FONT_STORAGE_KEY, font.id)
    } catch {
      /* ignore */
    }
    applyFontFamily(font.family)
    toast.show(`Font applied: ${font.name}`)
  }

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === FONT_STORAGE_KEY && e.newValue) {
        setActiveFontId(e.newValue)
        const font = getFontById(e.newValue)
        applyFontFamily(font.family)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const currentFont = getFontById(activeFontId)

  return (
    <div className="scroll h-full px-6 pt-2 pb-12 max-sm:px-3">
      {/* Title & description */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Type className="size-6 text-accent" aria-hidden />
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Fonts & Typography</h1>
        </div>
        <p className="mt-1 text-sm text-soft">
          Select a handwriting font to customize the look and feel of all sticky notes and preview cards across MemoFloat.
        </p>
      </div>

      <div className="mx-auto max-w-4xl space-y-8">
        {/* Live Note Preview Section */}
        <section className="rounded-2xl border border-line bg-surface/50 p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-faint">
              <Sparkles className="size-3.5 text-accent" />
              Live Note Preview
            </span>
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
              Active: {currentFont.name}
            </span>
          </div>

          <div className="flex justify-center py-2">
            <div
              className="paper paper-cut w-full max-w-md rounded-2xl p-5 shadow-[0_12px_32px_-8px_rgba(48,39,31,0.2)] transition-all duration-300"
              style={{
                background: '#FFE66D',
                color: '#30271F'
              }}
            >
              <h2
                className="text-[22px] font-bold leading-tight"
                style={{ fontFamily: currentFont.family }}
              >
                Project Ideas & Brainstorm ✨
              </h2>
              <p
                className="mt-2 text-[15px] leading-relaxed opacity-90"
                style={{ fontFamily: currentFont.family }}
              >
                Every note you create or edit will immediately render using the selected handwriting style.
              </p>
              <ul className="mt-3 space-y-1 text-[14px]" style={{ fontFamily: currentFont.family }}>
                <li className="flex items-center gap-2">
                  <span className="text-base leading-none">☑</span>
                  <span className="line-through opacity-60">Review design layout</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-base leading-none">☐</span>
                  <span>Select favorite font ({currentFont.name})</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-base leading-none">☐</span>
                  <span>Create new sticky note on edge dock</span>
                </li>
              </ul>
              <div
                className="mt-4 flex items-center justify-between border-t border-black/10 pt-2 text-xs opacity-65"
                style={{ fontFamily: currentFont.family }}
              >
                <span>Edited just now</span>
                <span>🔔 Today at 5:00 PM</span>
              </div>
            </div>
          </div>
        </section>

        {/* Font Cards Grid */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-soft uppercase">Available Handwriting Fonts</h2>
            <span className="text-xs text-faint">{FONTS.length} Google Fonts</span>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {FONTS.map((font) => {
              const active = activeFontId === font.id
              return (
                <div
                  key={font.id}
                  onClick={() => selectFont(font)}
                  className={`group relative flex cursor-pointer flex-col justify-between rounded-xl border p-4.5 transition-all hover:scale-[1.015] hover:shadow-md ${
                    active
                      ? 'border-accent bg-accent-soft/40 shadow-sm ring-1 ring-accent/30'
                      : 'border-line bg-surface-2 hover:border-line-strong'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-base font-bold text-text group-hover:bg-surface"
                          style={{ fontFamily: font.family }}
                        >
                          Aa
                        </span>
                        <div className="min-w-0">
                          <h3
                            className="truncate text-[19px] font-bold leading-tight text-text"
                            style={{ fontFamily: font.family }}
                          >
                            {font.name}
                          </h3>
                          <span className="inline-block rounded-md bg-surface-3 px-2 py-0.5 text-[10px] font-medium tracking-wide text-soft uppercase">
                            {font.tag}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={font.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={`View ${font.name} on Google Fonts`}
                          className="flex size-7 items-center justify-center rounded-md text-faint transition hover:bg-surface-3 hover:text-text"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>

                        {active && (
                          <motion.span
                            layoutId="font-card-active"
                            className="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink shadow"
                            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                          >
                            <Check className="size-3.5" strokeWidth={3} />
                          </motion.span>
                        )}
                      </div>
                    </div>

                    <p
                      className="mt-3.5 text-[16px] leading-relaxed text-text/95"
                      style={{ fontFamily: font.family }}
                    >
                      {font.sample}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-line/50 pt-3">
                    <span className="text-[11px] font-mono text-faint">
                      {font.family.split(',')[0].replace(/['"]/g, '')}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        selectFont(font)
                      }}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                        active
                          ? 'bg-accent text-accent-ink'
                          : 'bg-surface-3 text-soft hover:bg-accent-soft hover:text-accent'
                      }`}
                    >
                      {active ? 'Active Font' : 'Apply'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
