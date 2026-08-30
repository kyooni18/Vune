import { performance } from 'node:perf_hooks';
import { motionValue } from '../src/index.js';
import { createConstraintGraph } from '../src/constraints/index.js';

const count = Math.max(1, Number(process.argv[2]) || 10000);
const frames = Math.max(1, Number(process.argv[3]) || 1000);
const source = motionValue(0);
const graph = createConstraintGraph();
let previous = graph.node(source);
for (let i = 0; i < count; i += 1) {
  const next = graph.node(i === count - 1 ? motionValue(0) : 0);
  graph.affine(next, previous, { scale: 0.99999, offset: 0.001 });
  previous = next;
}
graph.compile();
let checksum = 0;
const start = performance.now();
for (let frame = 0; frame < frames; frame += 1) {
  source.set(frame, 1);
  graph.evaluate();
  checksum += previous.get();
}
const elapsed = performance.now() - start;
console.log(`Constraints ${count}: ${elapsed.toFixed(2)} ms total | ${(elapsed / frames).toFixed(4)} ms/frame | checksum=${checksum.toFixed(2)}`);
