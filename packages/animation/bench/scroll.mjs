import { performance } from 'node:perf_hooks';
import { ScrollTracker } from '../src/scroll/index.js';

const samples = Math.max(1, Number(process.argv[2]) || 500000);
const tracker = new ScrollTracker({ start: 0, end: 2000, clamp: false });
tracker.reset(0, 0);
const start = performance.now();
for (let i = 1; i <= samples; i += 1) tracker.sample((i * 7) % 2500, i * 4);
const elapsed = performance.now() - start;
console.log(`ScrollTracker ${samples}: ${elapsed.toFixed(2)} ms total | ${(elapsed * 1e6 / samples).toFixed(1)} ns/sample | progress=${tracker.progress.get().toFixed(3)}`);
