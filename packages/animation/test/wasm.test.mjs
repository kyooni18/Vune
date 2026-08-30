import test from 'node:test';
import assert from 'node:assert/strict';
import { JsSpringBatch } from '../src/core/js-spring-batch.js';
import { WasmSpringBatch } from '../src/wasm/wasm-spring-batch.js';

function seed(batch, count) {
  for (let i = 0; i < count; i += 1) {
    batch.positions[i] = (i % 13) * 2;
    batch.velocities[i] = (i % 7) - 3;
    batch.targets[i] = 100 - (i % 17);
    batch.omegas[i] = 14 + (i % 5);
    batch.dampingRatios[i] = 0.72 + (i % 3) * 0.05;
  }
}

test('WASM kernel tracks JS kernel closely', async () => {
  const count = 257;
  const js = new JsSpringBatch(count);
  const wasm = await WasmSpringBatch.create(1024);
  seed(js, count);
  seed(wasm, count);
  for (let frame = 0; frame < 120; frame += 1) {
    js.step(count, 1 / 60);
    wasm.step(count, 1 / 60);
  }
  for (let i = 0; i < count; i += 1) {
    assert(Math.abs(js.positions[i] - wasm.positions[i]) < 0.002, `position mismatch at ${i}`);
    assert(Math.abs(js.velocities[i] - wasm.velocities[i]) < 0.01, `velocity mismatch at ${i}`);
  }
  assert(['simd', 'scalar'].includes(wasm.variant));
});

test('WASM allocator grows memory for capacities beyond the initial 4 MiB', async () => {
  const capacity = 300000;
  const wasm = await WasmSpringBatch.create(capacity);
  assert(wasm.exports.memory.buffer.byteLength > 4 * 1024 * 1024);
  assert.equal(wasm.positions.length, capacity);
});
