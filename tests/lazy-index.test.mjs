import assert from 'node:assert/strict';
import test from 'node:test';
import { LazyMeasurementIndex, lazyViewportOffset } from '../packages/web/dist/lazy-index.js';

test('variable-size lazy index keeps sparse measurements and logarithmic offsets', () => {
  const index = new LazyMeasurementIndex(5, 100, 10);
  assert.equal(index.totalSize(), 540);
  assert.equal(index.offsetForIndex(3), 330);

  index.set(1, 180);
  index.set(3, 60);
  assert.equal(index.offsetForIndex(3), 410);
  assert.equal(index.totalSize(), 580);
  assert.equal(index.sizeAt(1), 180);
  assert.equal(index.sizeAt(2), 100);
});

test('viewport ranges use measured heights instead of one global average', () => {
  const index = new LazyMeasurementIndex(10, 100, 0);
  index.set(0, 400);
  const range = index.rangeForViewport(410, 150, 1);
  assert.deepEqual(range, { start: 0, end: 4 });
});

test('spacer sizes account for virtualized gaps without double counting DOM gaps', () => {
  const index = new LazyMeasurementIndex(4, 100, 12);
  assert.equal(index.hiddenBeforeSize(2), 212);
  assert.equal(index.hiddenAfterSize(2), 212);
  index.set(0, 150);
  assert.equal(index.hiddenBeforeSize(2), 262);
});

test('reconfigure preserves measured rows that still exist', () => {
  const index = new LazyMeasurementIndex(4, 50, 4);
  index.set(2, 90);
  index.configure(6, 60, 8);
  assert.equal(index.sizeAt(2), 90);
  assert.equal(index.sizeAt(5), 60);
  assert.equal(index.totalSize(), 60 * 5 + 90 + 8 * 5);
});


test('nested scroll viewport offsets use bounding rects without double-counting scrollTop', () => {
  // A list whose top has moved to -380 under a scroll viewport starting at 120
  // is 500px into its own coordinate space. scrollTop is already represented in
  // those rects and must not be added a second time.
  assert.equal(lazyViewportOffset(120, -380), 500);
  assert.equal(lazyViewportOffset(0, 240), 0);
});
