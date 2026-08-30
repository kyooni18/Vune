import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionEngine, motionValue, timing, curves } from '../src/index.js';
import { createConstraintGraph } from '../src/constraints/index.js';

test('constraint graph compiles affine, sum, clamp, and mix in dependency order', () => {
  const source = motionValue(10);
  const output = motionValue(0);
  const graph = createConstraintGraph();
  const a = graph.node(source, { name: 'source' });
  const doubled = graph.node(0, { name: 'doubled' });
  const summed = graph.node(0, { name: 'summed' });
  const clamped = graph.node(output, { name: 'output' });
  graph.affine(doubled, a, { scale: 2, offset: 1 });
  graph.sum(summed, doubled, 4, { scaleA: 1, scaleB: 3, offset: -1 });
  graph.clamp(clamped, summed, { min: 0, max: 25 });
  graph.evaluate();
  assert.equal(doubled.get(), 21);
  assert.equal(summed.get(), 32);
  assert.equal(output.get(), 25);
});

test('constraint graph propagates analytic velocity through relationships', () => {
  const source = motionValue(4);
  source.set(4, 30);
  const output = motionValue(0);
  const graph = createConstraintGraph();
  const a = graph.node(source);
  const b = graph.node(output);
  graph.affine(b, a, { scale: -0.5, offset: 100 });
  graph.evaluate();
  assert.equal(output.get(), 98);
  assert.equal(output.getVelocity(), -15);
});

test('constraint graph rejects cycles at compile time', () => {
  const graph = createConstraintGraph();
  const a = graph.node(0, { name: 'a' });
  const b = graph.node(0, { name: 'b' });
  graph.affine(a, b);
  graph.affine(b, a);
  assert.throws(() => graph.compile(), /cycle/);
});

test('attached constraint graph evaluates once after animated source commits', () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false, respectReducedMotion: false });
  const source = motionValue(0);
  const output = motionValue(0);
  const graph = createConstraintGraph();
  const a = graph.node(source);
  const b = graph.node(output);
  graph.affine(b, a, { scale: 2 });
  graph.attach(engine);
  engine.animate(source, 10, timing({ duration: 0.1, curve: curves.linear }));
  engine.step(50);
  assert(Math.abs(source.get() - 5) < 1e-9);
  assert(Math.abs(output.get() - 10) < 1e-9);
  engine.step(60);
  assert.equal(output.get(), 20);
  graph.dispose();
  engine.dispose();
});

test('custom constraints reuse fixed input buffers and can return velocity', () => {
  const graph = createConstraintGraph();
  const a = graph.node(3);
  const b = graph.node(4);
  const out = graph.node(0);
  let firstValues = null;
  graph.map(out, [a, b], (values) => {
    if (!firstValues) firstValues = values;
    else assert.equal(values, firstValues);
    return { value: Math.hypot(values[0], values[1]), velocity: 2 };
  });
  graph.evaluate();
  graph.set(a, 6);
  graph.evaluate();
  assert.equal(out.get(), Math.hypot(6, 4));
  assert.equal(out.getVelocity(), 2);
});
