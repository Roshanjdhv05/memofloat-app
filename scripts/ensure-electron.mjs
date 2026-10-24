// .npmrc sets ignore-scripts=true so npm never tries to compile better-sqlite3 with node-gyp
// (it ships N-API prebuilt binaries; compiling needs Python and Visual Studio Build Tools).
// That also skips Electron's own postinstall, so this script downloads the Electron binary on first use.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))
if (!existsSync(join(electronDir, 'path.txt'))) {
  console.log('Downloading the Electron binary (first run only)...')
  const r = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
