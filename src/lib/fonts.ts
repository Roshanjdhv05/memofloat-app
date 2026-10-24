export interface FontOption {
  id: string
  name: string
  family: string
  url: string
  tag: string
  sample: string
}

export const FONTS: FontOption[] = [
  {
    id: 'kalam',
    name: 'Kalam',
    family: "'Kalam', cursive",
    url: 'https://fonts.google.com/specimen/Kalam',
    tag: 'Bold Notebook',
    sample: 'Ideas become reality when written down and acted upon.'
  },
  {
    id: 'patrick-hand',
    name: 'Patrick Hand',
    family: "'Patrick Hand', cursive",
    url: 'https://fonts.google.com/specimen/Patrick+Hand',
    tag: 'Felt Marker',
    sample: 'Today is a wonderful day to start something fresh!'
  },
  {
    id: 'handlee',
    name: 'Handlee',
    family: "'Handlee', cursive",
    url: 'https://fonts.google.com/specimen/Handlee',
    tag: 'Warm & Friendly',
    sample: "Don't forget to take a walk and stay hydrated ☕"
  },
  {
    id: 'caveat',
    name: 'Caveat',
    family: "'Caveat', cursive",
    url: 'https://fonts.google.com/specimen/Caveat',
    tag: 'Natural Flowing',
    sample: 'Quick thoughts captured before they fly away ✨'
  },
  {
    id: 'comic-neue',
    name: 'Comic Neue',
    family: "'Comic Neue', cursive",
    url: 'https://fonts.google.com/specimen/Comic+Neue',
    tag: 'Clean Comic',
    sample: 'Chapter 1: The wonderful journey of a thousand notes.'
  },
  {
    id: 'coming-soon',
    name: 'Coming Soon',
    family: "'Coming Soon', cursive",
    url: 'https://fonts.google.com/specimen/Coming+Soon',
    tag: 'Pencil Sketch',
    sample: 'Project architecture diagram & brainstorming notes.'
  },
  {
    id: 'schoolbell',
    name: 'Schoolbell',
    family: "'Schoolbell', cursive",
    url: 'https://fonts.google.com/specimen/Schoolbell',
    tag: 'Chalkboard',
    sample: 'Reading list, meeting tasks, and daily reminders 📚'
  },
  {
    id: 'shantell-sans',
    name: 'Shantell Sans',
    family: "'Shantell Sans', cursive",
    url: 'https://fonts.google.com/specimen/Shantell+Sans',
    tag: 'Bouncy Cartoon',
    sample: 'Make it simple, make it fun, and make it happen!'
  },
  {
    id: 'sacramento',
    name: 'Sacramento',
    family: "'Sacramento', cursive",
    url: 'https://fonts.google.com/specimen/Sacramento',
    tag: 'Elegant Script',
    sample: 'Graceful thoughts penned with timeless elegance 🖋️'
  },
  {
    id: 'gochi-hand',
    name: 'Gochi Hand',
    family: "'Gochi Hand', cursive",
    url: 'https://fonts.google.com/specimen/Gochi+Hand',
    tag: 'Expressive Marker',
    sample: 'Weekend roadtrip playlist, favorite films & dinner plans 🎵'
  }
]

export const FONT_STORAGE_KEY = 'memofloat.activeFont'

export function getStoredFontId(): string {
  try {
    return localStorage.getItem(FONT_STORAGE_KEY) || 'kalam'
  } catch {
    return 'kalam'
  }
}

export function getFontById(id: string): FontOption {
  return FONTS.find((f) => f.id === id) || FONTS[0]
}

export function applyFontFamily(family: string) {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--font-paper', family)
    if (document.body) {
      document.body.style.setProperty('--font-paper', family)
    }
    let styleEl = document.getElementById('memofloat-active-font-style')
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'memofloat-active-font-style'
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = `
      :root, body, .paper, .paper-field, .note-body, [class*="font-[family-name:var(--font-paper)]"] {
        --font-paper: ${family} !important;
      }
      .paper-field, .note-body textarea, .note-body input, .paper h3, .paper p, .paper li {
        font-family: ${family} !important;
      }
    `
  }
}

export function initGlobalFont() {
  if (typeof window === 'undefined') return
  let currentId = getStoredFontId()
  const font = getFontById(currentId)
  applyFontFamily(font.family)

  window.addEventListener('storage', (e) => {
    if (e.key === FONT_STORAGE_KEY && e.newValue) {
      currentId = e.newValue
      const updated = getFontById(currentId)
      applyFontFamily(updated.family)
    }
  })

  // Poll for cross-window sync across separate Electron BrowserWindow instances
  setInterval(() => {
    const latest = getStoredFontId()
    if (latest !== currentId) {
      currentId = latest
      const updated = getFontById(latest)
      applyFontFamily(updated.family)
    }
  }, 400)
}
