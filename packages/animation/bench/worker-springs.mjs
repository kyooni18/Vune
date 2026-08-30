import { performance } from 'node:perf_hooks';
import { JsSpringBatch } from '../src/core/js-spring-batch.js';
import { WasmSpringBatch } from '../src/wasm/wasm-spring-batch.js';
import { SharedSpringWorkerBackend } from '../src/worker/index.js';

const count = Math.max(1, Number(process.argv[2] ?? 10000));
const frames = Math.max(1, Number(process.argv[3] ?? 300));
const dt = 1 / 60;

function seed(batch) {
  batch.ensureCapacity(count);
  for (let i = 0; i < count; i += 1) {
    batch.positions[i] = i % 31;
    batch.velocities[i] = (i % 7) - 3;
    batch.targets[i] = 240 - (i % 41);
    batch.omegas[i] = 12 + (i % 8);
    batch.dampingRatios[i] = 0.72 + (i % 4) * 0.06;
  }
}

function retarget(batch, frame) {
  if (frame % 30 !== 0) return;
  const direction = ((frame / 30) & 1) === 0 ? 1 : -1;
  for (let i = 0; i < count; i += 1) batch.targets[i] = direction * (220 + (i % 41));
}

function result(label, elapsed) {
  console.log(`${label.padEnd(14)} ${elapsed.toFixed(2).padStart(9)} ms solver wall | ${(elapsed / frames).toFixed(4)} ms/frame | ${count} active springs`);
}

async function runSync(label, batch) {
  seed(batch);
  let elapsed = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    retarget(batch, frame);
    const start = performance.now();
    batch.step(count, dt);
    elapsed += performance.now() - start;
  }
  result(label, elapsed);
}

const js = new JsSpringBatch(count);
await runSync('JS', js);

const wasm = await WasmSpringBatch.create(Math.max(65536, count));
await runSync(`WASM-${wasm.variant}`, wasm);

if (SharedSpringWorkerBackend.isSupported()) {
  const worker = await SharedSpringWorkerBackend.create(Math.max(65536, count));
  seed(worker);
  await worker.stepAsync(count, dt);
  let wall = 0;
  let submit = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    retarget(worker, frame);
    const start = performance.now();
    const pending = worker.stepAsync(count, dt);
    const submitted = performance.now();
    await pending;
    const end = performance.now();
    submit += submitted - start;
    wall += end - start;
  }
  result(`Worker-${worker.variant}`, wall);
  console.log(`${'Worker submit'.padEnd(14)} ${(submit / frames).toFixed(5).padStart(9)} ms/frame main-thread submission cost`);
  worker.dispose();
} else {
  console.log('Worker         unavailable (shared WebAssembly memory unsupported)');
}
