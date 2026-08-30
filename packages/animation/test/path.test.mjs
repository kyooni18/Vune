import test from 'node:test';
import assert from 'node:assert/strict';
import { createPathMorpher, interpolatePath, normalizePathPair, parsePath } from '../src/path/index.js';

test('path parser normalizes relative lines, quadratics, smooth curves, and arcs to cubics', () => {
  const parsed = parsePath('M0 0 l10 0 q5 10 10 0 t10 0 a5 5 0 0 1 10 0 z');
  assert.equal(parsed.subpaths.length, 1);
  assert.equal(parsed.subpaths[0].closed, true);
  assert(parsed.subpaths[0].segments.length >= 6);
  const last = parsed.subpaths[0].segments.at(-1);
  assert(Math.abs(last.p3.x) < 1e-6);
  assert(Math.abs(last.p3.y) < 1e-6);
});

test('path parser accepts compact SVG arc flags used by real icon packs', () => {
  const parsed = parsePath('M17 10a5 5 0 00-3 1');
  assert.equal(parsed.subpaths.length, 1);
  assert(parsed.subpaths[0].segments.length > 0);
  const end = parsed.subpaths[0].segments.at(-1).p3;
  assert(Math.abs(end.x - 14) < 1e-6);
  assert(Math.abs(end.y - 11) < 1e-6);

  const absolute = parsePath('M20.001 19A2 2 0 0022 17');
  assert.equal(absolute.subpaths.length, 1);
  assert(absolute.subpaths[0].segments.length > 0);
  const absoluteEnd = absolute.subpaths[0].segments.at(-1).p3;
  assert(Math.abs(absoluteEnd.x - 22) < 1e-6);
  assert(Math.abs(absoluteEnd.y - 17) < 1e-6);
});

test('path normalization splits cubic segments to equal topology', () => {
  const pair = normalizePathPair('M0 0 L100 0 L100 100 Z', 'M0 0 C40 0 60 0 100 0 Z');
  assert.equal(pair.from.coords.length, pair.to.coords.length);
  assert.equal(pair.from.subpaths[0].count, pair.to.subpaths[0].count);
  assert(pair.from.subpaths[0].count >= 2);
});

test('closed-path alignment can reverse winding to avoid a long morph', () => {
  const from = 'M0 0 L100 0 L100 100 L0 100 Z';
  const toReversed = 'M0 0 L0 100 L100 100 L100 0 Z';
  const aligned = createPathMorpher(from, toReversed, { align: true, allowReverse: true });
  let displacement = 0;
  for (let i = 0; i < aligned.from.length; i += 1) displacement += Math.abs(aligned.from[i] - aligned.to[i]);
  assert(displacement < 1e-6);
});

test('path morpher preserves exact endpoints and reuses numeric buffer', () => {
  const from = 'M0 0 L100 0 L100 100 Z';
  const to = 'M20 10 C80 -20 120 60 80 120 Z';
  const morpher = createPathMorpher(from, to, { precision: 2 });
  assert.equal(morpher.sample(0), from);
  assert.equal(morpher.sample(1), to);
  const firstBuffer = morpher.sampleInto(0.25);
  const secondBuffer = morpher.sampleInto(0.75);
  assert.equal(firstBuffer, secondBuffer);
  assert.match(morpher.format(secondBuffer), /^M/);
});

test('interpolatePath preprocesses once and emits valid cubic path strings', () => {
  const mix = interpolatePath('M0 0 L10 0 L10 10 Z', 'M0 0 L20 0 L10 20 Z');
  const middle = mix(0.5);
  assert.match(middle, /^M/);
  assert.match(middle, /C/);
  assert.match(middle, /Z$/);
});
