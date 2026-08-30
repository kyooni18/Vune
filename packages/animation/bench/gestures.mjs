import { performance } from 'node:perf_hooks';
import { VelocityTracker, rubberBandDistance } from '../src/gesture/index.js';
import { stepDecay, stepDampedSpring } from '../src/core/kinetics.js';

const iterations = Number(process.argv[2] ?? 1_000_000);

function measure(name, fn, count = iterations) {
  const started = performance.now();
  let sink = 0;
  for (let i = 0; i < count; i += 1) sink += fn(i);
  const elapsed = performance.now() - started;
  console.log(`${name.padEnd(24)} ${elapsed.toFixed(2)} ms | ${(elapsed * 1e6 / count).toFixed(1)} ns/op | sink=${sink.toFixed(2)}`);
}

measure('rubber-band', (i) => rubberBandDistance((i % 500) - 250, 320));

let decayState = { position: 0, velocity: 1200 };
measure('analytic decay', () => {
  decayState = stepDecay(decayState.position, decayState.velocity, 1 / 120, 0.325);
  if (Math.abs(decayState.velocity) < 0.001) decayState = { position: 0, velocity: 1200 };
  return decayState.position;
});

let springState = { position: 100, velocity: 1800 };
measure('analytic bounce spring', () => {
  springState = stepDampedSpring(springState.position, springState.velocity, 0, 24, 0.82, 1 / 120);
  if (Math.abs(springState.position) < 0.001 && Math.abs(springState.velocity) < 0.01) springState = { position: 100, velocity: 1800 };
  return springState.position;
});

const tracker = new VelocityTracker();
const trackerIterations = Math.min(iterations, 250_000);
const trackerStart = performance.now();
let velocitySink = 0;
for (let i = 0; i < trackerIterations; i += 1) {
  tracker.add(i * 0.8, i * 0.8);
  velocitySink += tracker.velocity;
}
const trackerElapsed = performance.now() - trackerStart;
console.log(`${'velocity regression'.padEnd(24)} ${trackerElapsed.toFixed(2)} ms | ${(trackerElapsed * 1e6 / trackerIterations).toFixed(1)} ns/sample | sink=${velocitySink.toFixed(2)}`);
