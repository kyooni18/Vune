import { clamp } from './math.js';

function sampleCurve(a1, a2, t) {
  const inv = 1 - t;
  return 3 * inv * inv * t * a1 + 3 * inv * t * t * a2 + t * t * t;
}

function sampleDerivative(a1, a2, t) {
  return 3 * (1 - t) * (1 - t) * a1
    + 6 * (1 - t) * t * (a2 - a1)
    + 3 * t * t * (1 - a2);
}

function solveCurveT(curve, progress) {
  const x = clamp(progress, 0, 1);
  if (curve.x1 === curve.y1 && curve.x2 === curve.y2) return { x, t: x, linear: true };

  let t = x;
  for (let i = 0; i < 5; i += 1) {
    const estimate = sampleCurve(curve.x1, curve.x2, t) - x;
    const derivative = sampleDerivative(curve.x1, curve.x2, t);
    if (Math.abs(derivative) < 1e-7) break;
    t = clamp(t - estimate / derivative, 0, 1);
  }

  let low = 0;
  let high = 1;
  for (let i = 0; i < 8; i += 1) {
    const estimate = sampleCurve(curve.x1, curve.x2, t);
    if (Math.abs(estimate - x) < 1e-6) break;
    if (estimate < x) low = t;
    else high = t;
    t = (low + high) * 0.5;
  }

  return { x, t, linear: false };
}

export function evaluateBezier(curve, progress) {
  const solved = solveCurveT(curve, progress);
  if (solved.linear) return solved.x;
  return sampleCurve(curve.y1, curve.y2, solved.t);
}

export function evaluateBezierDerivative(curve, progress) {
  const solved = solveCurveT(curve, progress);
  if (solved.linear) return 1;
  const dx = sampleDerivative(curve.x1, curve.x2, solved.t);
  if (Math.abs(dx) < 1e-7) return 0;
  return sampleDerivative(curve.y1, curve.y2, solved.t) / dx;
}
