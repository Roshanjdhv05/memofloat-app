import type { ApiError, ApiResult, ErrorCode } from '@shared/types'

/** Error thrown when the main process answers with `{ ok: false }`. */
export class ApiCallError extends Error {
  readonly code: ErrorCode
  constructor(error: ApiError) {
    super(error.message)
    this.name = 'ApiCallError'
    this.code = error.code
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

/** Unwraps a typed API result, turning failures into exceptions the UI can catch. */
export async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  let result: ApiResult<T>
  try {
    result = await promise
  } catch {
    throw new ApiCallError({ code: 'UNAVAILABLE', message: 'MemoFloat could not reach its background service.' })
  }
  if (!result.ok) throw new ApiCallError(result.error)
  return result.value
}

/** Lazily resolved so tests can install a fake `window.memofloat` before first use. */
export const api = () => window.memofloat
