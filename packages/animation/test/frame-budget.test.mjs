import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameBudgetGovernor, MotionEngine } from '../src/index.js';

test('frame budget governor lowers backend thresholds only under sustained pressure', () => {
  const governor = new FrameBudgetGovernor({ budgetMs: 4, alpha: 1, minWasmThreshold: 32, minWorkerThreshold: 256 });
  governor.observe(0.5);
  assert.equal(governor.wasmThreshold(256, 1000), 256);
  assert.equal(governor.workerThreshold(4096, 10000), 4096);

  governor.observe(5);
  assert(governor.wasmThreshold(256, 1000) < 256);
  assert(governor.workerThreshold(4096, 10000) < 4096);
  assert.equal(governor.snapshot().level, 'critical');
});

test('engine exposes backend plan and budget telemetry', () => {
  const engine = new MotionEngine({ autoStart: false, wasm: false, worker: false, frameBudgetMs: 5 });
  const plan = engine.getBackendPlan();
  assert.equal(plan.current, 'js');
  assert.equal(plan.wasm.mode, false);
  assert.equal(plan.worker.mode, false);
  assert.equal(plan.budget.budgetMs, 5);
  engine.dispose();
});
