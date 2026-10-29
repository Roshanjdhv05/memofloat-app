import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('shared'),
      '@': resolve('src')
    }
  },
  test: {
    // Main-process tests run in plain Node against real SQLite (better-sqlite3 ships N-API
    // prebuilds, so the same binary also loads inside Electron).
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          environment: 'node',
          include: ['tests/unit/main/**/*.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          pool: 'threads',
          include: ['tests/unit/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/setup-renderer.ts']
        }
      }
    ]
  }
})
