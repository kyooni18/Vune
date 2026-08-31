import { instantiateSharedSpringKernel } from '../wasm/loader.js';

let nodeParentPort = null;
try {
  const nodeWorkers = ['node', 'worker_threads'].join(':');
  ({ parentPort: nodeParentPort } = await import(/* @vite-ignore */ nodeWorkers));
} catch {}

const endpoint = nodeParentPort ?? globalThis;
const post = (message) => nodeParentPort ? nodeParentPort.postMessage(message) : globalThis.postMessage(message);
const listen = (handler) => {
  if (nodeParentPort) nodeParentPort.on('message', handler);
  else globalThis.onmessage = (event) => handler(event.data);
};

let control = null;
let controlFloat = null;
let exportsRef = null;
let ptrs = null;
let lastSequence = 0;
let running = false;
let atomicCompletion = false;

function runLoop() {
  if (running) return;
  running = true;
  while (Atomics.load(control, 3) === 0) {
    let sequence = Atomics.load(control, 0);
    if (sequence === lastSequence) {
      Atomics.wait(control, 0, lastSequence);
      sequence = Atomics.load(control, 0);
      if (Atomics.load(control, 3) !== 0) break;
      if (sequence === lastSequence) continue;
    }

    const count = Atomics.load(control, 2);
    const dtSeconds = controlFloat[4];
    try {
      exportsRef.step_springs(
        ptrs.positions,
        ptrs.velocities,
        ptrs.targets,
        ptrs.omegas,
        ptrs.dampingRatios,
        count,
        dtSeconds,
      );
      Atomics.store(control, 5, 0);
    } catch (error) {
      Atomics.store(control, 5, 1);
      post({ type: 'error', message: error?.message ?? String(error), stack: error?.stack });
    }
    lastSequence = sequence;
    Atomics.store(control, 1, sequence);
    Atomics.notify(control, 1);
    if (!atomicCompletion) post({ type: 'done', sequence });
  }
  post({ type: 'stopped' });
}

listen(async (message) => {
  if (message?.type !== 'init') return;
  try {
    const loaded = await instantiateSharedSpringKernel(message.memory, message.variant);
    exportsRef = loaded.instance.exports;
    ptrs = message.ptrs;
    control = new Int32Array(message.controlBuffer);
    controlFloat = new Float32Array(message.controlBuffer);
    atomicCompletion = Boolean(message.atomicCompletion);
    post({ type: 'ready', variant: loaded.variant, completion: atomicCompletion ? 'atomics-wait-async' : 'message' });
    queueMicrotask(runLoop);
  } catch (error) {
    post({ type: 'error', message: error?.message ?? String(error), stack: error?.stack });
  }
});
