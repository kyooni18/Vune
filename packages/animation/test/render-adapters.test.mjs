import test from 'node:test';
import assert from 'node:assert/strict';
import { motionValue } from '../src/index.js';
import { createCanvasRenderer } from '../src/canvas/index.js';
import { createWebGLUniformBinder } from '../src/webgl/index.js';
import { createWebGPUBufferBinder } from '../src/webgpu/index.js';

function manualFrames() {
  let callback = null;
  let id = 0;
  return {
    request(cb) { callback = cb; return ++id; },
    cancel() { callback = null; },
    run(time = 0) { const cb = callback; callback = null; cb?.(time); },
    get pending() { return callback != null; },
  };
}

test('Canvas adapter coalesces changes and reuses one numeric snapshot', () => {
  const frames = manualFrames();
  const x = motionValue(1);
  const y = motionValue(2);
  const snapshots = [];
  const ctx = { canvas: { width: 10, height: 20 }, clearRectCalls: 0, clearRect() { this.clearRectCalls += 1; } };
  const renderer = createCanvasRenderer(ctx, [x, y], (_ctx, values) => snapshots.push(values), {
    autoClear: true,
    renderInitial: false,
    requestFrame: (cb) => frames.request(cb),
    cancelFrame: () => frames.cancel(),
  });
  x.set(3); y.set(4); x.set(5);
  assert.equal(frames.pending, true);
  frames.run(16);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0], renderer.snapshot);
  assert.deepEqual(Array.from(renderer.snapshot), [5, 4]);
  assert.equal(ctx.clearRectCalls, 1);
  renderer.dispose();
});

test('WebGL adapter caches locations and batches dirty uniform writes', () => {
  const frames = manualFrames();
  const x = motionValue(1);
  const y = motionValue(2);
  const calls = [];
  let locations = 0;
  const gl = {
    getUniformLocation(_program, name) { locations += 1; return { name }; },
    useProgram(program) { calls.push(['use', program]); },
    uniform1f(location, value) { calls.push(['1f', location.name, value]); },
    uniform2fv(location, value) { calls.push(['2fv', location.name, ...value]); },
  };
  const binder = createWebGLUniformBinder(gl, 'program', [
    { name: 'uX', value: x },
    { name: 'uPosition', values: [x, y] },
  ], {
    flushInitial: false,
    requestFrame: (cb) => frames.request(cb),
    cancelFrame: () => frames.cancel(),
  });
  // Initial entries are dirty by construction; explicit flush emits them once.
  assert.equal(binder.flush(), 2);
  calls.length = 0;
  x.set(7); y.set(9); x.set(8);
  frames.run(16);
  assert.equal(locations, 2);
  assert.deepEqual(calls, [
    ['use', 'program'],
    ['1f', 'uX', 8],
    ['2fv', 'uPosition', 8, 9],
  ]);
  binder.dispose();
});

test('WebGPU adapter writes one retained packed buffer per dirty frame', () => {
  const frames = manualFrames();
  const x = motionValue(1);
  const y = motionValue(2);
  const writes = [];
  const device = { queue: { writeBuffer(_buffer, offset, arrayBuffer, byteOffset, byteLength) {
    writes.push({ offset, values: Array.from(new Float32Array(arrayBuffer, byteOffset, byteLength / 4)) });
  } } };
  const binder = createWebGPUBufferBinder(device, 'buffer', [
    { value: x, index: 0 },
    { value: y, index: 3 },
  ], {
    floatCount: 4,
    byteOffset: 16,
    flushInitial: false,
    requestFrame: (cb) => frames.request(cb),
    cancelFrame: () => frames.cancel(),
  });
  binder.flush();
  writes.length = 0;
  x.set(6); y.set(11);
  frames.run(16);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].offset, 16);
  assert.deepEqual(writes[0].values, [6, 0, 0, 11]);
  binder.dispose();
});
