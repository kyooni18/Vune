import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createContext, createElement, createRef, useContext } from 'react'
import { createRoot } from 'react-dom/client'
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

test('Alert exposes one alertdialog host with labelled content', async () => {
  const restore = installDOM()
  try {
    const presented = State(true)
    const App = view(() => Alert(presented, {
      title: 'Delete item?',
      message: 'This cannot be undone.',
      actions: [{ label: 'Cancel', role: 'cancel' }],
    }))
    const root = createRoot(document.getElementById('root'))
    await act(async () => { root.render(createElement(App)) })
    const dialogs = document.querySelectorAll('[role="alertdialog"]')
    assert.equal(dialogs.length, 1)
    assert.equal(dialogs[0].querySelectorAll('[role="dialog"]').length, 0)
    assert.ok(dialogs[0].getAttribute('aria-labelledby'))
    assert.ok(dialogs[0].getAttribute('aria-describedby'))
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

test('Menu exposes keyboard-navigable menuitems', async () => {
  const restore = installDOM()
  try {
    const App = view(() => Menu(
      'Actions',
      Button('Edit', () => undefined),
      Button('Delete', () => undefined),
    ))
    const root = createRoot(document.getElementById('root'))
    await act(async () => { root.render(createElement(App)) })
    const details = document.querySelector('details')
    details.setAttribute('open', '')
    const summary = details.querySelector('summary')
    await act(async () => {
      summary.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    assert.equal(document.activeElement?.textContent, 'Edit')
    assert.equal(details.querySelectorAll('[role="menuitem"]').length, 2)
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
