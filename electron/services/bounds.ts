/**
 * Pure window-bounds logic: restoring saved positions safely across monitor changes.
 *
 * Electron reports bounds in DIPs (device-independent pixels) for every display, so display
 * scaling needs no special handling here; displays to the left of or above the primary one
 * have negative coordinates, which these functions support.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface SizeLimits {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

export interface DisplayInfo {
  id: number
  workArea: Rect
}

/** Height of the draggable strip that must remain reachable for a window to count as visible. */
export const TITLE_STRIP_HEIGHT = 32
/** Minimum amount of the title strip (in px) that must be on a display. */
export const MIN_VISIBLE_WIDTH = 80
export const MIN_VISIBLE_HEIGHT = 24
export const CASCADE_STEP = 28

export function intersection(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 <= x1 || y2 <= y1) return null
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function area(rect: Rect | null): number {
  return rect ? rect.width * rect.height : 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function clampSize(size: { width?: number | null; height?: number | null }, limits: SizeLimits, fallback: Size): Size {
  const width = isFiniteNumber(size.width) && size.width > 0 ? size.width : fallback.width
  const height = isFiniteNumber(size.height) && size.height > 0 ? size.height : fallback.height
  return {
    width: Math.round(Math.min(limits.maxWidth, Math.max(limits.minWidth, width))),
    height: Math.round(Math.min(limits.maxHeight, Math.max(limits.minHeight, height)))
  }
}

/** True when enough of the window's title strip lies on some display for the user to grab it. */
export function isReachable(bounds: Rect, displays: readonly DisplayInfo[]): boolean {
  const strip: Rect = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: Math.min(TITLE_STRIP_HEIGHT, bounds.height)
  }
  const needW = Math.min(MIN_VISIBLE_WIDTH, bounds.width)
  const needH = Math.min(MIN_VISIBLE_HEIGHT, strip.height)
  return displays.some((display) => {
    const overlap = intersection(strip, display.workArea)
    return overlap !== null && overlap.width >= needW && overlap.height >= needH
  })
}

function distanceToRect(px: number, py: number, rect: Rect): number {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.width))
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

function bestDisplayFor(bounds: Rect, displays: readonly DisplayInfo[]): DisplayInfo {
  let best = displays[0]
  let bestOverlap = -1
  for (const display of displays) {
    const overlap = area(intersection(bounds, display.workArea))
    if (overlap > bestOverlap) {
      best = display
      bestOverlap = overlap
    }
  }
  if (bestOverlap > 0) return best
  // No overlap at all: choose the display nearest to the window's centre.
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  let nearest = displays[0]
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const display of displays) {
    const distance = distanceToRect(cx, cy, display.workArea)
    if (distance < nearestDistance) {
      nearest = display
      nearestDistance = distance
    }
  }
  return nearest
}

export function fitInto(bounds: Rect, workArea: Rect): Rect {
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/** Default placement for a brand-new window: centred on the display, cascaded for each open note. */
export function cascadePosition(workArea: Rect, size: Size, index: number): { x: number; y: number } {
  const offset = (Math.max(0, index) % 8) * CASCADE_STEP
  const baseX = workArea.x + Math.round((workArea.width - size.width) / 2)
  const baseY = workArea.y + Math.round((workArea.height - size.height) / 2)
  const fitted = fitInto({ x: baseX + offset, y: baseY + offset, ...size }, workArea)
  return { x: fitted.x, y: fitted.y }
}

export interface ResolveOptions {
  limits: SizeLimits
  defaultSize: Size
  /** Display that should host windows without usable saved coordinates. */
  preferredDisplayId?: number
  /** Number of notes already open; offsets the cascade. */
  cascadeIndex?: number
}

export type ResolveReason = 'unchanged' | 'new' | 'moved-onscreen' | 'resized'

export interface ResolvedBounds {
  bounds: Rect
  adjusted: boolean
  reason: ResolveReason
}

/**
 * Turns persisted (possibly stale) bounds into bounds that are safe to use now.
 *
 * - Sizes are clamped to the allowed range and to the host display.
 * - Windows with no saved position are cascaded onto the preferred (or primary) display.
 * - Windows whose title strip is no longer reachable (disconnected monitor, lower resolution)
 *   are moved back onto the best-matching visible display.
 * - Windows that are reachable are left exactly where the user put them, even when partly
 *   off-screen, including at negative coordinates on monitors left of or above the primary.
 */
export function resolveWindowBounds(
  saved: { x?: number | null; y?: number | null; width?: number | null; height?: number | null } | null,
  displays: readonly DisplayInfo[],
  options: ResolveOptions
): ResolvedBounds {
  if (displays.length === 0) {
    // Defensive: Electron always reports at least one display, but never throw while restoring.
    const size = clampSize(saved ?? {}, options.limits, options.defaultSize)
    return { bounds: { x: 0, y: 0, ...size }, adjusted: true, reason: 'new' }
  }

  const size = clampSize(saved ?? {}, options.limits, options.defaultSize)
  const hasPosition = saved !== null && isFiniteNumber(saved.x) && isFiniteNumber(saved.y)

  if (!hasPosition) {
    const display = displays.find((d) => d.id === options.preferredDisplayId) ?? displays[0]
    const fittedSize = {
      width: Math.min(size.width, display.workArea.width),
      height: Math.min(size.height, display.workArea.height)
    }
    const position = cascadePosition(display.workArea, fittedSize, options.cascadeIndex ?? 0)
    return { bounds: { ...position, ...fittedSize }, adjusted: false, reason: 'new' }
  }

  const candidate: Rect = { x: Math.round(saved.x as number), y: Math.round(saved.y as number), ...size }
  const sizeChanged =
    isFiniteNumber(saved?.width) && isFiniteNumber(saved?.height)
      ? size.width !== saved.width || size.height !== saved.height
      : true

  if (isReachable(candidate, displays)) {
    return { bounds: candidate, adjusted: sizeChanged, reason: sizeChanged ? 'resized' : 'unchanged' }
  }

  const display = bestDisplayFor(candidate, displays)
  return { bounds: fitInto(candidate, display.workArea), adjusted: true, reason: 'moved-onscreen' }
}
