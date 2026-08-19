import test from 'node:test'
import assert from 'node:assert/strict'
import {
  Fragment,
  createRenderer,
  defineComponent,
  h,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
} from 'vue'
import { Component, Grid, HStack, Spacer, Text } from '../dist/index.js'

function styleOf(vnode) {
  const style = vnode.props?.style
  if (!Array.isArray(style)) return style ?? {}
  return Object.assign({}, ...style.flat(Infinity).filter(Boolean))
}

function onlyChild(vnode) {
  return Array.isArray(vnode.children) ? vnode.children[0] : vnode.children
}

function makeHostRenderer() {
  function insert(child, parent, anchor = null) {
    child.parent = parent
    if (!parent.children) parent.children = []
    if (anchor == null) {
      parent.children.push(child)
      return
    }
    const index = parent.children.indexOf(anchor)
    if (index < 0) parent.children.push(child)
    else parent.children.splice(index, 0, child)
  }

  return createRenderer({
    patchProp(el, key, _prev, next) { el.props[key] = next },
    insert,
    remove(child) {
      const parent = child.parent
      if (!parent?.children) return
      const index = parent.children.indexOf(child)
      if (index >= 0) parent.children.splice(index, 1)
      child.parent = null
    },
    createElement(type) { return { kind: 'element', type, props: {}, children: [], parent: null } },
    createText(text) { return { kind: 'text', text, parent: null } },
    createComment(text) { return { kind: 'comment', text, parent: null } },
    setText(node, text) { node.text = text },
    setElementText(el, text) {
      const child = { kind: 'text', text, parent: el }
      el.children = [child]
    },
    parentNode(node) { return node.parent },
    nextSibling(node) {
      const parent = node.parent
      if (!parent?.children) return null
      const index = parent.children.indexOf(node)
      return index < 0 ? null : parent.children[index + 1] ?? null
    },
    setScopeId(el, id) { el.scopeId = id },
    cloneNode(node) {
      return { ...node, props: { ...(node.props ?? {}) }, children: [...(node.children ?? [])], parent: null }
    },
    insertStaticContent(content, parent, anchor) {
      const node = { kind: 'static', text: content, parent: null }
      insert(node, parent, anchor)
      return [node, node]
    },
  })
}

function findNode(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return null
}

test('ordinary Vue components are one layout item next to Spacer', () => {
  const MultiRoot = defineComponent({
    name: 'MultiRoot',
    inheritAttrs: false,
    setup() {
      return () => h(Fragment, null, [h('span', null, 'A'), h('span', null, 'B')])
    },
  })

  const component = Component(MultiRoot)
    .frame({ width: 180, maxWidth: '100%' })
    .padding(8)
    .keyed('profile')

  const row = HStack(Text('Left'), Spacer(), component)
  assert.equal(row.children.length, 3)
  const host = row.children[2]
  assert.equal(host.type, 'div')
  assert.equal(host.key, 'profile')
  assert.equal(host.props['data-vune-layout-host'], '')
  assert.equal(styleOf(host).width, '180px')
  assert.equal(styleOf(host).maxWidth, '100%')
  assert.equal(styleOf(host).padding, '8px')
  const inner = onlyChild(host)
  assert.equal(inner.type, MultiRoot)
  assert.equal(inner.props?.style, undefined)
})

test('plain h(component) VNodes also receive a layout host', () => {
  const Plain = defineComponent(() => () => h('strong', null, 'plain'))
  const row = HStack(Text('A'), h(Plain), Text('B'))
  assert.equal(row.children[1].props['data-vune-layout-host'], '')
  assert.equal(onlyChild(row.children[1]).type, Plain)
  const grid = Grid(2, h(Plain), Text('B'))
  assert.equal(grid.children[0].props['data-vune-layout-host'], '')
})

test('component props, slots, emits, refs, local state and lifecycle survive the layout host', async () => {
  let mounted = 0
  let unmounted = 0
  let attrsSeen = null
  const emitted = []
  const componentRef = ref(null)

  const Interactive = defineComponent({
    name: 'Interactive',
    inheritAttrs: false,
    props: { label: { type: String, required: true } },
    emits: ['ready'],
    setup(props, { attrs, emit, expose, slots }) {
      attrsSeen = attrs
      const count = ref(0)
      expose({ readCount: () => count.value })
      onMounted(() => {
        mounted += 1
        emit('ready', props.label)
      })
      onUnmounted(() => { unmounted += 1 })
      return () => h(Fragment, null, [
        h('button', { onClick: () => count.value += 1 }, `${props.label}:${count.value}`),
        slots.default?.(),
      ])
    },
  })

  const Root = defineComponent({
    setup() {
      return () => HStack(
        Text('Left'),
        Spacer(),
        Component(
          Interactive,
          { label: 'Profile', onReady: value => emitted.push(value) },
          { default: () => Text('slot-ok') },
        )
          .padding(12)
          .templateRef(componentRef),
      )
    },
  })

  const renderer = makeHostRenderer()
  const root = { kind: 'root', children: [] }
  const app = renderer.createApp(Root)
  app.mount(root)
  await nextTick()

  assert.equal(mounted, 1)
  assert.deepEqual(emitted, ['Profile'])
  assert.deepEqual({ ...attrsSeen }, {})
  assert.ok(componentRef.value)
  assert.equal(componentRef.value.readCount(), 0)

  const row = root.children[0]
  const layoutHost = row.children[2]
  assert.equal(layoutHost.props['data-vune-layout-host'], '')
  assert.equal(layoutHost.props.style.padding, '12px')

  const button = findNode(layoutHost, node => node.kind === 'element' && node.type === 'button')
  assert.ok(button)
  button.props.onClick()
  await nextTick()
  assert.equal(componentRef.value.readCount(), 1)
  assert.equal(button.children[0].text, 'Profile:1')
  assert.ok(findNode(layoutHost, node => node.kind === 'text' && node.text === 'slot-ok'))

  app.unmount()
  await nextTick()
  assert.equal(unmounted, 1)
})
