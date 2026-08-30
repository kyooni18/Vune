const DEFAULT_WORKGROUP_SIZE = 64;
const MAX_STEP_SECONDS = 1 / 240;
const MAX_SUBSTEPS = 32;
const FLOATS_PER_SPRING = 8;

const BUFFER_USAGE = globalThis.GPUBufferUsage ?? {
  MAP_READ: 1,
  COPY_SRC: 4,
  COPY_DST: 8,
  STORAGE: 128,
  UNIFORM: 64,
};
const MAP_MODE = globalThis.GPUMapMode ?? { READ: 1 };

const SPRING_SHADER = /* wgsl */ `
struct Spring {
  state: vec4<f32>,
  dynamics: vec4<f32>,
};

struct Params {
  dt: f32,
  count: u32,
  _padding: vec2<u32>,
};

@group(0) @binding(0) var<storage, read_write> springs: array<Spring>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(64)
fn step(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.count) { return; }

  var spring = springs[id.x];
  let x = spring.state.x;
  let v = spring.state.y;
  let target = spring.state.z;
  let omega = spring.state.w;
  let damping = spring.dynamics.x;
  let acceleration = omega * omega * (target - x) - 2.0 * damping * omega * v;
  let nextVelocity = v + acceleration * params.dt;
  spring.state.x = x + nextVelocity * params.dt;
  spring.state.y = nextVelocity;
  springs[id.x] = spring;
}
`;

function normalizeCapacity(capacity) {
  const value = Math.floor(Number(capacity));
  if (!Number.isFinite(value) || value < 1) throw new RangeError('WebGPU spring capacity must be a positive integer.');
  return value;
}

function substepCount(dtSeconds) {
  let steps = 1;
  while (dtSeconds / steps > MAX_STEP_SECONDS && steps < MAX_SUBSTEPS) steps += 1;
  return steps;
}

/**
 * WebGPU compute backend for dense spring batches. The host arrays mirror the
 * JS/WASM batch contract so MotionEngine can promote and demote without
 * changing animation semantics. Frames are asynchronous because readback is
 * required before values can be committed to MotionValue instances.
 */
export class WebGPUSpringBatch {
  static isSupported(device) {
    return Boolean(device?.createBuffer
      && device?.createShaderModule
      && device?.createComputePipeline
      && device?.createBindGroup
      && device?.createCommandEncoder
      && device?.queue?.submit
      && device?.queue?.writeBuffer);
  }

  static async create(capacity = 65536, device) {
    if (capacity && typeof capacity === 'object') {
      device = capacity;
      capacity = 65536;
    }
    let resolvedDevice = device;
    if (!resolvedDevice) {
      const gpu = globalThis.navigator?.gpu ?? globalThis.gpu;
      if (!gpu?.requestAdapter) throw new Error('WebGPU is unavailable in this environment.');
      const adapter = await gpu.requestAdapter();
      if (!adapter?.requestDevice) throw new Error('No WebGPU adapter is available.');
      resolvedDevice = await adapter.requestDevice();
    }
    if (!WebGPUSpringBatch.isSupported(resolvedDevice)) throw new Error('The WebGPU device does not support compute buffers.');
    return new WebGPUSpringBatch(resolvedDevice, capacity);
  }

