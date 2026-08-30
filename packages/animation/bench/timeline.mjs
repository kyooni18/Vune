import { performance } from 'node:perf_hooks';
import { curves, motionValue, timeline } from '../src/index.js';

const tracks = Math.max(1, Number(process.argv[2] ?? 1000));
const frames = Math.max(1, Number(process.argv[3] ?? 600));
const clip = timeline();
const values = new Array(tracks);

for (let i = 0; i < tracks; i += 1) {
  const value = motionValue(i % 11);
  values[i] = value;
  clip.track(value, [
    { at: 0, value: i % 11, easing: curves.smooth },
    { at: 0.45, value: 80 + (i % 37), easing: curves.easeInOut },
    { at: 1, value: (i % 19) - 9 },
  ]);
}

// Warm the JIT and binary-search/easing paths.
for (let frame = 0; frame < 240; frame += 1) clip.sample((frame % 120) / 120, { velocityScale: 1 });

const started = performance.now();
for (let frame = 0; frame < frames; frame += 1) {
  const t = (frame % 240) / 239;
  clip.sample(t, { velocityScale: 1 });
}
const elapsed = performance.now() - started;
let checksum = 0;
for (const value of values) checksum += value.get() + value.getVelocity() * 1e-6;

console.log(`Timeline     ${elapsed.toFixed(2)} ms total | ${(elapsed / frames).toFixed(4)} ms/frame | ${tracks} numeric tracks | ${frames} frames`);
console.log(`Checksum     ${checksum.toFixed(6)}`);
