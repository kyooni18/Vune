import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MotionEngine,
  createPhaseTimeline,
  curves,
  motionValue,
  spring,
  stagger,
  timeline,
} from '../src/index.js';

function runtime() {
  return new MotionEngine({ autoStart: false, wasm: false, worker: false, frameBudgetMs: false });
}

test('numeric keyframe track samples allocation-free scalar data and analytical velocity', () => {
  const x = motionValue(0);
  const clip = timeline().track(x, [0, 100], { duration: 1, easing: curves.linear });
  clip.sample(0.25, { velocityScale: 1 });
  assert(Math.abs(x.get() - 25) < 1e-9);
  assert(Math.abs(x.getVelocity() - 100) < 1e-9);
});

test('timeline player participates in MotionEngine scheduler and settles exactly', async () => {
  const engine = runtime();
  const x = motionValue(0);
  const clip = timeline().track(x, [
    { at: 0, value: 0, easing: curves.linear },
    { at: 1, value: 100 },
  ]);
  const player = clip.player({ engine }).play();
  assert.equal(engine.stats.activeDrivers, 1);
  for (let i = 0; i < 10; i += 1) engine.step(100);
  const result = await player.finished;
  assert.equal(result.status, 'finished');
  assert.equal(x.get(), 100);
  assert.equal(x.getVelocity(), 0);
  assert.equal(engine.stats.activeDrivers, 0);
});

test('pause, seek, seekProgress, and reverse are deterministic', () => {
  const engine = runtime();
  const x = motionValue(0);
  const player = timeline().track(x, [0, 100], { duration: 1 }).player({ engine });
  player.seek(0.4);
  assert.equal(x.get(), 40);
  assert.equal(x.getVelocity(), 0);
  player.seekProgress(0.75);
  assert.equal(x.get(), 75);
  player.play();
  engine.step(100);
  player.pause();
  const paused = x.get();
  engine.step(500);
  assert.equal(x.get(), paused);
  assert.equal(x.getVelocity(), 0);
  player.reverse().play();
  engine.step(100);
  assert(x.get() < paused);
});

test('alternate iteration direction maps loop boundaries without endpoint jumps', async () => {
  const engine = runtime();
  const x = motionValue(0);
  const player = timeline().track(x, [0, 10], { duration: 1 }).player({
    engine,
    iterations: 2,
    direction: 'alternate',
  }).play();
  engine.step(1000);
  assert.equal(player.iteration, 1);
  assert.equal(x.get(), 10);
  engine.step(500);
  assert(Math.abs(x.get() - 5) < 1e-9);
  engine.step(500);
  assert.equal(x.get(), 0);
  assert.equal((await player.finished).status, 'finished');
});

test('interrupting a timeline with a spring preserves timeline velocity', async () => {
  const engine = runtime();
  const x = motionValue(0);
  const player = timeline().track(x, [0, 100], { duration: 1, easing: curves.linear }).player({ engine }).play();
  engine.step(250);
  assert(Math.abs(x.getVelocity() - 100) < 1e-6);
  engine.animate(x, 200, spring({ response: 0.3, dampingRatio: 0.8 }));
  assert.equal(player.state, 'interrupted');
  assert.equal((await player.finished).status, 'interrupted');
  assert(Math.abs(engine.batch.velocities[0] - 100) < 1e-6);
});

test('timeline play interrupts an existing engine animation on owned MotionValues', async () => {
  const engine = runtime();
  const x = motionValue(0);
  const springControls = engine.animate(x, 50, spring());
  engine.step(16);
  const player = timeline().track(x, [0, 100], { duration: 1 }).player({ engine }).play();
  assert.equal((await springControls.finished).status, 'interrupted');
  assert.equal(engine.activeSpringCount, 0);
  player.cancel();
});

