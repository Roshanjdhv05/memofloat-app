import { useEffect, type RefObject } from 'react'

/** Calls `onDismiss` on Escape or a pointer press outside `ref` while `active`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!active) return
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onDismiss()
      }
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [ref, active, onDismiss])
}
