import { performance } from 'node:perf_hooks';
import { createPathMorpher } from '../src/path/index.js';

const segments = Math.max(3, Number(process.argv[2] ?? 256));
const frames = Math.max(1, Number(process.argv[3] ?? 10000));

function polygon(count, radius, phase, wobble) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const angle = phase + (i / count) * Math.PI * 2;
    const r = radius * (1 + Math.sin(i * 1.73) * wobble);
    points.push([Math.cos(angle) * r + 160, Math.sin(angle) * r + 160]);
  }
  return `M${points.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join(' L')} Z`;
}

const from = polygon(segments, 120, 0, 0.08);
const to = polygon(segments, 105, 0.37, 0.18);
const prepStart = performance.now();
const morpher = createPathMorpher(from, to, { align: true, allowReverse: true, precision: 2 });
const prepMs = performance.now() - prepStart;

const sampleStart = performance.now();
for (let i = 0; i < frames; i += 1) morpher.sampleInto((i % 1000) / 999);
const sampleMs = performance.now() - sampleStart;

const formatFrames = Math.min(frames, 1000);
const formatStart = performance.now();
for (let i = 0; i < formatFrames; i += 1) morpher.sample((i % 1000) / 999);
const formatMs = performance.now() - formatStart;

console.log(`Path preprocess  ${prepMs.toFixed(2).padStart(8)} ms | ${segments} segments`);
console.log(`Numeric sample   ${sampleMs.toFixed(2).padStart(8)} ms | ${(sampleMs / frames).toFixed(5)} ms/frame | ${frames} frames`);
console.log(`String format    ${formatMs.toFixed(2).padStart(8)} ms | ${(formatMs / formatFrames).toFixed(5)} ms/frame | ${formatFrames} frames`);
