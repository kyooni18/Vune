import test from 'node:test'
import assert from 'node:assert/strict'
import { createLineChartGPUIsland, createParticleFieldGPUIsland } from '../packages/web/dist/gpu-island.js'

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

function createHarness({ shaderError = false, submitError = false } = {}) {
  const operations = []
  const buffers = []
  const lost = new Deferred()
  let copies = 0
  let maps = 0

  const makePass = kind => ({
    setPipeline(pipeline) { operations.push([`${kind}.pipeline`, pipeline]) },
    setBindGroup(index, group) { operations.push([`${kind}.bindGroup`, index, group]) },
    dispatchWorkgroups(count) { operations.push([`${kind}.dispatch`, count]) },
    setVertexBuffer(index, buffer) { operations.push([`${kind}.vertexBuffer`, index, buffer]) },
    draw(count, instances, first, firstInstance) { operations.push([`${kind}.draw`, count, instances, first, firstInstance]) },
    end() { operations.push([`${kind}.end`]) },
  })

  const device = {
    limits: {
      maxBufferSize: 1024 * 1024,
      maxStorageBufferBindingSize: 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    lost: lost.promise,
    queue: {
      writeBuffer(buffer, offset, data) { operations.push(['queue.writeBuffer', buffer, offset, data.byteLength]) },
      submit(commands) {
        operations.push(['queue.submit', commands])
        if (submitError) throw new Error('synthetic submit failure')
      },
    },
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyed: false,
        destroy() { this.destroyed = true; operations.push(['buffer.destroy', this]) },
      }
      buffers.push(buffer)
      operations.push(['device.createBuffer', buffer])
      return buffer
    },
    createShaderModule(descriptor) {
      operations.push(['device.createShaderModule', descriptor])
      return {
        descriptor,
        async getCompilationInfo() {
          return { messages: shaderError ? [{ type: 'error', message: 'synthetic WGSL failure' }] : [] }
        },
      }
    },
    createBindGroupLayout(descriptor) { operations.push(['device.createBindGroupLayout', descriptor]); return { descriptor } },
    createPipelineLayout(descriptor) { operations.push(['device.createPipelineLayout', descriptor]); return { descriptor } },
    createComputePipeline(descriptor) { operations.push(['device.createComputePipeline', descriptor]); return { descriptor } },
    createRenderPipeline(descriptor) { operations.push(['device.createRenderPipeline', descriptor]); return { descriptor } },
    createBindGroup(descriptor) { operations.push(['device.createBindGroup', descriptor]); return { descriptor } },
    createCommandEncoder() {
      operations.push(['device.createCommandEncoder'])
      return {
        beginComputePass() { operations.push(['encoder.beginCompute']); return makePass('compute') },
        beginRenderPass(descriptor) { operations.push(['encoder.beginRender', descriptor]); return makePass('render') },
        copyBufferToBuffer() { copies += 1; throw new Error('readback copy is forbidden') },
        finish() { operations.push(['encoder.finish']); return { encoded: true } },
      }
    },
    addEventListener() {},
    removeEventListener() {},
  }
  const context = {
    configure(descriptor) { operations.push(['context.configure', descriptor]) },
    getCurrentTexture() {
      operations.push(['context.getCurrentTexture'])
      return { createView() { operations.push(['texture.createView']); return { view: true } } }
    },
  }

  return {
    buffers,
    context,
    device,
    lost,
    operations,
    readbackCounts: () => ({ copies, maps }),
    recordMap: () => { maps += 1 },
  }
}

function operationIndex(operations, name) {
  return operations.findIndex(operation => operation[0] === name)
}

