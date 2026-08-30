import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getVuneBoundaryElement,
  getVuneDevtoolsSnapshot,
  recordVuneBoundaryDisposed,
  recordVuneBoundaryRender,
  recordVuneRuntimeEvent,
  resetVuneDevtools,
  setVuneDevtoolsEnabled,
  subscribeVuneDevtools,
} from '../packages/web/dist/devtools.js'

test('web devtools aggregates boundary costs without affecting disabled builds', async () => {
  resetVuneDevtools()
  setVuneDevtoolsEnabled(false)
  recordVuneBoundaryRender({ key: 'ignored', name: 'Ignored', durationMs: 9, dependencyCount: 1, nodeCount: 1, mode: 'compiled' })
  recordVuneRuntimeEvent('compiledPatches')
  assert.equal(getVuneDevtoolsSnapshot().boundaries.length, 0)
  assert.equal(getVuneDevtoolsSnapshot().runtime.compiledPatches, 0)

  let notifications = 0
  const unsubscribe = subscribeVuneDevtools(() => { notifications += 1 })
  setVuneDevtoolsEnabled(true)
  const element = { isConnected: true }
  recordVuneBoundaryRender({ key: 'root/Card', name: 'Card', durationMs: 2, dependencyCount: 3, nodeCount: 4, mode: 'compiled', element })
  recordVuneBoundaryRender({ key: 'root/Card', name: 'Card', durationMs: 4, dependencyCount: 2, nodeCount: 4, mode: 'reconcile' })
  recordVuneRuntimeEvent('boundaryInvalidations', 2)
  recordVuneRuntimeEvent('compiledPatches')
  await new Promise(resolve => queueMicrotask(resolve))
  const card = getVuneDevtoolsSnapshot().boundaries[0]
  assert.equal(card.renderCount, 2)
  assert.equal(card.totalDurationMs, 6)
  assert.equal(card.maxDurationMs, 4)
  assert.equal(card.dependencyCount, 2)
  assert.equal(card.mode, 'reconcile')
  assert.equal(getVuneDevtoolsSnapshot().runtime.boundaryInvalidations, 2)
  assert.equal(getVuneDevtoolsSnapshot().runtime.compiledPatches, 1)
  assert.equal(notifications, 1)
  assert.equal(getVuneBoundaryElement('root/Card'), element)

  recordVuneBoundaryDisposed('root/Card')
  assert.equal(getVuneDevtoolsSnapshot().boundaries.length, 0)
  assert.equal(getVuneBoundaryElement('root/Card'), null)
  resetVuneDevtools()
  assert.deepEqual(getVuneDevtoolsSnapshot().runtime, {
    boundaryInvalidations: 0,
    boundaryFlushes: 0,
    boundaryUpdates: 0,
    compiledPatches: 0,
    reconcilePasses: 0,
    rootRequests: 0,
    rootPasses: 0,
    rootEscalations: 0,
    collectionFallbacks: 0,
  })
  unsubscribe()
  setVuneDevtoolsEnabled(false)
})
