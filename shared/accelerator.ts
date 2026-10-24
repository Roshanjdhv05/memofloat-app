/**
 * Global-shortcut accelerator helpers shared by the main process (validation before
 * registering) and the settings UI (recording a shortcut from keyboard events).
 *
 * Accelerators use Electron's string format, e.g. "Control+Alt+N".
 */

const MODIFIER_ALIASES: Record<string, 'Control' | 'Alt' | 'Shift' | 'Super'> = {
  control: 'Control',
  ctrl: 'Control',
  commandorcontrol: 'Control',
  cmdorctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
  windows: 'Super'
}

const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Super'] as const

const NAMED_KEYS = new Set([
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])

const PUNCTUATION_KEYS = new Set(['-', '=', '[', ']', ';', "'", ',', '.', '/', '`', '\\'])

/** Combinations that Windows or most applications reserve; registering them would be hostile. */
const RESERVED = new Set([
  'Control+Alt+Delete',
  'Alt+F4',
  'Alt+Tab',
  'Control+Shift+Escape',
  'Super+L',
  'Super+D',
  'Super+Tab'
])

export interface ParsedAccelerator {
  modifiers: Array<(typeof MODIFIER_ORDER)[number]>
  key: string
}

function normalizeKey(raw: string): string | null {
  if (raw.length === 1) {
    const upper = raw.toUpperCase()
    if (/^[A-Z0-9]$/.test(upper)) return upper
    if (PUNCTUATION_KEYS.has(raw)) return raw
    return null
  }
  const lower = raw.toLowerCase()
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower)
  if (fn) return `F${fn[1]}`
  for (const named of NAMED_KEYS) {
    if (named.toLowerCase() === lower) return named
  }
  if (lower === 'return') return 'Enter'
  if (lower === 'plus') return null
  return null
}

export function parseAccelerator(value: string): ParsedAccelerator | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null
  const parts = value.split('+').map((p) => p.trim())
  if (parts.some((p) => p.length === 0)) return null
  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>()
  let key: string | null = null
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier) {
      modifiers.add(modifier)
      continue
    }
    if (key !== null) return null
    key = normalizeKey(part)
    if (key === null) return null
  }
  if (key === null) return null
  return { modifiers: MODIFIER_ORDER.filter((m) => modifiers.has(m)), key }
}

export function formatAccelerator(parsed: ParsedAccelerator): string {
  return [...parsed.modifiers, parsed.key].join('+')
}

/** Returns the canonical spelling of an accelerator, or null when it is not acceptable. */
export function normalizeAccelerator(value: string): string | null {
  const parsed = parseAccelerator(value)
  if (!parsed) return null
  // A global shortcut must include Control, Alt or the Windows key; Shift alone would hijack typing.
  const hasStrongModifier = parsed.modifiers.some((m) => m === 'Control' || m === 'Alt' || m === 'Super')
  if (!hasStrongModifier) return null
  const canonical = formatAccelerator(parsed)
  if (RESERVED.has(canonical)) return null
  return canonical
}

export function isValidAccelerator(value: string): boolean {
  return normalizeAccelerator(value) !== null
}

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Backslash: '\\'
}

export interface KeyEventLike {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * Builds an accelerator string from a keydown event. Returns null while only modifier keys
 * are held, or when the key is not representable.
 */
export function acceleratorFromKeyEvent(event: KeyEventLike): string | null {
  const { code } = event
  let key: string | null
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code
  else key = CODE_TO_KEY[code] ?? null
  if (key === null) return null
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Super')
  return [...modifiers, key].join('+')
}
