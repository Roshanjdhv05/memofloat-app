import { LIMITS } from '@shared/constants'

/** Mirrors normalizeTag() in shared/schemas.ts (kept separate so the renderer does not bundle Zod). */
export function normalizeTag(value: string): string {
  return value.trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, LIMITS.tagMax)
}
