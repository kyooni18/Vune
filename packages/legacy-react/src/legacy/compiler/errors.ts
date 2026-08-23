export interface VuneSyntaxError extends SyntaxError {
  readonly offset?: number
}

export function vuneSyntaxError(message: string, offset?: number): VuneSyntaxError {
  const error = new SyntaxError(message) as VuneSyntaxError
  if (offset !== undefined) Object.defineProperty(error, 'offset', { configurable: false, value: offset })
  return error
}
