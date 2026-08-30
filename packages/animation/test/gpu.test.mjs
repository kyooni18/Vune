import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEngine, motionValue, spring } from '../src/index.js';
import { JsSpringBatch } from '../src/core/js-spring-batch.js';
import { WebGPUSpringBatch } from '../src/webgpu/index.js';

class FakeComputeBatch extends JsSpringBatch {
  constructor(capacity) {
    super(capacity);
    this.kind = 'webgpu';
    this.variant = 'compute';
  }

  stepAsync(count, dtSeconds) {
    this.step(count, dtSeconds);
    return Promise.resolve();
  }

  dispose() {}
}

test('WebGPU compute backend reports support only for complete device primitives', () => {
  assert.equal(WebGPUSpringBatch.isSupported(), false);
  assert.equal(WebGPUSpringBatch.isSupported({ createBuffer() {}, queue: {} }), false);
});

test('MotionEngine promotes dense async frames to GPU and keeps sync stepping safe', async () => {
  const engine = new MotionEngine({
    autoStart: false,
    wasm: false,
    worker: false,
    gpu: false,
    gpuThreshold: 4,
  });
  const backend = new FakeComputeBatch(64);
  engine.gpuBackend = backend;
  const values = Array.from({ length: 4 }, () => motionValue(0));
  for (const value of values) engine.animate(value, 100, spring());

  await engine.stepAsync(16.6667);
  assert.equal(engine.stats.promotedToGpu, true);
  assert.equal(engine.stats.gpuFrames, 1);
  assert.equal(engine.stats.backend, 'webgpu-compute');
  assert(values.every((value) => value.get() > 0));

  engine.step(16.6667);
  assert.equal(engine.batch.kind, 'js');
  engine.dispose();
});
