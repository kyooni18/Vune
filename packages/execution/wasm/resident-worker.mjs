let nodeParentPort = null;
try {
  ({ parentPort: nodeParentPort } = await import("node:worker_threads"));
} catch {}

const post = message => nodeParentPort ? nodeParentPort.postMessage(message) : globalThis.postMessage(message);
const listen = handler => {
  if (nodeParentPort) nodeParentPort.on("message", handler);
  else globalThis.onmessage = event => handler(event.data);
};

const CONTROL_REQUEST_SEQUENCE = 0;
const CONTROL_DONE_SEQUENCE = 1;
const CONTROL_STATUS = 2;
const CONTROL_STOP = 3;
const CONTROL_RANGE_COUNT = 4;
const CONTROL_ERROR_CODE = 5;
const CONTROL_COMPUTE_MICROS = 6;
const CONTROL_WASM_CALLS = 7;

async function readWasm(url) {
  if (url.protocol === "file:" && typeof process !== "undefined" && process.versions?.node) {
    const { readFile } = await import("node:fs/promises");
    return readFile(url);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load resident WASM: ${response.status}`);
  return response.arrayBuffer();
}

function now() {
  return globalThis.performance?.now() ?? Date.now();
}

let initialized = false;

listen(async message => {
  if (initialized || message?.type !== "init") return;
  initialized = true;
  try {
    if (!(message.memory instanceof WebAssembly.Memory) || !(message.memory.buffer instanceof SharedArrayBuffer)) {
      throw new TypeError("shared-memory-unavailable");
    }
    const url = new URL(`./resident-kernel-shared-${message.variant}.wasm`, import.meta.url);
    const result = await WebAssembly.instantiate(await readWasm(url), { env: { memory: message.memory } });
    const exports = (result.instance ?? result).exports;
    if ((exports.resident_simd_enabled() === 1) !== (message.variant === "simd")) {
      throw new TypeError("resident Worker variant mismatch");
    }
    let directExecute = null;
    if (message.variant === "simd"
      && message.directSimdModuleBytes instanceof Uint8Array
      && message.directSimdEntrypoint === "resident_execute_direct_simd") {
      try {
        const directResult = await WebAssembly.instantiate(message.directSimdModuleBytes, { env: { memory: message.memory } });
        const directExports = (directResult.instance ?? directResult).exports;
        if (typeof directExports[message.directSimdEntrypoint] === "function") {
          directExecute = directExports[message.directSimdEntrypoint];
        }
      } catch {}
    }
    const control = new Int32Array(message.memory.buffer, message.controlPointer, 16);
    let lastSequence = Atomics.load(control, CONTROL_REQUEST_SEQUENCE);
    post({ type: "ready", variant: message.variant });
    while (Atomics.load(control, CONTROL_STOP) === 0) {
      let sequence = Atomics.load(control, CONTROL_REQUEST_SEQUENCE);
      if (sequence === lastSequence) {
        Atomics.wait(control, CONTROL_REQUEST_SEQUENCE, lastSequence);
        sequence = Atomics.load(control, CONTROL_REQUEST_SEQUENCE);
        if (Atomics.load(control, CONTROL_STOP) !== 0) break;
        if (sequence === lastSequence) continue;
      }
      const started = now();
      const rangeCount = Atomics.load(control, CONTROL_RANGE_COUNT);
      const resultCode = directExecute
        ? directExecute(
          message.columnPointersPointer,
          message.rangesPointer,
          rangeCount,
          message.capturesPointer,
        )
        : exports.resident_execute(
          message.programPointer,
          message.programWords,
          message.columnPointersPointer,
          message.columnCount,
          message.rangesPointer,
          rangeCount,
          message.capturesPointer,
          message.captureCount,
        );
      const computeMicros = Math.max(0, Math.round((now() - started) * 1000));
      Atomics.store(control, CONTROL_ERROR_CODE, resultCode);
      Atomics.store(control, CONTROL_COMPUTE_MICROS, computeMicros);
      Atomics.add(control, CONTROL_WASM_CALLS, 1);
      Atomics.store(control, CONTROL_STATUS, resultCode === 0 ? 2 : -1);
      lastSequence = sequence;
      Atomics.store(control, CONTROL_DONE_SEQUENCE, sequence);
      Atomics.notify(control, CONTROL_DONE_SEQUENCE);
      post(resultCode === 0
        ? { type: "done", sequence }
        : { type: "error", sequence, message: `shared resident WASM execution failed (${resultCode})` });
    }
    post({ type: "stopped" });
  } catch (error) {
    post({ type: "error", message: error?.message ?? String(error) });
  }
});
