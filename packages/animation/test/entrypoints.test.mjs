import assert from 'node:assert/strict';
import test from 'node:test';
import { animate, compileMotionPlan, motionValue, spring } from '../src/core/index.js';
import { createInterpolator } from '../src/interpolate/css.js';

test('lean core entrypoint exposes the motion primitives used by renderer integrations', () => {
  const value = motionValue(0);
  const control = animate(value, 1, compileMotionPlan(spring({ response: 0.2, dampingRatio: 1 })));
  control.cancel();
  assert.equal(typeof value.get(), 'number');
});

test('CSS interpolation entrypoint excludes path and material feature families', () => {
  assert.equal(typeof createInterpolator('#000', '#fff', { type: 'color' })(0.5), 'string');
  assert.equal(typeof createInterpolator('translateX(0px)', 'translateX(10px)', { type: 'transform' })(0.5), 'string');
  assert.throws(
    () => createInterpolator('M0 0', 'M1 1', { type: 'path' }),
    /does not include path interpolation/,
  );
  assert.throws(
    () => createInterpolator({ tint: '#000' }, { tint: '#fff' }, { type: 'material' }),
    /does not include material interpolation/,
  );
});
