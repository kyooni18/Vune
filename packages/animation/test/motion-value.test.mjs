import test from 'node:test';
import assert from 'node:assert/strict';
import { motionValue } from '../src/index.js';

test('subscribeValue is a value-only hot path and keeps detailed subscriptions compatible', () => {
  const value = motionValue(2);
  const raw = [];
  const detailed = [];
  const unraw = value.subscribeValue((next) => raw.push(next));
  const undetailed = value.subscribe((next, info) => detailed.push([next, info.previous, info.velocity, info.version]));
  value.set(5, 12);
  value.set(8, -3);
  unraw();
  undetailed();
  assert.deepEqual(raw, [2, 5, 8]);
  assert.deepEqual(detailed, [
    [2, 2, 0, 0],
    [5, 2, 12, 1],
    [8, 5, -3, 2],
  ]);
});

test('subscribeValue unsubscribe removes the fast listener cleanly', () => {
  const value = motionValue(0);
  let calls = 0;
  const unsubscribe = value.subscribeValue(() => { calls += 1; }, { emitCurrent: false });
  value.set(1);
  unsubscribe();
  value.set(2);
  assert.equal(calls, 1);
});