  constructor(device, capacity = 65536) {
    if (!WebGPUSpringBatch.isSupported(device)) throw new TypeError('WebGPUSpringBatch requires a GPUDevice-like object.');
    this.kind = 'webgpu';
    this.variant = 'compute';
    this.device = device;
    this.capacity = normalizeCapacity(capacity);
    this.positions = new Float32Array(this.capacity);
    this.velocities = new Float32Array(this.capacity);
    this.targets = new Float32Array(this.capacity);
    this.omegas = new Float32Array(this.capacity);
    this.dampingRatios = new Float32Array(this.capacity);
    this.packed = new Float32Array(this.capacity * FLOATS_PER_SPRING);
    this.params = new Uint32Array(4);
    this.paramsFloat = new Float32Array(this.params.buffer);
    this.stepChain = Promise.resolve();
    this.disposed = false;

    const byteLength = this.packed.byteLength;
    this.storageBuffer = device.createBuffer({
      size: byteLength,
      usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.COPY_DST,
    });
    this.readbackBuffer = device.createBuffer({
      size: byteLength,
      usage: BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST,
    });
    this.paramsBuffer = device.createBuffer({
      size: this.params.byteLength,
      usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    });
    const module = device.createShaderModule({ code: SPRING_SHADER });
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'step' },
    });
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.storageBuffer } },
        { binding: 1, resource: { buffer: this.paramsBuffer } },
      ],
    });
  }

  ensureCapacity(required) {
    if (required > this.capacity) throw new RangeError(`WebGPU spring capacity exceeded (${required} > ${this.capacity}).`);
  }

  copyInto(other, count) {
    other.positions.set(this.positions.subarray(0, count));
    other.velocities.set(this.velocities.subarray(0, count));
    other.targets.set(this.targets.subarray(0, count));
    other.omegas.set(this.omegas.subarray(0, count));
    other.dampingRatios.set(this.dampingRatios.subarray(0, count));
  }

  step() {
    throw new Error('WebGPUSpringBatch.step() is asynchronous; use stepAsync().');
  }

  #pack(count) {
    for (let i = 0; i < count; i += 1) {
      const offset = i * FLOATS_PER_SPRING;
      this.packed[offset] = this.positions[i];
      this.packed[offset + 1] = this.velocities[i];
      this.packed[offset + 2] = this.targets[i];
      this.packed[offset + 3] = this.omegas[i];
      this.packed[offset + 4] = this.dampingRatios[i];
      this.packed[offset + 5] = 0;
      this.packed[offset + 6] = 0;
      this.packed[offset + 7] = 0;
    }
  }

  #unpack(count, mapped) {
    this.packed.set(new Float32Array(mapped).subarray(0, count * FLOATS_PER_SPRING));
    for (let i = 0; i < count; i += 1) {
      const offset = i * FLOATS_PER_SPRING;
      this.positions[i] = this.packed[offset];
      this.velocities[i] = this.packed[offset + 1];
    }
  }

  async #step(count, dtSeconds) {
    if (this.disposed) return;
    if (count <= 0 || dtSeconds <= 0) return;
    this.ensureCapacity(count);
    this.#pack(count);
    this.paramsFloat[0] = dtSeconds / substepCount(dtSeconds);
    this.params[1] = count;
    this.device.queue.writeBuffer(this.storageBuffer, 0, this.packed, 0, count * FLOATS_PER_SPRING * Float32Array.BYTES_PER_ELEMENT);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, this.params);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    const steps = substepCount(dtSeconds);
    for (let i = 0; i < steps; i += 1) pass.dispatchWorkgroups(Math.ceil(count / DEFAULT_WORKGROUP_SIZE));
    pass.end();
    const readbackBytes = count * FLOATS_PER_SPRING * Float32Array.BYTES_PER_ELEMENT;
    encoder.copyBufferToBuffer(this.storageBuffer, 0, this.readbackBuffer, 0, readbackBytes);
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone?.();
    await this.readbackBuffer.mapAsync(MAP_MODE.READ);
    const mapped = this.readbackBuffer.getMappedRange();
    this.#unpack(count, mapped);
    this.readbackBuffer.unmap();
  }

  stepAsync(count, dtSeconds) {
    const run = () => this.#step(count, dtSeconds);
    const result = this.stepChain.then(run, run);
    this.stepChain = result.catch(() => {});
    return result;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.storageBuffer.destroy?.();
    this.readbackBuffer.destroy?.();
    this.paramsBuffer.destroy?.();
  }
}
