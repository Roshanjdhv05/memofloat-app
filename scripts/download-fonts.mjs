import fs from 'node:fs'
import path from 'node:path'

const FONTS = [
  { name: 'Kalam', query: 'family=Kalam:wght@400;700' },
  { name: 'Patrick Hand', query: 'family=Patrick+Hand' },
  { name: 'Handlee', query: 'family=Handlee' },
  { name: 'Caveat', query: 'family=Caveat:wght@400;700' },
  { name: 'Comic Neue', query: 'family=Comic+Neue:wght@400;700' },
  { name: 'Coming Soon', query: 'family=Coming+Soon' },
  { name: 'Schoolbell', query: 'family=Schoolbell' },
  { name: 'Shantell Sans', query: 'family=Shantell+Sans:wght@400;700' },
  { name: 'Sacramento', query: 'family=Sacramento' },
  { name: 'Gochi Hand', query: 'family=Gochi+Hand' }
]

async function run() {
  const dir = path.resolve('src/fonts')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  let cssOutput = '/* Local handwriting fonts */\n\n'

  for (const f of FONTS) {
    const url = 'https://fonts.googleapis.com/css2?' + f.query + '&display=swap'
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })
    const css = await res.text()

    // Find all @font-face blocks for latin
    const blocks = css.split('@font-face').slice(1)
    for (const b of blocks) {
      // If block contains subset, only take latin
      const isLatin = !b.includes('/* ') || b.includes('/* latin */')
      if (!isLatin && b.includes('unicode-range')) continue

      const familyMatch = b.match(/font-family:\s*['"]?([^'";]+)/)
      const weightMatch = b.match(/font-weight:\s*([^;]+)/)
      const urlMatch = b.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)

      if (familyMatch && urlMatch) {
        const family = familyMatch[1].trim()
        const weight = weightMatch ? weightMatch[1].trim() : '400'
        const fileUrl = urlMatch[1]
        const safeName = (family + '-' + weight).replace(/[^a-zA-Z0-9-]/g, '') + '.woff2'
        const filePath = path.join(dir, safeName)

        console.log('Downloading', family, weight, '->', safeName)
        const fontRes = await fetch(fileUrl)
        const buf = Buffer.from(await fontRes.arrayBuffer())
        fs.writeFileSync(filePath, buf)

        cssOutput += `@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url('../fonts/${safeName}') format('woff2');\n}\n\n`
      }
    }
  }

  fs.writeFileSync('src/styles/fonts.css', cssOutput, 'utf8')
  console.log('Successfully wrote src/styles/fonts.css')
}

run().catch(console.error)
