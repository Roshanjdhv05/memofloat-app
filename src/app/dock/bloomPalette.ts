import type { NoteColor } from '@shared/constants'

// ── Petal canvas ──────────────────────────────────────────────────────────────
// Tip is at the LEFT side (x≈4, y=TIP_Y). Body extends rightward.
// These are used by CrumpledPetal component in PaperBloomDockApp.
export const PETAL_W = 228  // canvas width
export const PETAL_H = 160  // canvas height
export const TIP_Y   = 80   // tip y-position = PETAL_H / 2

// ── Six unique organic teardrop-leaf silhouettes (tip at ~x=4, y=TIP_Y) ──────
// Body extends rightward from tip, widest around x=130-145, rounded outer end.
export const PETAL_PATHS = [
  // A — classic asymmetric leaf
  `M 4,80 C 12,57 42,22 88,10 C 128,0 172,12 206,40 C 226,60 228,82 214,107 C 198,133 165,150 126,153 C 88,156 44,142 18,112 C 7,101 1,91 4,80 Z`,
  // B — wider upper portion
  `M 4,80 C 14,54 50,18 98,8 C 140,0 182,16 210,46 C 228,66 228,85 215,110 C 200,136 167,153 128,155 C 90,157 46,142 18,112 C 6,101 1,90 4,80 Z`,
  // C — rounder outer end
  `M 4,80 C 10,56 38,20 84,9 C 126,-2 170,10 206,40 C 228,60 232,82 218,108 C 202,136 166,155 124,157 C 84,159 40,144 14,112 C 4,100 0,90 4,80 Z`,
  // D — elongated body
  `M 4,80 C 14,58 48,26 96,14 C 138,3 180,16 208,44 C 226,64 228,84 214,110 C 196,136 162,153 122,155 C 82,157 40,141 16,110 C 6,98 1,89 4,80 Z`,
  // E — slight upper bulge
  `M 4,80 C 12,55 44,18 92,8 C 136,-2 180,14 210,44 C 230,64 230,84 217,110 C 201,138 165,156 124,157 C 84,158 42,141 16,110 C 6,99 1,90 4,80 Z`,
  // F — more teardrop
  `M 4,80 C 10,58 36,22 82,10 C 124,-1 168,10 204,38 C 226,58 230,80 218,106 C 204,134 168,154 126,156 C 86,158 42,143 16,112 C 6,101 0,91 4,80 Z`,
]

// ── Crumple facet coordinates per petal ──────────────────────────────────────
// Each entry is an array of facets. Points are literal SVG polygon strings.
// The facets are clipped to the petal outline, creating 3D crumpled paper planes.
// Light source is from upper-left → top-left planes are lightest, lower-right darkest.
export const PETAL_FACETS: Array<
  Array<{ pts: string; tone: 'hi' | 'lo' | 'mid-hi' | 'mid-lo' | 'shadow' }>
> = [
  // Petal A
  [
    { pts: '4,80 4,48 82,22 78,62',                       tone: 'mid-hi' },  // inner-upper
    { pts: '82,22 148,12 155,48 78,62',                   tone: 'hi'     },  // mid-upper (bright)
    { pts: '148,12 206,40 196,68 155,48',                 tone: 'lo'     },  // outer-upper
    { pts: '196,68 214,107 195,100 162,80 155,48',        tone: 'shadow' },  // outer-right (darkest)
    { pts: '4,80 78,62 162,80 155,112 78,102',            tone: 'mid-lo' },  // mid-center
    { pts: '4,80 78,102 82,135 4,112',                    tone: 'lo'     },  // inner-lower
    { pts: '78,102 155,112 148,145 82,135',               tone: 'shadow' },  // lower-center
    { pts: '155,112 195,100 200,135 148,145',             tone: 'mid-lo' },  // outer-lower
  ],
  // Petal B
  [
    { pts: '4,80 4,46 90,20 84,60',                       tone: 'mid-hi' },
    { pts: '90,20 150,10 158,46 84,60',                   tone: 'hi'     },
    { pts: '150,10 210,46 200,70 158,46',                 tone: 'lo'     },
    { pts: '200,70 215,110 196,102 158,80 158,46',        tone: 'shadow' },
    { pts: '4,80 84,60 158,80 155,115 84,105',            tone: 'mid-lo' },
    { pts: '4,80 84,105 90,140 4,115',                    tone: 'lo'     },
    { pts: '84,105 155,115 150,148 90,140',               tone: 'shadow' },
    { pts: '155,115 196,102 202,138 150,148',             tone: 'mid-lo' },
  ],
  // Petal C
  [
    { pts: '4,80 4,44 84,18 80,58',                       tone: 'mid-hi' },
    { pts: '84,18 150,8 158,44 80,58',                    tone: 'hi'     },
    { pts: '150,8 206,40 198,66 158,44',                  tone: 'lo'     },
    { pts: '198,66 218,108 200,100 160,78 158,44',        tone: 'shadow' },
    { pts: '4,80 80,58 160,78 156,114 80,104',            tone: 'mid-lo' },
    { pts: '4,80 80,104 84,140 4,114',                    tone: 'lo'     },
    { pts: '80,104 156,114 150,150 84,140',               tone: 'shadow' },
    { pts: '156,114 200,100 204,140 150,150',             tone: 'mid-lo' },
  ],
  // Petal D
  [
    { pts: '4,80 4,48 92,26 86,64',                       tone: 'mid-hi' },
    { pts: '92,26 152,14 160,50 86,64',                   tone: 'hi'     },
    { pts: '152,14 208,44 198,70 160,50',                 tone: 'lo'     },
    { pts: '198,70 214,110 196,102 158,82 160,50',        tone: 'shadow' },
    { pts: '4,80 86,64 158,82 155,118 86,106',            tone: 'mid-lo' },
    { pts: '4,80 86,106 92,142 4,118',                    tone: 'lo'     },
    { pts: '86,106 155,118 152,148 92,142',               tone: 'shadow' },
    { pts: '155,118 196,102 202,140 152,148',             tone: 'mid-lo' },
  ],
  // Petal E
  [
    { pts: '4,80 4,46 88,20 82,60',                       tone: 'mid-hi' },
    { pts: '88,20 150,8 158,44 82,60',                    tone: 'hi'     },
    { pts: '150,8 210,44 200,70 158,44',                  tone: 'lo'     },
    { pts: '200,70 217,110 198,102 158,80 158,44',        tone: 'shadow' },
    { pts: '4,80 82,60 158,80 155,116 82,104',            tone: 'mid-lo' },
    { pts: '4,80 82,104 88,140 4,116',                    tone: 'lo'     },
    { pts: '82,104 155,116 150,150 88,140',               tone: 'shadow' },
    { pts: '155,116 198,102 204,140 150,150',             tone: 'mid-lo' },
  ],
  // Petal F
  [
    { pts: '4,80 4,46 80,20 76,60',                       tone: 'mid-hi' },
    { pts: '80,20 146,10 154,46 76,60',                   tone: 'hi'     },
    { pts: '146,10 204,38 196,64 154,46',                 tone: 'lo'     },
    { pts: '196,64 218,106 198,98 158,78 154,46',         tone: 'shadow' },
    { pts: '4,80 76,60 158,78 154,112 76,102',            tone: 'mid-lo' },
    { pts: '4,80 76,102 80,138 4,112',                    tone: 'lo'     },
    { pts: '76,102 154,112 146,148 80,138',               tone: 'shadow' },
    { pts: '154,112 198,98 202,138 146,148',              tone: 'mid-lo' },
  ],
]

