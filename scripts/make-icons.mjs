// Regenerates every raster icon from the SVG sources in resources/icons.
// The generated files are committed, so this only needs to run when the artwork changes.
//   npm run icons
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const dir = join(import.meta.dirname, '..', 'resources', 'icons')

async function render(svgFile, size) {
  const svg = await readFile(join(dir, svgFile))
  return sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
}

/** Packs PNG buffers into a Windows .ico container (PNG-compressed entries, Vista+). */
function packIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length
  entries.forEach(({ size, data }, i) => {
    const o = i * 16
    directory.writeUInt8(size >= 256 ? 0 : size, o)
    directory.writeUInt8(size >= 256 ? 0 : size, o + 1)
    directory.writeUInt8(0, o + 2)
    directory.writeUInt8(0, o + 3)
    directory.writeUInt16LE(1, o + 4)
    directory.writeUInt16LE(32, o + 6)
    directory.writeUInt32LE(data.length, o + 8)
    directory.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([header, directory, ...entries.map((e) => e.data)])
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoEntries = []
for (const size of icoSizes) icoEntries.push({ size, data: await render('memofloat.svg', size) })

await writeFile(join(dir, 'icon.ico'), packIco(icoEntries))
await writeFile(join(dir, 'icon.png'), await render('memofloat.svg', 512))
await writeFile(join(dir, 'tray.png'), await render('tray.svg', 16))
await writeFile(join(dir, 'tray@2x.png'), await render('tray.svg', 32))
await writeFile(join(dir, 'tray@3x.png'), await render('tray.svg', 48))
console.log('Icons written to', dir)
