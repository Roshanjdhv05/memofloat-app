# Manual Windows test checklist

Run on Windows 10/11 with the installed build (or `npm run dev`). Tick each item; note failures.

## Install
- [ ] Run `MemoFloat-Setup-<version>-x64.exe` → SmartScreen "More info → Run anyway" (unsigned) → install, desktop and Start-menu shortcuts exist.
- [ ] First launch opens the dashboard; tray icon appears.

## Notes and windows
- [ ] New note (header button, Ctrl+N, tray, Ctrl+Alt+N) opens a floating window with the unfold animation.
- [ ] Drag by the title strip: the **window moves**. Resize from edges: min size 220×140 respected.
- [ ] Type a title/body; "Saved" indicator appears; close immediately after typing → reopen: text intact.
- [ ] Pin, change colour, always-on-top (stays above other apps), collapse/expand, hide, close.
- [ ] Checklist: add/check/reorder/delete items; tags add/remove.
- [ ] Delete from the dashboard asks for confirmation; Archive/restore works.
- [ ] Quit from the tray, relaunch: all note windows return at the same place and size.

## Edge dock
- [ ] A narrow sliver with one small coloured marker per note is visible at the right edge of the primary screen, vertically centred, above other windows, not in the taskbar.
- [ ] Hover it: tabs (one per note, coloured like the note, title vertical) slide out with a + button below.
- [ ] Rest the pointer on a tab: a preview card (title, text, "edited …") appears to its left; moving to another tab switches the preview; clicking the card or tab opens the note.
- [ ] While the dock is open, clicking the empty area beside the tabs reaches the app underneath (click-through).
- [ ] Move away: after a short delay the tabs slide back; clicks on apps under the edge work normally when collapsed.
- [ ] + creates a new note window; clicking a tab opens/focuses that note.
- [ ] Taskbar on the right side or a different DPI scale: the dock sits beside the taskbar, not under it.
- [ ] Settings → Edge dock off removes it; on brings it back.

## Multi-monitor
- [ ] Move a note to a second monitor, quit, relaunch: restored there.
- [ ] Quit, unplug/disable that monitor, relaunch: note appears on a visible screen, not off-screen.
- [ ] Place a note at negative coordinates (monitor left of primary): restored correctly.

## Reminders
- [ ] One-time reminder 2 minutes ahead: the note window opens by itself and comes to the front, and a Windows notification appears; clicking the notification opens the note.
- [ ] Daily and weekly reminders advance to the next occurrence after firing.
- [ ] Close the dashboard (app in tray): reminder still fires.
- [ ] Quit the app, wait past a due time, start it: one notification, no duplicates.
- [ ] Sleep the PC through a due time, wake: it is announced once.
- [ ] Change the Windows time zone or cross a DST change: recurring reminders keep the same local wall time.
- [ ] Focus assist on: notification is suppressed by Windows (expected); it still appears in Upcoming/Overdue.

## Tray and shortcuts
- [ ] Tray menu: New Note / Show MemoFloat / Show-hide all notes / Focus mode / Settings / Quit all work.
- [ ] Ctrl+Alt+N / H / D work from other apps. Re-bind in Settings; bind a combo used by another app → clear warning.

## Dashboard and settings
- [ ] Sidebar sections and counts, search (Ctrl+F), sort, grid/list toggle persists after restart.
- [ ] Light/dark/system theme; Reduce motion On disables tilt and unfold animation.
- [ ] Launch at sign-in on → sign out/in: starts in tray, notes restored, no dashboard popup.
- [ ] Export JSON, Back up database, Import (preview → choose strategy → import); data folder opens.

## Accessibility
- [ ] Keyboard-only: Tab through dashboard and a note window; focus ring visible; Escape closes dialogs.
- [ ] Narrator announces buttons by name; 150% display scaling looks right.

## Uninstall
- [ ] Uninstall asks whether to delete data; "No" keeps `%APPDATA%\MemoFloat`.