test('generic keyframes reuse precompiled interpolators for colors', () => {
  let output = '';
  const clip = timeline().track((value) => { output = value; }, [
    { at: 0, value: '#ff0000' },
    { at: 1, value: '#0000ff' },
  ], { type: 'color', color: { space: 'oklab' } });
  clip.sample(0.5);
  assert.match(output, /^rgba?\(/);
  clip.sample(1);
  assert.equal(output, '#0000ff');
});

test('nested timeline clips support offsets, speed, and fill without another player', () => {
  const x = motionValue(0);
  const child = timeline().track(x, [0, 10], { duration: 1, easing: curves.linear });
  const parent = timeline().add(child, { at: 0.5, speed: 2, fill: 'both' });
  assert.equal(parent.duration, 1);
  parent.sample(0.25);
  assert.equal(x.get(), 0);
  parent.sample(0.75);
  assert(Math.abs(x.get() - 5) < 1e-9);
  parent.sample(1);
  assert.equal(x.get(), 10);
});

test('phase timeline compiles named multi-target choreography into one time axis', () => {
  const scale = motionValue(1);
  const opacity = motionValue(1);
  const phases = createPhaseTimeline({ scale, opacity }, [
    { name: 'idle', values: { scale: 1, opacity: 1 } },
    { name: 'pressed', duration: 0.1, hold: 0.05, values: { scale: 0.94, opacity: 0.8 }, easing: curves.linear },
    { name: 'release', duration: 0.2, values: { scale: 1, opacity: 1 }, easing: curves.linear },
  ]);
  assert(Math.abs(phases.duration - 0.35) < 1e-9);
  phases.sample(0.1);
  assert(Math.abs(scale.get() - 0.94) < 1e-9);
  assert(Math.abs(opacity.get() - 0.8) < 1e-9);
  assert.equal(phases.phaseAt(0.14), 'pressed');
  assert.equal(phases.phaseAt(0.35), 'release');
});

test('phase timeline supports structured target interpolation options', () => {
  let color = '';
  const phases = createPhaseTimeline({
    color: { target: (value) => { color = value; }, type: 'color', color: { space: 'oklab' } },
  }, [
    { name: 'cold', values: { color: '#0000ff' } },
    { name: 'hot', duration: 1, values: { color: '#ff0000' } },
  ]);
  phases.sample(0.5);
  assert.match(color, /^rgba?\(/);
});

test('stagger supports first, last, center, and eased distribution', () => {
  const first = stagger(0.1);
  assert.deepEqual([0, 1, 2].map((i) => first(i, 3)), [0, 0.1, 0.2]);
  const last = stagger(0.1, { from: 'last', start: 0.2 });
  assert.deepEqual([0, 1, 2].map((i) => last(i, 3)), [0.4, 0.30000000000000004, 0.2]);
  const center = stagger(0.1, { from: 'center' });
  assert.equal(center(1, 3), 0);
  assert.equal(center(0, 3), center(2, 3));
  const eased = stagger(0.1, { easing: curves.easeIn });
  assert(eased(1, 3) < 0.1);
});

test('infinite timelines remain running across large elapsed seeks', () => {
  const engine = runtime();
  const x = motionValue(0);
  const player = timeline().track(x, [0, 1], { duration: 1, easing: curves.linear }).player({
    engine,
    iterations: Infinity,
  }).play();
  engine.step(2500);
  assert.equal(player.state, 'running');
  assert.equal(player.iteration, 2);
  assert(Math.abs(x.get() - 0.5) < 1e-9);
  player.cancel();
});

test('finished players can replay with a fresh finished promise', async () => {
  const engine = runtime();
  const x = motionValue(0);
  const player = timeline().track(x, [0, 1], { duration: 0.1 }).player({ engine }).play();
  const firstPromise = player.finished;
  engine.step(100);
  assert.equal((await firstPromise).status, 'finished');
  player.play();
  const secondPromise = player.finished;
  assert.notEqual(secondPromise, firstPromise);
  engine.step(100);
  assert.equal((await secondPromise).status, 'finished');
});

test('duplicate keyframe times collapse to the last declared value', () => {
  const x = motionValue(0);
  const clip = timeline().track(x, [
    { at: 0, value: 0 },
    { at: 0.5, value: 20 },
    { at: 0.5, value: 30 },
    { at: 1, value: 100 },
  ]);
  clip.sample(0.5);
  assert.equal(x.get(), 30);
});

test('shorthand keyframes reject ambiguous timing without duration', () => {
  const x = motionValue(0);
  assert.throws(() => timeline().track(x, [0, 1, 2]), /duration/);
});

test('a second timeline interrupts the first owner of the same MotionValue', async () => {
  const engine = runtime();
  const x = motionValue(0);
  const first = timeline().track(x, [0, 100], { duration: 1 }).player({ engine }).play();
  engine.step(100);
  const second = timeline().track(x, [x.get(), 200], { duration: 1 }).player({ engine }).play();
  assert.equal(first.state, 'interrupted');
  assert.equal((await first.finished).status, 'interrupted');
  assert.equal(engine.stats.activeDrivers, 1);
  second.cancel();
});

test('engine.stop also releases timeline ownership without leaving a competing driver', async () => {
  const engine = runtime();
  const x = motionValue(0);
  const player = timeline().track(x, [0, 100], { duration: 1 }).player({ engine }).play();
  engine.step(100);
  engine.stop(x);
  assert.equal(player.state, 'cancelled');
  assert.equal((await player.finished).status, 'cancelled');
  assert.equal(engine.stats.activeDrivers, 0);
});

test('structured shorthand keyframes can interpolate transform objects', () => {
  let transform = '';
  const clip = timeline().track((value) => { transform = value; }, [
    { x: 0, scale: 1 },
    { x: 100, scale: 2 },
  ], { duration: 1, type: 'transform' });
  clip.sample(0.5);
  assert.match(transform, /translate3d\(50px/);
});

test('structured tracks reject MotionValue targets instead of silently dropping non-numeric output', () => {
  const x = motionValue(0);
  assert.throws(() => timeline().track(x, ['#fff', '#000'], { duration: 1, type: 'color' }), /numeric keyframes/);
});

test('final phase hold extends choreography duration while holding the final value', () => {
  const x = motionValue(0);
  const phases = createPhaseTimeline({ x }, [
    { name: 'a', values: { x: 0 } },
    { name: 'b', duration: 0.2, hold: 0.3, values: { x: 10 }, easing: curves.linear },
  ]);
  assert(Math.abs(phases.duration - 0.5) < 1e-9);
  phases.sample(0.4);
  assert.equal(x.get(), 10);
});

test('reverse playback can start from the end of an infinite timeline without a boundary jump', () => {
  const engine = runtime();
  const x = motionValue(0);
  const player = timeline().track(x, [0, 100], { duration: 1, easing: curves.linear }).player({
    engine,
    iterations: Infinity,
    playbackRate: -1,
  }).play();
  assert.equal(x.get(), 100);
  engine.step(100);
  assert(Math.abs(x.get() - 90) < 1e-9);
  player.cancel();
});

test('finishing an infinite timeline lands exactly on the current iteration endpoint', async () => {
  const engine = runtime();
  const x = motionValue(0);
  const player = timeline().track(x, [0, 100], { duration: 1 }).player({ engine, iterations: Infinity }).play();
  engine.step(350);
  player.finish();
  assert.equal(x.get(), 100);
  assert.equal((await player.finished).status, 'finished');
});

test('fromTo/to helpers build concise absolute-time choreography and scrub aliases seekProgress', () => {
  const engine = runtime();
  const x = motionValue(10);
  const clip = timeline()
    .to(x, 30, { at: 0.2, duration: 0.2, easing: curves.linear })
    .fromTo(() => {}, 0, 1, { at: 0.1, duration: 0.4 });
  assert.equal(clip.duration, 0.5);
  const player = clip.player({ engine });
  player.scrub(0.6);
  assert(Math.abs(player.currentTime - 0.3) < 1e-9);
  assert(Math.abs(x.get() - 20) < 1e-9);
});

test('compiled easing LUT stays visually equivalent to exact cubic-bezier evaluation', async () => {
  const { evaluateBezier } = await import('../src/core/bezier.js');
  for (const curve of [curves.easeIn, curves.easeOut, curves.easeInOut, curves.smooth]) {
    const x = motionValue(0);
    const clip = timeline().track(x, [0, 1], { duration: 1, easing: curve });
    for (let i = 1; i < 1000; i += 7) {
      const progress = i / 1000;
      clip.sample(progress);
      assert(Math.abs(x.get() - evaluateBezier(curve, progress)) < 0.0002);
    }
  }
});

test('large wall-clock gaps catch timelines up without iterating every skipped repeat callback', () => {
  const engine = runtime();
  const x = motionValue(0);
  const repeats = [];
  const player = timeline().track(x, [0, 1], { duration: 1 }).player({
    engine,
    iterations: Infinity,
    onRepeat(iteration, _player, crossed) { repeats.push([iteration, crossed]); },
  }).play();
  engine.step(3_600_000);
  assert.equal(player.iteration, 3600);
  assert.deepEqual(repeats, [[3600, 3600]]);
  player.cancel();
});

test('timeline scrubber maps an arbitrary numeric input domain to timeline progress', async () => {
  const { createTimelineScrubber } = await import('../src/timeline/index.js');
  const engine = runtime();
  const x = motionValue(0);
  const player = timeline().track(x, [0, 100], { duration: 1, easing: curves.linear }).player({ engine });
  const scrubber = createTimelineScrubber(player, { engine, min: 0, max: 400 });
  scrubber.set(100);
  assert(Math.abs(player.progress - 0.25) < 1e-9);
  assert(Math.abs(x.get() - 25) < 1e-9);
  scrubber.set(300);
  assert(Math.abs(x.get() - 75) < 1e-9);
  scrubber.dispose();
});

test('timeline scrubber release uses bounded inertia and snap points', async () => {
  const { createTimelineScrubber } = await import('../src/timeline/index.js');
  const engine = runtime();
  const x = motionValue(0);
  const player = timeline().track(x, [0, 100], { duration: 1, easing: curves.linear }).player({ engine });
  const scrubber = createTimelineScrubber(player, { engine, min: 0, max: 1, snapPoints: [0, 1] });
  scrubber.set(0.42, 2.5);
  const controls = scrubber.release({ timeConstant: 0.2 });
  for (let i = 0; i < 240; i += 1) engine.step(1000 / 60);
  assert.equal((await controls.finished).status, 'finished');
  assert.equal(scrubber.progress.get(), 1);
  assert.equal(player.progress, 1);
  assert.equal(x.get(), 100);
  scrubber.dispose();
});
