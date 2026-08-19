import test from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp, defineComponent, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Button, Circle, HStack, ScrollView, Text, TextField, VStack } from '../dist/index.js'

test('DSL VNodes render through Vue SSR', async () => {
  const App = defineComponent({
    setup() {
      const name = ref('Hare')
      return () => VStack(
        Text(() => `Hello, ${name.value}`).bold(),
        TextField(name),
        Button('Save', () => {}),
        ScrollView(
          HStack(
            Circle().width(16).height(16).background('currentColor'),
            Text('Scrollable'),
          ).gap(4),
          'horizontal',
        ),
      ).gap(8)
    },
  })

  const html = await renderToString(createSSRApp(App))
  assert.match(html, /Hello, Hare/)
  assert.match(html, /<input/)
  assert.match(html, /<button/)
  assert.match(html, /overflow-x:auto/)
  assert.match(html, /border-radius:50%/)
})
