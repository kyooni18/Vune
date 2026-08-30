import { performance } from 'node:perf_hooks';
import { MotionEngine, motionValue, spring, timing, curves } from '../src/index.js';
import { createStateTransitionGraph } from '../src/transition/index.js';
import { captureSharedLayout, createSharedLayoutTransition } from '../src/layout/index.js';

function median(values) {
  const copy = [...values].sort((a, b) => a - b);
  return copy[Math.floor(copy.length / 2)];
}

function fakeElement(id, rect) {
  return {
    id,
    parentElement: null,
    style: { transform: '', transformOrigin: '', willChange: '', opacity: '' },
    getBoundingClientRect() { return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }; },
  };
}

function benchStateGraph(count = 10000, frames = 180) {
  const samples = [];
  for (let run = 0; run < 9; run += 1) {
    const engine = new MotionEngine({ autoStart: false, wasm: false, respectReducedMotion: false });
    const bindings = {};
    const a = {};
    const b = {};
    for (let i = 0; i < count; i += 1) {
      bindings[`v${i}`] = motionValue(i % 17);
      a[`v${i}`] = i % 17;
      b[`v${i}`] = (i % 17) + 100;
    }
    const graph = createStateTransitionGraph(bindings, { a, b }, {
      initial: 'a',
      engine,
      spec: timing({ duration: 10, curve: curves.linear }),
    });
    graph.to('b');
    const start = performance.now();
    for (let frame = 0; frame < frames; frame += 1) engine.step(1000 / 60);
    samples.push((performance.now() - start) / frames);
    engine.dispose();
  }
  return median(samples);
}

function benchStructuredGraph(count = 10000, frames = 120) {
  const samples = [];
  for (let run = 0; run < 9; run += 1) {
    const engine = new MotionEngine({ autoStart: false, wasm: false, respectReducedMotion: false });
    const bindings = {};
    const a = {};
    const b = {};
    let sink = 0;
    for (let i = 0; i < count; i += 1) {
      bindings[`v${i}`] = (value) => { sink += value * 1e-12; };
      a[`v${i}`] = i % 7;
      b[`v${i}`] = (i % 7) + 10;
    }
    const graph = createStateTransitionGraph(bindings, { a, b }, {
      initial: 'a',
      engine,
      spec: timing({ duration: 10, curve: curves.linear }),
    });
    graph.to('b');
    const start = performance.now();
    for (let frame = 0; frame < frames; frame += 1) engine.step(1000 / 60);
    samples.push((performance.now() - start) / frames + sink * 0);
    engine.dispose();
  }
  return median(samples);
}

function benchSharedLayout(count = 1000, frames = 60) {
  const frameSamples = [];
  const setupSamples = [];
  for (let run = 0; run < 9; run += 1) {
    const engine = new MotionEngine({ autoStart: false, wasm: false, respectReducedMotion: false });
    const before = [];
    const after = [];
    for (let i = 0; i < count; i += 1) {
      const col = i % 50;
      const row = Math.floor(i / 50);
      before.push(fakeElement(`k${i}`, { left: col * 20, top: row * 20, width: 16, height: 16 }));
      after.push(fakeElement(`k${i}`, { left: col * 22 + 100, top: row * 18 + 40, width: 18, height: 14 }));
    }
    const setupStart = performance.now();
    const snapshot = captureSharedLayout(before, { measureScroll: () => ({ x: 0, y: 0 }) });
    const transition = createSharedLayoutTransition(snapshot, after, {
      engine,
      spec: timing({ duration: 1, curve: curves.linear }),
      measureScroll: () => ({ x: 0, y: 0 }),
    });
    transition.play();
    setupSamples.push(performance.now() - setupStart);
    const start = performance.now();
    for (let frame = 0; frame < frames; frame += 1) engine.step(1000 / 60);
    frameSamples.push((performance.now() - start) / frames);
    transition.cancel();
    engine.dispose();
  }
  return { setup: median(setupSamples), frame: median(frameSamples) };
}

const stateCount = Number(process.argv[2] ?? 10000);
const layoutCount = Number(process.argv[3] ?? 1000);
const sharedLayout = benchSharedLayout(layoutCount);
console.log(`state graph numeric  ${benchStateGraph(stateCount).toFixed(4)} ms/frame | ${stateCount} MotionValues`);
console.log(`state graph shared   ${benchStructuredGraph(stateCount).toFixed(4)} ms/frame | ${stateCount} callback values, 1 progress animation`);
console.log(`shared layout setup  ${sharedLayout.setup.toFixed(4)} ms total | ${layoutCount} matched targets`);
console.log(`shared layout write  ${sharedLayout.frame.toFixed(4)} ms/frame | ${layoutCount} matched targets, 1 progress animation`);
