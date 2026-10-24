import type { AppInfo } from '@shared/types'
import type { Core } from '../services/core'
import type { DockWindow } from '../services/dock-window'
import type { DataActions } from '../services/data-actions'
import type { Logger } from '../services/logger'
import type { ShortcutService } from '../services/shortcuts'
import type { WindowManager } from '../services/window-manager'

export interface IpcContext {
  core: Core
  windows: WindowManager
  dock: DockWindow
  shortcuts: ShortcutService
  data: DataActions
  logger: Logger
  appInfo: () => AppInfo
  quit: () => void
}
