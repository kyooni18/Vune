type Focusable = Element & { focus?: (options?: { preventScroll?: boolean }) => void; disabled?: boolean }

type FocusScopeRecord = {
  readonly previous: Focusable | null
  mode: string
  readonly keydown: (event: Event) => void
}

const scopes = new WeakMap<Element, FocusScopeRecord>()
const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
].join(',')

function focusableChildren(scope: Element): Focusable[] {
  return [...scope.querySelectorAll(focusableSelector)].filter(candidate => {
    const item = candidate as Focusable
    return item.disabled !== true && typeof item.focus === 'function'
  }) as Focusable[]
}

function activeElement(scope: Element): Focusable | null {
  const value = scope.ownerDocument?.activeElement
  return value && typeof (value as Focusable).focus === 'function' ? value as Focusable : null
}

export function syncFocusScope(element: Element, value: unknown): void {
  const mode = typeof value === 'string' ? value : value ? 'contain' : ''
  if (!mode) {
    disposeFocusScope(element)
    return
  }
  const existing = scopes.get(element)
  if (existing) {
    existing.mode = mode
    return
  }
  const previous = activeElement(element)
  const record: FocusScopeRecord = {
    previous,
    mode,
    keydown: event => {
      const keyboard = event as KeyboardEvent
      if (keyboard.key !== 'Tab') return
      const focusables = focusableChildren(element)
      if (focusables.length === 0) return
      const active = activeElement(element)
      const current = active ? focusables.indexOf(active) : -1
      const next = keyboard.shiftKey
        ? (current <= 0 ? focusables.length - 1 : current - 1)
        : (current < 0 || current >= focusables.length - 1 ? 0 : current + 1)
      keyboard.preventDefault()
      focusables[next]?.focus?.({ preventScroll: true })
    },
  }
  scopes.set(element, record)
  element.addEventListener('keydown', record.keydown)
}

export function disposeFocusScope(element: Element): void {
  const record = scopes.get(element)
  if (!record) return
  scopes.delete(element)
  element.removeEventListener('keydown', record.keydown)
  if (record.mode !== 'restore' || !record.previous) return
  const previous = record.previous
  queueMicrotask(() => {
    if ((previous as Element).isConnected) previous.focus?.({ preventScroll: true })
  })
}
