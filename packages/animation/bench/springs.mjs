import { performance } from 'node:perf_hooks';
import { JsSpringBatch } from '../src/core/js-spring-batch.js';
import { WasmSpringBatch } from '../src/wasm/wasm-spring-batch.js';

const count = Number(process.argv[2] || 10000);
const frames = Number(process.argv[3] || 600);

function seed(batch) {
  for (let i = 0; i < count; i += 1) {
    batch.positions[i] = i % 100;
    batch.velocities[i] = 0;
    batch.targets[i] = 500 - (i % 50);
    batch.omegas[i] = 16;
    batch.dampingRatios[i] = 0.82;
  }
}

function run(label, batch) {
  seed(batch);
  const start = performance.now();
  for (let i = 0; i < frames; i += 1) batch.step(count, 1 / 60);
  const elapsed = performance.now() - start;
  console.log(`${label.padEnd(12)} ${elapsed.toFixed(2)} ms total | ${(elapsed / frames).toFixed(4)} ms/frame | ${count} springs`);
}

const js = new JsSpringBatch(count);
run('JS', js);

try {
  const wasm = await WasmSpringBatch.create(Math.max(count, 65536));
  run(`WASM-${wasm.variant}`, wasm);
} catch (error) {
  console.error('WASM unavailable:', error.message);
}
