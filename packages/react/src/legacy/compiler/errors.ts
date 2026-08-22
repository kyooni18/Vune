export interface MuseSyntaxError extends SyntaxError {
  readonly offset?: number
}

export function museSyntaxError(message: string, offset?: number): MuseSyntaxError {
  const error = new SyntaxError(message) as MuseSyntaxError
  if (offset !== undefined) Object.defineProperty(error, 'offset', { configurable: false, value: offset })
  return error
}
