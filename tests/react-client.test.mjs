import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createContext, createElement, createRef, useContext } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import {
  Alert,
  Button,
  ElementRef,
  Menu,
  Sheet,
  State,
  Text,
  TextField,
  VStack,
  view,
} from '../dist/index.js'

function installDOM() {
  const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {
    url: 'http://localhost/',
  })
  const previous = new Map()
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'MutationObserver', 'getComputedStyle']) {
    previous.set(name, globalThis[name])
    globalThis[name] = name === 'getComputedStyle' ? dom.window.getComputedStyle : dom.window[name]
  }
  previous.set('navigator', globalThis.navigator)
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  previous.set('IS_REACT_ACT_ENVIRONMENT', globalThis.IS_REACT_ACT_ENVIRONMENT)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  return () => {
    dom.window.close()
    for (const [name, value] of previous) {
      if (name === 'navigator') Object.defineProperty(globalThis, name, { configurable: true, value })
      else if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
}

test('State-driven views rerender and controlled inputs update in JSDOM', async () => {
  const restore = installDOM()
  try {
    const App = view({
      state: () => ({ count: State(0), name: State('') }),
      body: ({ count, name }) => VStack(
        Text(() => `Count: ${count.value}`),
        Button('Increment', () => { count.value += 1 }),
        TextField(name, { 'aria-label': 'Name' }),
      ),
    })
    const root = createRoot(document.getElementById('root'))
    await act(async () => { root.render(createElement(App)) })
    assert.match(document.body.textContent, /Count: 0/)

    await act(async () => {
      document.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.match(document.body.textContent, /Count: 1/)

    const input = document.querySelector('input')
    input.value = 'Rui'
    await act(async () => {
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    assert.equal(input.value, 'Rui')

    await act(async () => { root.unmount() })
    assert.equal(document.getElementById('root').textContent, '')
  } finally {
    restore()
  }
})

test('SSR markup hydrates without layout, State, or useId mismatches', async () => {
  const restore = installDOM()
  try {
    const App = view({
      state: () => ({ count: State(1), alert: State(true) }),
      body: ({ count, alert }) => VStack(
        Text(() => `Count: ${count.value}`).padding(4),
        Menu('Actions', Button('Refresh', () => undefined)),
        Alert(alert, { title: 'Hydrated alert', message: 'Portal content' }),
      ),
    })
    const container = document.getElementById('root')
    const markup = renderToString(createElement(App))
    container.innerHTML = markup
    const recoverableErrors = []
    const root = hydrateRoot(container, createElement(App), {
      onRecoverableError(error) { recoverableErrors.push(error) },
    })
    await act(async () => {})
    assert.equal(recoverableErrors.length, 0)
    assert.match(container.textContent, /Count: 1/)
    assert.ok(container.querySelector('[data-rui-menu]'))
    assert.ok(container.querySelector('[data-rui-layout-host]'))
    assert.equal(document.querySelectorAll('[role="alertdialog"]').length, 1)
    await act(async () => { root.unmount() })
  } finally {
    restore()
  }
})

test('Sheet closes on Escape, traps focus, and restores the opener', async () => {
  const restore = installDOM()
  try {
    const App = view({
      state: () => ({ presented: State(false) }),
      body: ({ presented }) => VStack(
        Button('Open', () => { presented.value = true }),
        Sheet(presented, VStack(
          Button('First', () => undefined),
          Button('Close', () => { presented.value = false }),
        ), {
          placement: 'center',
          ariaLabel: 'Demo sheet',
        }),
      ),
    })
    const root = createRoot(document.getElementById('root'))
    await act(async () => { root.render(createElement(App)) })
    const opener = document.querySelector('button')
    opener.focus()

    await act(async () => {
      opener.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    const panel = document.querySelector('[data-rui-sheet]')
    assert.ok(panel)
    assert.equal(panel.getAttribute('role'), 'dialog')
    assert.equal(document.activeElement?.textContent, 'First')
    const sheetButtons = panel.querySelectorAll('button')
    sheetButtons[1].focus()
    await act(async () => {
      sheetButtons[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    assert.equal(document.activeElement, sheetButtons[0])

    await act(async () => {
      panel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(document.querySelector('[data-rui-sheet]'), null)
    assert.equal(document.activeElement, opener)

    await act(async () => { root.unmount() })
  } finally {
    restore()
  }
})

test('stacked presentations keep the newest portal on top and close it first', async () => {
  const restore = installDOM()
  try {
    let stateRefs
    const App = view({
      state: () => {
        stateRefs = { outer: State(true), inner: State(false), alert: State(false) }
        return stateRefs
      },
      body: ({ outer, inner, alert }) => VStack(
        Sheet(outer, VStack(
          Button('Open nested', () => { inner.value = true }),
          Sheet(inner, Button('Nested close', () => { inner.value = false }), { placement: 'center' }),
        ), { placement: 'center', ariaLabel: 'Outer sheet' }),
        Alert(alert, { title: 'Alert', message: 'Top-level alert' }),
      ),
    })
    const root = createRoot(document.getElementById('root'))
    await act(async () => { root.render(createElement(App)) })
    const outerPanel = document.querySelector('[data-rui-sheet]')
    assert.ok(outerPanel)
    const openNested = [...outerPanel.querySelectorAll('button')].find(button => button.textContent === 'Open nested')
    await act(async () => {
      openNested.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    const panels = document.querySelectorAll('[data-rui-sheet]')
    assert.equal(panels.length, 2)
    const backdrops = document.querySelectorAll('[data-rui-sheet-backdrop]')
    assert.equal(backdrops[0].style.zIndex, '1000')
    assert.equal(backdrops[1].style.zIndex, '1001')

    await act(async () => {
      panels[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(document.querySelectorAll('[data-rui-sheet]').length, 1)
    assert.equal(stateRefs.outer.value, true)

    await act(async () => { stateRefs.alert.value = true })
    assert.equal(document.querySelectorAll('[role="alertdialog"]').length, 1)
    await act(async () => {
      document.querySelector('[role="alertdialog"] button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(stateRefs.alert.value, false)
    assert.equal(document.querySelectorAll('[data-rui-sheet]').length, 1)

    await act(async () => { root.unmount() })
  } finally {
    restore()
  }
})

test('Alert uses unique labelled IDs for simultaneously mounted dialogs', async () => {
  const restore = installDOM()
  try {
    const first = State(true)
    const second = State(true)
    const App = view(() => VStack(
      Alert(first, { title: 'First', message: 'First message' }),
      Alert(second, { title: 'Second', message: 'Second message' }),
    ))
    const root = createRoot(document.getElementById('root'))
    await act(async () => { root.render(createElement(App)) })
    const dialogs = document.querySelectorAll('[role="alertdialog"]')
    assert.equal(dialogs.length, 2)
    const labelledBy = [...dialogs].map(dialog => dialog.getAttribute('aria-labelledby'))
    const describedBy = [...dialogs].map(dialog => dialog.getAttribute('aria-describedby'))
    assert.equal(new Set(labelledBy).size, 2)
    assert.equal(new Set(describedBy).size, 2)
    for (const [index, dialog] of [...dialogs].entries()) {
      assert.equal(dialog.querySelectorAll('[role="dialog"]').length, 0)
      assert.ok(dialog.querySelector(`#${labelledBy[index]}`))
      assert.ok(dialog.querySelector(`#${describedBy[index]}`))
    }
    await act(async () => { root.unmount() })
  } finally {
    restore()
  }
})

test('client views switch State dependencies and preserve refs, context, and modifiers', async () => {
  const restore = installDOM()
  try {
    const Theme = createContext('missing')
    function ContextValue() {
      return createElement('span', { 'data-context': true }, useContext(Theme))
    }
    const buttonRef = createRef()
    let stateRefs
    let renders = 0
    const App = view({
      state: () => {
        stateRefs = { mode: State(false), first: State('first'), second: State('second') }
        return stateRefs
      },
      body: ({ mode, first, second }) => {
        renders += 1
        return createElement(
          Theme.Provider,
          { value: 'provided' },
          VStack(
            Text(() => mode.value ? first.value : second.value),
            createElement(ContextValue),
            ElementRef(buttonRef, Button('Switch', () => { mode.value = true })).padding(4),
          ),
        )
      },
    })
    const root = createRoot(document.getElementById('root'))
    await act(async () => { root.render(createElement(App)) })
    assert.match(document.body.textContent, /second/)
    assert.equal(document.querySelector('[data-context]').textContent, 'provided')
    assert.ok(buttonRef.current)
    assert.equal(buttonRef.current.style.padding, '4px')

    await act(async () => {
      document.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.match(document.body.textContent, /first/)
    const rendersAfterSwitch = renders
    await act(async () => { stateRefs.second.value = 'unused' })
    assert.equal(renders, rendersAfterSwitch)
    await act(async () => { stateRefs.first.value = 'updated' })
    assert.match(document.body.textContent, /updated/)

    await act(async () => { root.unmount() })
  } finally {
    restore()
  }
})

test('dynamic State dependencies clean up across repeated branch switches', async () => {
  const restore = installDOM()
  try {
    let stateRefs
    let renders = 0
    const App = view({
      state: () => {
        stateRefs = { condition: State(false), first: State('first'), second: State('second') }
        return stateRefs
      },
      body: ({ condition, first, second }) => {
        renders += 1
        return VStack(
          Text(() => condition.value ? first.value : second.value),
          Button('Switch', () => { condition.value = !condition.value }),
        )
      },
    })
    const root = createRoot(document.getElementById('root'))
    await act(async () => { root.render(createElement(App)) })

    for (let index = 0; index < 6; index += 1) {
      const inactive = stateRefs.condition.value ? stateRefs.second : stateRefs.first
      const beforeInactiveMutation = renders
      inactive.value = `${inactive.value}-stale-${index}`
      assert.equal(renders, beforeInactiveMutation)

      await act(async () => {
        document.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      })
      assert.ok(renders > beforeInactiveMutation)
    }

    const rendersBeforeUnmount = renders
    await act(async () => { root.unmount() })
    stateRefs.first.value = 'after-unmount'
    stateRefs.second.value = 'after-unmount'
    assert.equal(renders, rendersBeforeUnmount)
  } finally {
    restore()
  }
})

test('Menu exposes keyboard-navigable menuitems', async () => {
  const restore = installDOM()
  try {
    const App = view(() => Menu(
      'Actions',
      Button('Disabled', () => undefined, { disabled: true }),
      Button('Edit', () => undefined),
      Button('Delete', () => undefined),
    ))
    const root = createRoot(document.getElementById('root'))
    await act(async () => { root.render(createElement(App)) })
    const details = document.querySelector('details')
    details.setAttribute('open', '')
    details.dispatchEvent(new window.Event('toggle', { bubbles: false }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const summary = details.querySelector('summary')
    assert.equal(document.activeElement?.textContent, 'Edit')
    await act(async () => {
      summary.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    assert.equal(document.activeElement?.textContent, 'Delete')
    assert.equal(details.querySelectorAll('[role="menuitem"]').length, 3)
    await act(async () => {
      document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    assert.equal(document.activeElement?.textContent, 'Delete')
    await act(async () => {
      document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    assert.equal(document.activeElement?.textContent, 'Edit')
    await act(async () => {
      document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'e', bubbles: true }))
    })
    assert.equal(document.activeElement?.textContent, 'Edit')

    await act(async () => {
      document.activeElement.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(details.open, false)
    assert.equal(document.activeElement, summary)

    await act(async () => {
      details.setAttribute('open', '')
      details.dispatchEvent(new window.Event('toggle', { bubbles: false }))
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    assert.equal(document.activeElement?.textContent, 'Edit')
    await act(async () => {
      document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    assert.equal(details.open, false)

    await act(async () => {
      details.setAttribute('open', '')
      details.dispatchEvent(new window.Event('toggle', { bubbles: false }))
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    await act(async () => {
      document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(details.open, false)
    assert.equal(document.activeElement, summary)

    await act(async () => { root.unmount() })
  } finally {
    restore()
  }
})
