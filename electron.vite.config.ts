import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// Prevent ELECTRON_RUN_AS_NODE (inherited from IDE terminals) from making Electron launch in Node mode
delete process.env.ELECTRON_RUN_AS_NODE

const alias = {
  '@shared': resolve('shared')
}

/**
 * Production renderer pages are loaded from file://, where response headers do not
 * apply, so a strict Content-Security-Policy is injected as a <meta> tag at build time.
 * In development the policy is applied through response headers from the main process
 * (see electron/services/security.ts) because Vite's HMR needs inline scripts and websockets.
 */
function productionCsp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'"
  ].join('; ')
  return {
    name: 'memofloat:production-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { main: resolve('electron/main.ts') } }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { preload: resolve('electron/preload.ts') } }
    }
  },
  renderer: {
    root: resolve('src'),
    resolve: { alias: { ...alias, '@': resolve('src') } },
    plugins: [react(), tailwindcss(), productionCsp()],
    build: {
      outDir: resolve('out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve('src/index.html'),
          note: resolve('src/note.html'),
          dock: resolve('src/dock.html')
        }
      }
    }
  }
})
