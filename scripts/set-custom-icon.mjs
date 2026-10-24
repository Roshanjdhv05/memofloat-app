// One-shot script: converts the Kawaii PNG into all icon formats needed by MemoFloat.
// Run: node scripts/set-custom-icon.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const dir = join(import.meta.dirname, '..', 'resources', 'icons')
const src = join(dir, 'Kawaii Pastel Sticky Note Stack.png')

async function render(size) {
  return sharp(await readFile(src))
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
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

console.log('Reading source PNG...')
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoEntries = []
for (const size of icoSizes) {
  icoEntries.push({ size, data: await render(size) })
  console.log(`  rendered ${size}x${size}`)
}

await writeFile(join(dir, 'icon.ico'), packIco(icoEntries))
console.log('✓ icon.ico written')

await writeFile(join(dir, 'icon.png'), await render(512))
console.log('✓ icon.png written (512x512)')

// Tray icons — small sizes of the same PNG
await writeFile(join(dir, 'tray.png'), await render(16))
await writeFile(join(dir, 'tray@2x.png'), await render(32))
await writeFile(join(dir, 'tray@3x.png'), await render(48))
console.log('✓ tray icons written')

console.log('\nAll icons updated from Kawaii Pastel Sticky Note Stack.png')
