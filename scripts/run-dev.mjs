import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { spawnSync, spawn } from 'node:child_process'

// Clean ELECTRON_RUN_AS_NODE which IDE terminals set automatically and breaks Electron
delete process.env.ELECTRON_RUN_AS_NODE
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Ensure electron binary is downloaded
const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))
if (!existsSync(join(electronDir, 'path.txt'))) {
  console.log('Downloading the Electron binary (first run only)...')
  const r = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit', env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// Launch electron-vite dev
const electronVitePath = join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js')
const child = spawn(process.execPath, [electronVitePath, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env
})

child.on('close', (code) => {
  process.exit(code ?? 0)
})

