async function readWasm(url) {
  if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(url);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load WASM: ${response.status}`);
  return response.arrayBuffer();
}

async function instantiate(url, imports = {}) {
  const bytes = await readWasm(url);
  return WebAssembly.instantiate(bytes, imports);
}

export async function loadSpringKernel() {
  const simdUrl = new URL('../../wasm/kernel-simd.wasm', import.meta.url);
  try {
    const instance = await instantiate(simdUrl);
    return { instance: instance.instance ?? instance, variant: 'simd' };
  } catch (simdError) {
    const scalarUrl = new URL('../../wasm/kernel-scalar.wasm', import.meta.url);
    const instance = await instantiate(scalarUrl);
    return { instance: instance.instance ?? instance, variant: 'scalar', simdError };
  }
}

export function createSharedWasmMemory({ initialPages = 64, maximumPages = 1024 } = {}) {
  if (typeof SharedArrayBuffer !== 'function') throw new Error('SharedArrayBuffer is unavailable.');
  return new WebAssembly.Memory({ initial: initialPages, maximum: maximumPages, shared: true });
}

export async function instantiateSharedSpringKernel(memory, variant = 'simd') {
  if (!(memory instanceof WebAssembly.Memory) || !(memory.buffer instanceof SharedArrayBuffer)) {
    throw new TypeError('A shared WebAssembly.Memory is required.');
  }
  const url = new URL(`../../wasm/kernel-shared-${variant}.wasm`, import.meta.url);
  const instance = await instantiate(url, { env: { memory } });
  return { instance: instance.instance ?? instance, variant };
}

export async function loadSharedSpringKernel({ memory = createSharedWasmMemory(), preferSimd = true } = {}) {
  if (preferSimd) {
    try {
      const loaded = await instantiateSharedSpringKernel(memory, 'simd');
      return { ...loaded, memory };
    } catch (simdError) {
      const loaded = await instantiateSharedSpringKernel(memory, 'scalar');
      return { ...loaded, memory, simdError };
    }
  }
  const loaded = await instantiateSharedSpringKernel(memory, 'scalar');
  return { ...loaded, memory };
}