test('GPU Island keeps particles resident through ordered compute and GPUCanvas rendering', async () => {
  const harness = createHarness()
  const initialData = new Float32Array([
    -0.5, 0.1, 0.2, 0.0, 1, 0, 0, 1,
    0.5, -0.1, -0.2, 0.0, 0, 1, 0, 1,
  ])
  const island = await createParticleFieldGPUIsland(harness.device, harness.context, {
    count: 2,
    format: 'bgra8unorm',
    initialData,
  })

  assert.equal(island.status, 'active')
  assert.equal(island.byteLength, initialData.byteLength)
  assert.equal(harness.buffers.length, 2)
  const [particles, parameters] = harness.buffers
  assert.equal(particles.descriptor.size, initialData.byteLength)
  assert.notEqual(particles.descriptor.usage & 128, 0, 'resident buffer has STORAGE usage')
  assert.notEqual(particles.descriptor.usage & 32, 0, 'same resident buffer has VERTEX usage')
  assert.equal(particles.descriptor.usage & 4, 0, 'resident buffer is not a copy source')
  assert.equal(particles.descriptor.usage & 1, 0, 'resident buffer is not host-readable')
  assert.equal(typeof particles.mapAsync, 'undefined')
  assert.equal(parameters.descriptor.size, 16)

  const bindGroupOperation = harness.operations.find(operation => operation[0] === 'device.createBindGroup')
  assert.equal(bindGroupOperation[1].entries[0].resource.buffer, particles)
  const renderPipelineOperation = harness.operations.find(operation => operation[0] === 'device.createRenderPipeline')
  assert.equal(renderPipelineOperation[1].layout === 'auto', false, 'render pipeline has an explicit layout')
  assert.deepEqual(renderPipelineOperation[1].vertex.buffers[0].attributes, [
    { shaderLocation: 0, offset: 0, format: 'float32x2' },
    { shaderLocation: 1, offset: 16, format: 'float32x4' },
  ])

  island.renderFrame(1 / 60)

  const vertexOperation = harness.operations.find(operation => operation[0] === 'render.vertexBuffer')
  assert.equal(vertexOperation[2], particles, 'render consumes the compute storage buffer directly')
  assert.ok(operationIndex(harness.operations, 'encoder.beginCompute') < operationIndex(harness.operations, 'compute.dispatch'))
  assert.ok(operationIndex(harness.operations, 'compute.end') < operationIndex(harness.operations, 'encoder.beginRender'))
  assert.ok(operationIndex(harness.operations, 'render.draw') < operationIndex(harness.operations, 'queue.submit'))
  assert.deepEqual(harness.readbackCounts(), { copies: 0, maps: 0 })
  assert.equal(harness.operations.some(operation => operation[0] === 'context.getCurrentTexture'), true)

  island.dispose()
  assert.equal(island.status, 'disposed')
  assert.equal(particles.destroyed, true)
  assert.equal(parameters.destroyed, true)
})

test('GPU Island validates capabilities, layout limits, and WGSL before creating pipelines', async () => {
  await assert.rejects(
    createParticleFieldGPUIsland({}, {}, { count: 1, format: 'bgra8unorm' }),
    /requires createBindGroup/,
  )

  const tooLarge = createHarness()
  tooLarge.device.limits.maxStorageBufferBindingSize = 31
  await assert.rejects(
    createParticleFieldGPUIsland(tooLarge.device, tooLarge.context, { count: 1, format: 'bgra8unorm' }),
    /maxStorageBufferBindingSize/,
  )

  const invalidShader = createHarness({ shaderError: true })
  await assert.rejects(
    createParticleFieldGPUIsland(invalidShader.device, invalidShader.context, { count: 1, format: 'bgra8unorm' }),
    /shader validation failed: synthetic WGSL failure/,
  )
  assert.equal(invalidShader.operations.some(operation => operation[0] === 'device.createComputePipeline'), false)
  assert.equal(invalidShader.buffers.every(buffer => buffer.destroyed), true)
})

