import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { jsx, jsxDEV, jsxs } from '../dist/jsx-runtime.js'
import { Fragment as DevFragment, jsxDEV as devJsxDEV } from '../dist/jsx-dev-runtime.js'
import {
  Grid,
  Group,
  HStack,
  styled,
  Text,
  VStack,
} from '../dist/index.js'
import {
  DEFAULT_BUILDER_COMPONENTS,
  createRuiSwcVisitor,
  createRuiVitePlugin,
  transformRuiBuilderSyntax,
} from '../dist/compiler/index.js'
import { coordinateSpace, coordinateSpaceOf, emptyLayoutNode } from '../dist/coordinate.js'
import { createLayoutNode, layoutPass } from '../dist/layout-engine.js'
import { getRuiNodeMetadata, markRuiNode } from '../dist/runtime/jsx-node.js'
import { applyRuiPlugins, registerRuiPlugin, unregisterRuiPlugin } from '../dist/runtime/modifier-pipeline.js'
import { globalCoordinates } from '../dist/runtime/coordinate-runtime.js'
import { observeLayout } from '../dist/runtime/layout-observer.js'

test('transforms nested builder blocks without touching source text', () => {
  const source = `
const example = 'VStack() { not syntax }'
// VStack() { also not syntax }
VStack({ spacing: 8 }) {
  Text('A')
  HStack() {
    Text('B')
    Text('C')
  }
}
`

  const output = transformRuiBuilderSyntax(source)
  assert.match(output, /VStack\(\{ spacing: 8 \}, \(\) => \[/)
  assert.match(output, /HStack\(\(\) => \[Text\('B'\), Text\('C'\)\]\)/)
  assert.match(output, /'VStack\(\) \{ not syntax \}'/)
  assert.match(output, /\/\/ VStack\(\) \{ also not syntax \}/)

  assert.equal(
    transformRuiBuilderSyntax("VStack() { Text('A') // keep this\n Text('B') }"),
    "VStack(() => [Text('A') /* keep this*/, Text('B')])",
  )
})

test('builder transformer supports custom components and reports malformed blocks', () => {
  assert.equal(
    transformRuiBuilderSyntax('Card() { Text(\'Card\') }', ['Card']),
    "Card(() => [Text('Card')])",
  )
  assert.deepEqual(DEFAULT_BUILDER_COMPONENTS, ['VStack', 'HStack', 'ZStack', 'Group', 'Grid'])
  assert.throws(
    () => transformRuiBuilderSyntax('VStack() { Text(\'missing\')'),
    /Unclosed \{ block/,
  )
})

test('builder runtime supports plain, optioned, nested, Group, and Grid builders', () => {
  assert.match(renderToStaticMarkup(VStack(() => [Text('A'), Text('B')])), />A<.*>B</s)
  assert.match(renderToStaticMarkup(VStack({ spacing: 8 }, () => Text('A'))), /gap:8px/)
  assert.match(renderToStaticMarkup(HStack(() => [Text('A')])), />A</s)
  assert.match(renderToStaticMarkup(Group(() => [Text('A')])), />A</s)
  assert.match(renderToStaticMarkup(Grid(2, () => [Text('A')])), /repeat\(2, minmax\(0, 1fr\)\)/)
})

test('Vite and SWC adapters use the same builder transform and support query IDs', () => {
  const source = "VStack() { Text('A') }"
  const vite = createRuiVitePlugin()
  assert.deepEqual(vite.transform(source, '/src/App.tsx?direct'), {
    code: "VStack(() => [Text('A')])",
    map: null,
  })
  assert.equal(vite.transform(source, '/src/App.css'), null)

  const swc = createRuiSwcVisitor()
  assert.equal(swc.transform(source), "VStack(() => [Text('A')])")
})

test('Rui JSX runtimes preserve native props and apply all style modifiers', () => {
  const production = jsxs('div', {
    id: 'root',
    padding: 4,
    minWidth: 10,
    fontWeight: 700,
    children: ['Hello', jsx('span', { children: ' Rui' })],
  })
  const development = jsxDEV('div', {
    opacity: 0.5,
    children: 'Dev',
  }, undefined, false, undefined, undefined)

  assert.match(renderToStaticMarkup(production), /id="root"/)
  assert.match(renderToStaticMarkup(production), /padding:4px/)
  assert.match(renderToStaticMarkup(production), /min-width:10px/)
  assert.match(renderToStaticMarkup(production), /font-weight:700/)
  assert.match(renderToStaticMarkup(development), /opacity:0\.5/)
  assert.equal(DevFragment, DevFragment)
  assert.equal(typeof devJsxDEV, 'function')
})

test('JSX nodes pass through registered plugins and retain metadata', () => {
  registerRuiPlugin({
    name: 'test-plugin',
    apply: element => styled(element).attr('data-plugin', 'yes'),
  })
  try {
    const element = jsx('div', { padding: 4, children: 'Plugin' })
    const html = renderToStaticMarkup(element)
    assert.match(html, /data-plugin="yes"/)
    assert.deepEqual(getRuiNodeMetadata(element), { modifiers: ['padding'], layout: undefined })
    assert.equal(applyRuiPlugins(element).props['data-plugin'], 'yes')
  } finally {
    assert.equal(unregisterRuiPlugin('test-plugin'), true)
  }
})

test('coordinate, layout, and node metadata APIs retain their contracts', () => {
  const target = {}
  coordinateSpace(target, 'screen')
  assert.equal(coordinateSpaceOf(target), 'screen')
  assert.equal(coordinateSpaceOf({}), 'local')
  assert.deepEqual(emptyLayoutNode('root').frame, { x: 0, y: 0, width: 0, height: 0 })

  let receivedProposal
  const child = createLayoutNode('child', proposal => {
    receivedProposal = proposal
    return {
      x: 1,
      y: 2,
      width: proposal.width ?? 0,
      height: proposal.height ?? 0,
    }
  })
  const root = createLayoutNode('root', () => ({ x: 0, y: 0, width: 100, height: 50 }), [child])
  assert.deepEqual(layoutPass(root, {}), { x: 0, y: 0, width: 100, height: 50 })
  assert.deepEqual(child.frame, { x: 1, y: 2, width: 100, height: 50 })
  assert.deepEqual(receivedProposal, { width: 100, height: 50 })

  const element = jsx('div', { children: 'node' })
  const metadata = { modifiers: ['padding'], layout: { width: 10 } }
  assert.equal(getRuiNodeMetadata(markRuiNode(element, metadata)), metadata)
})

test('layout observation records named coordinate spaces', () => {
  const originalResizeObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  try {
    const element = { getBoundingClientRect: () => ({ x: 3, y: 4, width: 50, height: 20 }) }
    coordinateSpace(element, 'screen')
    const node = emptyLayoutNode('observed')
    const stop = observeLayout(element, node)
    assert.deepEqual(node.frame, { x: 3, y: 4, width: 50, height: 20 })
    assert.equal(node.coordinateSpace, 'screen')
    assert.deepEqual(globalCoordinates.get('screen'), node.frame)
    stop()
  } finally {
    globalThis.ResizeObserver = originalResizeObserver
  }
})
