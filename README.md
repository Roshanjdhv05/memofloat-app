# MemoFloat

Offline-first sticky notes and reminders for Windows. Every note is its own always-available desktop window; a dashboard organizes them; reminders show native Windows notifications.

Stack: Electron · React · TypeScript · electron-vite · Tailwind CSS · Framer Motion · SQLite (better-sqlite3) · Zod · Vitest · Playwright · electron-builder (NSIS).

## Important: how reminders work

**Reminders are delivered only while MemoFloat is running.** Closing the dashboard or a note keeps MemoFloat running in the system tray, so reminders keep firing. If you choose *Quit* from the tray, or the computer is off or asleep, nothing can notify you at that moment. The next time MemoFloat starts (or the PC wakes/unlocks) it checks the database, announces reminders that came due **once** (no duplicates; if many are missed they are summarized in one notification) and schedules the rest. MemoFloat has no background service and no cloud. Enable *Launch when I sign in* in Settings so it is normally running.

## When a reminder is due

MemoFloat opens that note and raises it above your other windows for a moment (and shows a Windows notification; clicking the notification opens the note too). If several reminders are due at once, up to three notes open; more than that opens the Reminders list instead. Both are controlled by the *Reminder notifications* switch in Settings.

## The edge dock

A narrow sliver stays visible on the right edge of your main screen, with one small coloured marker per note. Move the pointer onto it and one coloured tab per note slides out, with a **+** button underneath to create a new note. Rest the pointer on a tab and a small preview card shows the note's title, text (or checklist) and when it was edited. Click a tab to open that note on your desktop. Turn it off in Settings → Edge dock. The dock never takes keyboard focus, so the tray, dashboard and global shortcuts remain the keyboard routes. Only the six most recently edited notes get a tab; the dashboard shows all.

## Requirements

- Node.js 22 LTS or newer, npm 10+
- Windows 10/11 x64 to run or build the installer (development and tests also run on Linux/macOS; the installer must be built on Windows, see below)

## Setup and development

```
npm install
npm run dev          # Electron with hot reload; data in %APPDATA%\MemoFloat-dev
```

`.npmrc` sets `ignore-scripts=true` on purpose: `better-sqlite3` ships prebuilt binaries, and without this npm would try to compile it with node-gyp (which needs Python and Visual Studio Build Tools and fails without them). The Electron binary is downloaded automatically by `npm run dev` the first time (or run `npm run setup`).

`better-sqlite3` ships N-API prebuilt binaries that work in both Node and Electron, so no compiler or `electron-rebuild` is needed. `npm run verify:native` checks this.

## Quality checks

```
npm run lint
npm run typecheck
npm test             # unit + component tests (Vitest)
npm run build        # electron-vite production build into out/
npm run test:e2e     # Playwright drives the BUILT app (run npm run build first)
                     # Linux: xvfb-run -a npm run test:e2e
```

E2E tests use a temporary data folder via `MEMOFLOAT_USER_DATA`, never your real data.

## Packaging (Windows)

```
npm run package:win  # builds out/ then release/MemoFloat-Setup-<version>-x64.exe (NSIS)
npm run package:dir  # unpacked app in release/win-unpacked for quick checks
```

Build the installer **on Windows**. On Linux the NSIS final step needs Wine and the installer is incomplete without it.

### Unsigned installer

The installer is **not code-signed** unless you provide a certificate (`CSC_LINK`, `CSC_KEY_PASSWORD`). Windows SmartScreen will show "Windows protected your PC" — choose *More info → Run anyway*. Signing removes the warning over time; it is not a security feature of the app itself.

The uninstaller asks whether to delete your notes (default: keep). Silent uninstall always keeps them.

## Where your data lives

| What | Location |
|---|---|
| Database | `%APPDATA%\MemoFloat\memofloat.db` |
| Automatic and pre-import backups | `%APPDATA%\MemoFloat\backups\` |
| Logs (never contain note text) | `%APPDATA%\MemoFloat\logs\` |

Settings → *Open data folder* opens it. Export (JSON) and database backup are in Settings → Your data. Import shows a preview and lets you choose how to treat notes that already exist; a backup is made first.

## Architecture and security

- `electron/` main process: repositories (SQLite), services (notes, reminders, windows, backup, tray, shortcuts), IPC handlers.
- `electron/preload.ts`: the only bridge, exposes a typed `window.memofloat` API; no Node, no `ipcRenderer`.
- `src/`: React renderer; two entry pages (`index.html` dashboard, `note.html` one per note window).
- `shared/`: constants, Zod schemas and types used by both sides.

Security: `contextIsolation`, `sandbox`, no `nodeIntegration`, every IPC payload validated by a strict Zod schema and the sender frame checked, strict Content-Security-Policy, navigation and `window.open` blocked, no remote content, permission requests denied. Database changes go through versioned migrations (automatic backup before migrating). A corrupted database is moved aside (never deleted) and you are offered the latest automatic backup.

Notes are plain-text. Note windows are frameless and **not transparent** (transparent windows break resizing and snapping on Windows); the paper look is drawn with CSS.

## Troubleshooting

- **`electron-vite is not recognized` / node-gyp or Python errors during `npm install`**: use this version's `.npmrc` (`ignore-scripts=true`), delete `node_modules`, run `npm install` again.
- **Nothing appears on launch**: MemoFloat may already be running in the tray (single instance). Click the tray icon.
- **A reminder opens its note but no Windows toast appears**: the note opening is MemoFloat's own alert and always works. Toasts depend on Windows: check Settings → System → Notifications, turn off Focus assist / Do not disturb, and use the installed app (a `npm run dev` run is identified by electron.exe, which Windows may treat differently).
- **No notifications**: Windows *Focus assist / Do not disturb* silences them; check Settings → System → Notifications for MemoFloat, and the in-app *Reminder notifications* switch.
- **Shortcut says "in use by another app"**: choose another combination in Settings → Global shortcuts.
- **Note window off-screen after unplugging a monitor**: it is moved onto a visible display automatically at startup/display change; or use tray → *Show/hide all notes*.
- **Database error at startup**: the dialog explains the options; the log is in the data folder.

## Tests and what they cover

E2E also covers the dock (hover reveals the tabs and +, + creates a note, a tab opens it). Unit (Vitest, node): notes repository, reminders (one-time/daily/weekly, DST gaps and overlaps, time-zone change, missed reminders, no duplicate notifications), window-bounds restore (negative coordinates, disconnected monitors), backup/export/import, migrations and corruption recovery, settings, IPC validation, shortcuts. Component/hook (jsdom): debounced autosave and flush, dashboard states. E2E (Playwright + Electron): launch, context isolation, create note → own window → autosave → survives restart, and the edge dock.

Not covered by automation (needs a real Windows desktop): native notifications and click-through, tray, global shortcuts, real dragging/multi-monitor, launch at login, installer. See `docs/WINDOWS_TEST_CHECKLIST.md`.