test('GPU Island enters a terminal failed state on submit failure and device loss', async () => {
  const failures = []
  const submitFailure = createHarness({ submitError: true })
  const failedIsland = await createParticleFieldGPUIsland(submitFailure.device, submitFailure.context, {
    count: 1,
    format: 'rgba8unorm',
    onFailure: error => failures.push(error.message),
  })
  assert.throws(() => failedIsland.renderFrame(1 / 60), /synthetic submit failure/)
  assert.equal(failedIsland.status, 'failed')
  assert.equal(submitFailure.buffers.every(buffer => buffer.destroyed), true)
  assert.equal(failures.length, 1)
  assert.throws(() => failedIsland.renderFrame(1 / 60), /synthetic submit failure/)

  const lostHarness = createHarness()
  const lostIsland = await createParticleFieldGPUIsland(lostHarness.device, lostHarness.context, {
    count: 1,
    format: 'rgba8unorm',
  })
  lostHarness.lost.resolve({ reason: 'destroyed', message: 'adapter reset' })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(lostIsland.status, 'failed')
  assert.match(lostIsland.failure.message, /device lost: adapter reset/)
  assert.throws(() => lostIsland.renderFrame(1 / 60), /device lost: adapter reset/)
  assert.deepEqual(lostHarness.readbackCounts(), { copies: 0, maps: 0 })
})

test('GPU Islands reuse validated shader modules and pipelines on the same device', async () => {
  const harness = createHarness()
  const first = await createParticleFieldGPUIsland(harness.device, harness.context, {
    count: 1,
    format: 'bgra8unorm',
  })
  const pipelineOperationsAfterFirst = harness.operations.filter(operation =>
    operation[0] === 'device.createComputePipeline' || operation[0] === 'device.createRenderPipeline').length
  const shaderOperationsAfterFirst = harness.operations.filter(operation => operation[0] === 'device.createShaderModule').length
  const second = await createParticleFieldGPUIsland(harness.device, harness.context, {
    count: 2,
    format: 'bgra8unorm',
  })
  const pipelineOperationsAfterSecond = harness.operations.filter(operation =>
    operation[0] === 'device.createComputePipeline' || operation[0] === 'device.createRenderPipeline').length
  const shaderOperationsAfterSecond = harness.operations.filter(operation => operation[0] === 'device.createShaderModule').length

  assert.equal(pipelineOperationsAfterFirst, 2)
  assert.equal(pipelineOperationsAfterSecond, pipelineOperationsAfterFirst)
  assert.equal(shaderOperationsAfterFirst, 2)
  assert.equal(shaderOperationsAfterSecond, shaderOperationsAfterFirst)
  first.dispose()
  second.dispose()
})

test('LineChart GPU Island transforms and renders one GPU-authoritative point buffer without readback', async () => {
  const harness = createHarness()
  const initialData = new Float32Array([
    -1, -0.25, -1, -0.25,
    0, 0.5, 0, 0.5,
    1, -0.1, 1, -0.1,
  ])
  const island = await createLineChartGPUIsland(harness.device, harness.context, {
    count: 3,
    format: 'bgra8unorm',
    initialData,
  })
  const [points, parameters] = harness.buffers
  assert.equal(points.descriptor.size, initialData.byteLength)
  assert.notEqual(points.descriptor.usage & 128, 0)
  assert.notEqual(points.descriptor.usage & 32, 0)
  assert.equal(parameters.descriptor.size, 16)
  const renderPipelineOperation = harness.operations.find(operation => operation[0] === 'device.createRenderPipeline')
  assert.equal(renderPipelineOperation[1].primitive.topology, 'line-strip')
  assert.deepEqual(renderPipelineOperation[1].vertex.buffers[0].attributes, [
    { shaderLocation: 0, offset: 8, format: 'float32x2' },
  ])

  island.renderFrame(1 / 60)
  const vertexOperation = harness.operations.find(operation => operation[0] === 'render.vertexBuffer')
  assert.equal(vertexOperation[2], points)
  assert.equal(harness.operations.find(operation => operation[0] === 'render.draw')[1], 3)
  assert.deepEqual(harness.readbackCounts(), { copies: 0, maps: 0 })
  island.dispose()
  assert.equal(points.destroyed, true)
  assert.equal(parameters.destroyed, true)
})
