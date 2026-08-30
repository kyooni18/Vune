import { formatColor, mixColor, parseColor } from '../interpolate/color.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;

const BASE = Object.freeze({
  blur: 0,
  saturation: 1,
  brightness: 1,
  contrast: 1,
  tint: 'rgba(255, 255, 255, 0)',
  tintStrength: 1,
});

const PRESETS = {
  clear: BASE,
  ultraThin: { blur: 10, saturation: 1.24, brightness: 1.04, contrast: 1.01, tint: 'rgba(255, 255, 255, 0.10)', tintStrength: 1 },
  thin: { blur: 16, saturation: 1.30, brightness: 1.05, contrast: 1.015, tint: 'rgba(255, 255, 255, 0.13)', tintStrength: 1 },
  regular: { blur: 24, saturation: 1.36, brightness: 1.06, contrast: 1.02, tint: 'rgba(255, 255, 255, 0.16)', tintStrength: 1 },
  thick: { blur: 36, saturation: 1.42, brightness: 1.075, contrast: 1.025, tint: 'rgba(255, 255, 255, 0.20)', tintStrength: 1 },
  glass: { blur: 22, saturation: 1.48, brightness: 1.09, contrast: 1.035, tint: 'rgba(255, 255, 255, 0.14)', tintStrength: 1 },
};

export const materials = Object.freeze(Object.fromEntries(
  Object.entries(PRESETS).map(([name, value]) => [name, Object.freeze({ ...value })]),
));

export function resolveMaterial(input = 'regular') {
  const source = typeof input === 'string' ? materials[input] : input;
  if (!source || typeof source !== 'object') throw new TypeError(`Unknown material: ${String(input)}`);
  const blur = Math.max(0, Number(source.blur ?? BASE.blur));
  const saturation = Math.max(0, Number(source.saturation ?? BASE.saturation));
  const brightness = Math.max(0, Number(source.brightness ?? BASE.brightness));
  const contrast = Math.max(0, Number(source.contrast ?? BASE.contrast));
  const tintStrength = clamp(Number(source.tintStrength ?? BASE.tintStrength), 0, 1);
  const tint = parseColor(source.tint ?? BASE.tint);
  if (![blur, saturation, brightness, contrast, tintStrength].every(Number.isFinite)) {
    throw new TypeError('Material numeric properties must be finite numbers.');
  }
  return { blur, saturation, brightness, contrast, tint, tintStrength };
}

export function mixMaterial(fromInput, toInput, progress, { colorSpace = 'oklab' } = {}) {
  const from = resolveMaterial(fromInput);
  const to = resolveMaterial(toInput);
  const t = clamp(Number(progress) || 0, 0, 1);
  return {
    blur: lerp(from.blur, to.blur, t),
    saturation: lerp(from.saturation, to.saturation, t),
    brightness: lerp(from.brightness, to.brightness, t),
    contrast: lerp(from.contrast, to.contrast, t),
    tint: mixColor(from.tint, to.tint, t, { space: colorSpace }),
    tintStrength: lerp(from.tintStrength, to.tintStrength, t),
  };
}

export function interpolateMaterial(from, to, options = {}) {
  const start = resolveMaterial(from);
  const end = resolveMaterial(to);
  return (progress) => mixMaterial(start, end, progress, options);
}

export function materialToCss(materialInput) {
  const material = resolveMaterial(materialInput);
  const tint = { ...material.tint, a: material.tint.a * material.tintStrength };
  return {
    backdropFilter: `blur(${material.blur}px) saturate(${material.saturation}) brightness(${material.brightness}) contrast(${material.contrast})`,
    backgroundColor: formatColor(tint),
  };
}
