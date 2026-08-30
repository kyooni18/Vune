import { performance } from 'node:perf_hooks';
import { motionValue } from '../src/index.js';
import { createCanvasRenderer } from '../src/canvas/index.js';
import { createWebGLUniformBinder } from '../src/webgl/index.js';
import { createWebGPUBufferBinder } from '../src/webgpu/index.js';

const count = Math.max(1, Number(process.argv[2]) || 1000);
const frames = Math.max(1, Number(process.argv[3]) || 500);
const values = Array.from({ length: count }, () => motionValue(0));
const noSchedule = { requestFrame: () => 1, cancelFrame: () => {} };

let checksum = 0;
const canvas = createCanvasRenderer({}, values, (_ctx, snapshot) => { checksum += snapshot[0] + snapshot[snapshot.length - 1]; }, { renderInitial: false, ...noSchedule });
let start = performance.now();
for (let frame = 0; frame < frames; frame += 1) {
  for (let i = 0; i < count; i += 1) values[i].set(frame + i);
  canvas.renderNow(frame);
}
let elapsed = performance.now() - start;
console.log(`Canvas snapshot ${String(count).padStart(5)}: ${(elapsed / frames).toFixed(4)} ms/frame | one draw | checksum=${checksum.toFixed(0)}`);
canvas.dispose();

let uniformWrites = 0;
const gl = {
  getUniformLocation(_program, name) { return name; },
  useProgram() {},
  uniform1f() { uniformWrites += 1; },
};
const glBinder = createWebGLUniformBinder(gl, {}, values.map((value, i) => ({ name: `u${i}`, value })), { flushInitial: false, ...noSchedule });
glBinder.flush();
uniformWrites = 0;
start = performance.now();
for (let frame = 0; frame < frames; frame += 1) {
  for (let i = 0; i < count; i += 1) values[i].set(frame + i + 0.25);
  glBinder.flushNow();
}
elapsed = performance.now() - start;
console.log(`WebGL uniforms  ${String(count).padStart(5)}: ${(elapsed / frames).toFixed(4)} ms/frame | ${uniformWrites / frames} writes/frame`);
glBinder.dispose();

let gpuWrites = 0;
const device = { queue: { writeBuffer() { gpuWrites += 1; } } };
const gpuBinder = createWebGPUBufferBinder(device, {}, values, { flushInitial: false, ...noSchedule });
gpuBinder.flush();
gpuWrites = 0;
start = performance.now();
for (let frame = 0; frame < frames; frame += 1) {
  for (let i = 0; i < count; i += 1) values[i].set(frame + i + 0.5);
  gpuBinder.flushNow();
}
elapsed = performance.now() - start;
console.log(`WebGPU buffer   ${String(count).padStart(5)}: ${(elapsed / frames).toFixed(4)} ms/frame | ${gpuWrites / frames} writeBuffer/frame`);
gpuBinder.dispose();
