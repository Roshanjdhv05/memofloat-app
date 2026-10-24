import { describe, expect, it } from 'vitest'
import { NOTE_WINDOW } from '@shared/constants'
import { cascadePosition, isReachable, resolveWindowBounds, type DisplayInfo } from '../../../electron/services/bounds'

const limits = {
  minWidth: NOTE_WINDOW.minWidth,
  minHeight: NOTE_WINDOW.minHeight,
  maxWidth: NOTE_WINDOW.maxWidth,
  maxHeight: NOTE_WINDOW.maxHeight
}
const defaultSize = { width: NOTE_WINDOW.defaultWidth, height: NOTE_WINDOW.defaultHeight }
const opts = { limits, defaultSize }

const primary: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const left: DisplayInfo = { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1040 } }
const above: DisplayInfo = { id: 3, workArea: { x: 0, y: -1080, width: 1920, height: 1040 } }

describe('restoring window positions', () => {
  it('restores an on-screen position exactly', () => {
    const r = resolveWindowBounds({ x: 400, y: 300, width: 320, height: 360 }, [primary], opts)
    expect(r).toEqual({ bounds: { x: 400, y: 300, width: 320, height: 360 }, adjusted: false, reason: 'unchanged' })
  })

  it('supports negative coordinates on a monitor left of / above the primary', () => {
    expect(resolveWindowBounds({ x: -1500, y: 200, width: 320, height: 360 }, [primary, left], opts).bounds.x).toBe(-1500)
    expect(resolveWindowBounds({ x: 300, y: -800, width: 320, height: 360 }, [primary, above], opts).bounds.y).toBe(-800)
  })

  it('leaves a partly off-screen window alone while its title strip is still grabbable', () => {
    const r = resolveWindowBounds({ x: 1800, y: 200, width: 320, height: 360 }, [primary], opts)
    expect(r.adjusted).toBe(false)
    expect(r.bounds.x).toBe(1800)
  })

  it('treats a window with under 80px of its title strip visible as unreachable', () => {
    expect(resolveWindowBounds({ x: 1850, y: 200, width: 320, height: 360 }, [primary], opts).adjusted).toBe(true)
  })

  it('cascades brand-new windows onto the primary display, offsetting each one', () => {
    const a = resolveWindowBounds(null, [primary], { ...opts, cascadeIndex: 0 }).bounds
    const b = resolveWindowBounds(null, [primary], { ...opts, cascadeIndex: 1 }).bounds
    expect(b.x - a.x).toBe(28)
    expect(b.y - a.y).toBe(28)
    expect(isReachable(a, [primary])).toBe(true)
  })

  it('treats missing or null coordinates as a new window', () => {
    expect(resolveWindowBounds({ x: null, y: null, width: 300, height: 300 }, [primary], opts).reason).toBe('new')
  })
})

describe('correcting off-screen window bounds', () => {
  it('moves a window back when its monitor was disconnected', () => {
    // saved on the left monitor, which is no longer attached
    const r = resolveWindowBounds({ x: -1500, y: 200, width: 320, height: 360 }, [primary], opts)
    expect(r.adjusted).toBe(true)
    expect(r.reason).toBe('moved-onscreen')
    expect(isReachable(r.bounds, [primary])).toBe(true)
    expect(r.bounds.x).toBeGreaterThanOrEqual(0)
  })

  it('moves a window that is far beyond the right/bottom edge after a resolution drop', () => {
    const small: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1280, height: 720 } }
    const r = resolveWindowBounds({ x: 1800, y: 900, width: 320, height: 360 }, [small], opts)
    expect(r.adjusted).toBe(true)
    expect(r.bounds.x + r.bounds.width).toBeLessThanOrEqual(1280)
    expect(r.bounds.y + r.bounds.height).toBeLessThanOrEqual(720)
  })

  it('moves a window hidden under the taskbar / above the top edge', () => {
    const r = resolveWindowBounds({ x: 200, y: -500, width: 320, height: 360 }, [primary], opts)
    expect(r.adjusted).toBe(true)
    expect(r.bounds.y).toBeGreaterThanOrEqual(0)
  })

  it('prefers the nearest remaining display', () => {
    const right: DisplayInfo = { id: 4, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }
    const r = resolveWindowBounds({ x: 5000, y: 100, width: 320, height: 360 }, [primary, right], opts)
    expect(r.bounds.x).toBeGreaterThanOrEqual(1920)
    expect(r.bounds.x + r.bounds.width).toBeLessThanOrEqual(3840)
  })

  it('shrinks a window larger than the display and clamps absurd sizes to the allowed range', () => {
    const tiny: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 400, height: 300 } }
    const r = resolveWindowBounds({ x: 5000, y: 5000, width: 700, height: 700 }, [tiny], opts)
    expect(r.bounds.width).toBeLessThanOrEqual(400)
    expect(r.bounds.height).toBeLessThanOrEqual(300)
    const clamped = resolveWindowBounds({ x: 10, y: 10, width: 99_999, height: 1 }, [primary], opts).bounds
    expect(clamped.width).toBe(NOTE_WINDOW.maxWidth)
    expect(clamped.height).toBe(NOTE_WINDOW.minHeight)
  })

  it('survives corrupt persisted values (NaN, Infinity, strings stored as numbers)', () => {
    const r = resolveWindowBounds({ x: Number.NaN, y: Number.POSITIVE_INFINITY, width: Number.NaN, height: -5 }, [primary], opts)
    expect(r.bounds.width).toBe(defaultSize.width)
    expect(r.bounds.height).toBe(defaultSize.height)
    expect(isReachable(r.bounds, [primary])).toBe(true)
  })

  it('never throws when no display is reported', () => {
    expect(() => resolveWindowBounds({ x: 1, y: 1, width: 300, height: 300 }, [], opts)).not.toThrow()
  })

  it('keeps cascaded positions inside the work area', () => {
    for (let i = 0; i < 20; i++) {
      const p = cascadePosition(primary.workArea, defaultSize, i)
      expect(isReachable({ ...p, ...defaultSize }, [primary])).toBe(true)
    }
  })
})
