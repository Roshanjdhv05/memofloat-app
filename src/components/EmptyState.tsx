import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

interface Props {
  title: string
  message: string
  action?: ReactNode
  icon?: ReactNode
}

export function EmptyState({ title, message, action, icon }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center"
    >
      {icon && <div className="mb-4 text-faint">{icon}</div>}
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p className="mt-1.5 text-sm text-soft">{message}</p>
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </motion.div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center">
      <h2 className="text-lg font-semibold text-text">Notes could not be loaded</h2>
      <p className="mt-1.5 text-sm text-soft">{message}</p>
      <button type="button" onClick={onRetry} className="mt-5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:brightness-110">
        Try again
      </button>
    </div>
  )
}

export function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60 ${props.className ?? ''}`}
    >
      {children}
    </button>
  )
}

export function GhostButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm text-text transition hover:bg-surface-3 active:scale-[0.98] disabled:opacity-60 ${props.className ?? ''}`}
    >
      {children}
    </button>
  )
}
