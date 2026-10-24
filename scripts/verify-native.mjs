// Verifies that the SQLite native module loads in the current Node runtime and, with
// --electron, inside Electron's own Node runtime.
//
// better-sqlite3 ships N-API prebuilt binaries (NAPI_VERSION=10). N-API is ABI-stable, so the
// same prebuilt .node file loads in Node and in every Electron release that implements that
// N-API version - no electron-rebuild step is needed. This script proves it on the machine
// it runs on, which is the check that matters after an Electron or better-sqlite3 upgrade.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '..')
const withElectron = process.argv.includes('--electron')

const probe = `
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
const row = db.prepare('select sqlite_version() as v').get();
db.exec("create table t(a); insert into t values (json('[1,2,3]'))");
const n = db.prepare('select count(*) as c from t, json_each(t.a)').get().c;
if (n !== 3) throw new Error('json_each check failed');
console.log(JSON.stringify({ runtime: process.versions.electron ? 'electron ' + process.versions.electron : 'node ' + process.version, abi: process.versions.modules, sqlite: row.v }));
`

function run(label, command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } })
  if (result.status !== 0) {
    console.error(`FAIL  ${label}\n${result.stderr || result.stdout}`)
    return false
  }
  console.log(`OK    ${label}: ${result.stdout.trim()}`)
  return true
}

let ok = run('Node runtime', process.execPath, ['-e', probe])

const prebuild = join(root, 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node')
if (existsSync(prebuild)) {
  console.log('OK    win32-x64 prebuilt binary present (used by the Windows installer build)')
} else {
  console.error('FAIL  win32-x64 prebuilt binary missing - the Windows build would not contain SQLite')
  ok = false
}

if (withElectron) {
  const electronBinary = require('electron')
  ok = run('Electron runtime', electronBinary, ['-e', probe], { ELECTRON_RUN_AS_NODE: '1' }) && ok
}

process.exit(ok ? 0 : 1)
