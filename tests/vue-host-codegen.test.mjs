import assert from 'node:assert/strict'
import test from 'node:test'
import { compileVuneFile, createVuneVitePlugin, generateVueHostModule } from '../packages/compiler/dist/index.js'

test('compiler emits a reusable legacy host binding plan', () => {
  const source = `struct StatusBadge: View {
  let enabled: boolean
  let count: number
  init(enabled: boolean, count: number) { self.enabled = enabled; self.count = count }
  var body: some View { Text(String(count)) }
}`
  const compiled = compileVuneFile(source, 'StatusBadge.vune')
  assert.match(compiled.code, /legacyHost:/)
  assert.match(compiled.code, /coercion:\s*["']boolean["']/)
  assert.match(compiled.code, /coercion:\s*["']number["']/)
})

test('compiler can generate a typed transitional Vue host module', () => {
  const source = `struct StatusBadge: View {
  let enabled: boolean
  let count: number
  init(enabled: boolean, count: number) { self.enabled = enabled; self.count = count }
  var body: some View { Text(String(count)) }
}`
  const generated = generateVueHostModule(source, 'StatusBadge.vune', {
    viewName: 'StatusBadge',
    viewImport: './StatusBadge.vune',
    hostFactoryImport: '#legacy-host',
    aliases: { enabled: 'active' },
  })
  assert.equal(generated.viewName, 'StatusBadge')
  assert.match(generated.code, /export interface StatusBadgeVueProps/)
  assert.match(generated.code, /active\??: boolean/)
  assert.match(generated.code, /count\??: number/)
  assert.match(generated.code, /createVuneWebHost\(StatusBadge/)
  assert.match(generated.code, /from ["']#legacy-host["']/)
  assert.match(generated.code, /\$props: StatusBadgeVueProps/)
  assert.match(generated.code, /\{\"enabled\":\"active\"\}/)
})


test('vite can emit the transitional Vue host directly from a .vune import query', () => {
  const source = `struct StatusBadge: View {
  let count: number
  init(count: number) { self.count = count }
  var body: some View { Text(String(count)) }
}`
  const plugin = createVuneVitePlugin({ vueHost: { factoryImport: '#legacy-host' } })
  const generated = plugin.transform(source, '/src/StatusBadge.vune?vue-host')
  assert.match(generated?.code ?? '', /createVuneWebHost\(StatusBadge/)
  assert.doesNotMatch(generated?.code ?? '', /export interface|\sas\stypeof/)
  assert.match(generated?.code ?? '', /export default StatusBadgeVueHost/)
  assert.match(generated?.code ?? '', /from ["']#legacy-host["']/)
})


test('vue host codegen supports Views with the implicit zero-argument initializer', () => {
  const source = `struct LoadingPage: View {
  var body: some View { Text('Loading') }
}`
  const generated = generateVueHostModule(source, 'LoadingPage.vune', {
    viewImport: './LoadingPage.vune',
    hostFactoryImport: '#legacy-host',
  })
  assert.match(generated.code, /export interface LoadingPageVueProps \{\}/)
  assert.match(generated.code, /createVuneWebHost\(LoadingPage\)/)
})


test('vite hot updates invalidate only the changed Vune source cache', () => {
  const plugin = createVuneVitePlugin({ sourceMap: false })
  const source = 'struct HotView: View { var body: some View { Text("Hot") } }'
  const first = plugin.transform(source, '/tmp/HotView.vune')
  assert.ok(first?.code)
  const modules = [{ id: '/tmp/HotView.vune' }]
  assert.equal(plugin.handleHotUpdate({ file: '/tmp/HotView.vune', modules }), modules)
  const second = plugin.transform(source.replace('Hot', 'Warm'), '/tmp/HotView.vune')
  assert.ok(second?.code)
  assert.notEqual(first.code, second.code)
})