// ── Color palette per note color ──────────────────────────────────────────────
export const BLOOM_PALETTE: Record<
  NoteColor,
  {
    base: string
    hi: string       // lightest highlight plane
    midHi: string    // mid-light
    midLo: string    // mid-shadow
    shadow: string   // deepest shadow
    ink: string
    inkSoft: string
    inkMuted: string
    border: string
    crease: string   // crease highlight stroke
  }
> = {
  yellow: {
    base:    '#F6DF56',
    hi:      '#FFFDE0',
    midHi:   '#FDF5AA',
    midLo:   '#E4C830',
    shadow:  '#C8A818',
    ink:     '#1A1505',
    inkSoft: '#3A2E0A',
    inkMuted:'#7A6018',
    border:  'rgba(195,158,20,0.28)',
    crease:  'rgba(255,255,255,0.68)'
  },
  pink: {
    base:    '#F4B8CE',
    hi:      '#FFE8F2',
    midHi:   '#F9CEDF',
    midLo:   '#E088AA',
    shadow:  '#C86090',
    ink:     '#1A0610',
    inkSoft: '#3A1020',
    inkMuted:'#7A2856',
    border:  'rgba(195,95,140,0.28)',
    crease:  'rgba(255,255,255,0.65)'
  },
  mint: {
    base:    '#AEE3C0',
    hi:      '#E0F9EA',
    midHi:   '#C8EFD5',
    midLo:   '#80C89A',
    shadow:  '#5CAA7A',
    ink:     '#051A0C',
    inkSoft: '#0E3019',
    inkMuted:'#2A7048',
    border:  'rgba(75,160,105,0.28)',
    crease:  'rgba(255,255,255,0.60)'
  },
  sky: {
    base:    '#B4D9F8',
    hi:      '#E0F2FF',
    midHi:   '#C8E8FF',
    midLo:   '#84B8E8',
    shadow:  '#5898CC',
    ink:     '#050E1A',
    inkSoft: '#0D1E35',
    inkMuted:'#26578A',
    border:  'rgba(70,140,200,0.28)',
    crease:  'rgba(255,255,255,0.62)'
  },
  lavender: {
    base:    '#C6BEE8',
    hi:      '#EAE7FF',
    midHi:   '#DAD5F5',
    midLo:   '#A698D0',
    shadow:  '#8070B8',
    ink:     '#0E0818',
    inkSoft: '#201535',
    inkMuted:'#5240A0',
    border:  'rgba(120,100,190,0.28)',
    crease:  'rgba(255,255,255,0.62)'
  },
  cream: {
    base:    '#FCECC8',
    hi:      '#FFFAEE',
    midHi:   '#FEF5DA',
    midLo:   '#EAD090',
    shadow:  '#D0B058',
    ink:     '#181208',
    inkSoft: '#302210',
    inkMuted:'#886828',
    border:  'rgba(195,158,70,0.28)',
    crease:  'rgba(255,255,255,0.65)'
  }
}
