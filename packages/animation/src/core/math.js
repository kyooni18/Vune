export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function springParamsFromResponse(response = 0.38, dampingRatio = 0.82) {
  const safeResponse = Math.max(0.05, Number(response) || 0.38);
  return {
    omega: (Math.PI * 2) / safeResponse,
    dampingRatio: Math.max(0, Number(dampingRatio) || 0),
  };
}

export function springParamsFromPhysics({ mass = 1, stiffness = 170, damping = 18 } = {}) {
  const m = Math.max(1e-6, mass);
  const k = Math.max(1e-6, stiffness);
  const c = Math.max(0, damping);
  const omega = Math.sqrt(k / m);
  return {
    omega,
    dampingRatio: c / (2 * Math.sqrt(k * m)),
  };
}
