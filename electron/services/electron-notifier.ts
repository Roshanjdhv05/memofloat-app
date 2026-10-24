import { Notification } from 'electron'
import type { Logger } from './logger'
import { formatBatch, type FormattedNotification } from './notification-format'
import { iconPath } from './paths'
import type { DueNotification, Notifier } from './reminder-service'

export interface ElectronNotifierOptions {
  locale: () => string
  timeZone: () => string
  clock: () => Date
  onOpen: (target: FormattedNotification['target']) => void
  logger: Logger
}

/** Shows Windows toast notifications. Clicking one opens the note (or the reminders view for a summary). */
export class ElectronNotifier implements Notifier {
  /** Strong references: an unreferenced Notification can be garbage-collected before the user clicks it. */
  private readonly live = new Set<Notification>()

  constructor(private readonly options: ElectronNotifierOptions) {}

  notify(items: DueNotification[]): void {
    if (!Notification.isSupported()) {
      this.options.logger.warn('Desktop notifications are not supported on this system')
      return
    }
    const formatted = formatBatch(items, {
      locale: this.options.locale(),
      timeZone: this.options.timeZone(),
      now: this.options.clock()
    })
    this.options.logger.info('Showing reminder notifications', { count: formatted.length })
    for (const item of formatted) this.show(item)
  }

  private show(item: FormattedNotification): void {
    try {
      const notification = new Notification({
        title: item.title,
        body: item.body,
        icon: iconPath('icon.png'),
        silent: false
      })
      this.live.add(notification)
      const release = () => this.live.delete(notification)
      notification.on('click', () => {
        release()
        this.options.onOpen(item.target)
      })
      notification.on('close', release)
      notification.on('failed', (_event, error) => {
        this.options.logger.warn('Notification failed', { error })
        release()
      })
      notification.on('show', () => this.options.logger.info('Notification shown'))
      notification.show()
    } catch (error) {
      this.options.logger.error('Could not show a notification', { error })
    }
  }
}
