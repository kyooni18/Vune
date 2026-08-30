const NAMED = Object.freeze({
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  green: [0, 0.5019607843, 0, 1],
  blue: [0, 0, 1, 1],
  yellow: [1, 1, 0, 1],
  cyan: [0, 1, 1, 1],
  aqua: [0, 1, 1, 1],
  magenta: [1, 0, 1, 1],
  fuchsia: [1, 0, 1, 1],
  gray: [0.5019607843, 0.5019607843, 0.5019607843, 1],
  grey: [0.5019607843, 0.5019607843, 0.5019607843, 1],
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = (a, b, t) => a + (b - a) * t;

function parseRgbChannel(token) {
  const value = token.trim();
  if (value.endsWith('%')) return clamp01(Number.parseFloat(value) / 100);
  return clamp01(Number.parseFloat(value) / 255);
}

function parseAlpha(token = '1') {
  const value = token.trim();
  if (value.endsWith('%')) return clamp01(Number.parseFloat(value) / 100);
  return clamp01(Number.parseFloat(value));
}

function parseAngle(token) {
  const value = token.trim().toLowerCase();
  if (value.endsWith('turn')) return Number.parseFloat(value) * 360;
  if (value.endsWith('rad')) return Number.parseFloat(value) * 180 / Math.PI;
  if (value.endsWith('grad')) return Number.parseFloat(value) * 0.9;
  return Number.parseFloat(value);
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset) => {
    let t = hue + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

function splitFunctionalBody(body) {
  const slash = body.split('/');
  const main = slash[0].trim();
  const alpha = slash[1]?.trim();
  const parts = main.includes(',')
    ? main.split(',').map((part) => part.trim()).filter(Boolean)
    : main.split(/\s+/).filter(Boolean);
  if (parts.length === 4 && alpha == null) return { parts: parts.slice(0, 3), alpha: parts[3] };
  return { parts, alpha };
}

export function parseColor(input) {
  if (input && typeof input === 'object') {
    if (Array.isArray(input) && input.length >= 3) {
      return { r: clamp01(Number(input[0])), g: clamp01(Number(input[1])), b: clamp01(Number(input[2])), a: clamp01(Number(input[3] ?? 1)) };
    }
    if ('r' in input && 'g' in input && 'b' in input) {
      return { r: clamp01(Number(input.r)), g: clamp01(Number(input.g)), b: clamp01(Number(input.b)), a: clamp01(Number(input.a ?? 1)) };
    }
  }

  if (typeof input !== 'string') throw new TypeError('Color must be a CSS color string or {r,g,b,a}.');
  const text = input.trim().toLowerCase();
  if (NAMED[text]) {
    const [r, g, b, a] = NAMED[text];
    return { r, g, b, a };
  }

  if (text.startsWith('#')) {
    const hex = text.slice(1);
    if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/i.test(hex)) throw new TypeError(`Unsupported hex color: ${input}`);
    const expanded = hex.length <= 4 ? [...hex].map((char) => char + char).join('') : hex;
    const value = Number.parseInt(expanded, 16);
    if (expanded.length === 6) {
      return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255, a: 1 };
    }
    return { r: ((value >> 24) & 255) / 255, g: ((value >> 16) & 255) / 255, b: ((value >> 8) & 255) / 255, a: (value & 255) / 255 };
  }

  let match = text.match(/^rgba?\((.*)\)$/);
  if (match) {
    const { parts, alpha } = splitFunctionalBody(match[1]);
    if (parts.length !== 3) throw new TypeError(`Invalid rgb() color: ${input}`);
    return { r: parseRgbChannel(parts[0]), g: parseRgbChannel(parts[1]), b: parseRgbChannel(parts[2]), a: parseAlpha(alpha) };
  }

  match = text.match(/^hsla?\((.*)\)$/);
  if (match) {
    const { parts, alpha } = splitFunctionalBody(match[1]);
    if (parts.length !== 3 || !parts[1].endsWith('%') || !parts[2].endsWith('%')) throw new TypeError(`Invalid hsl() color: ${input}`);
    const [r, g, b] = hslToRgb(parseAngle(parts[0]), clamp01(Number.parseFloat(parts[1]) / 100), clamp01(Number.parseFloat(parts[2]) / 100));
    return { r, g, b, a: parseAlpha(alpha) };
  }

  throw new TypeError(`Unsupported color syntax: ${input}`);
}

export function formatColor(color) {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  const a = Math.round(clamp01(color.a ?? 1) * 10000) / 10000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function srgbToLinear(value) {
  const c = clamp01(value);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(value) {
  const c = Math.max(0, value);
  return clamp01(c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
}

export function linearRgbToOklab({ r, g, b }) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l3 = Math.cbrt(l);
  const m3 = Math.cbrt(m);
  const s3 = Math.cbrt(s);
  return {
    l: 0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3,
    a: 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3,
    b: 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3,
  };
}

export function oklabToLinearRgb({ l, a, b }) {
  const lp = l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = lp ** 3;
  const m3 = mp ** 3;
  const s3 = sp ** 3;
  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

function toLinear(color) {
  return { r: srgbToLinear(color.r), g: srgbToLinear(color.g), b: srgbToLinear(color.b) };
}

function fromLinear(color, alpha) {
  return { r: linearToSrgb(color.r), g: linearToSrgb(color.g), b: linearToSrgb(color.b), a: alpha };
}

function shortestHue(from, to) {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

export function mixColor(fromInput, toInput, t, { space = 'oklab' } = {}) {
  let from = parseColor(fromInput);
  let to = parseColor(toInput);
  const progress = clamp01(t);
  const alpha = lerp(from.a, to.a, progress);

  // CSS transparent is transparent black. Borrow the visible endpoint's chroma
  // when one side is fully transparent so fades do not pass through a dark halo.
  if (from.a <= 1e-8 && to.a > 1e-8) from = { ...from, r: to.r, g: to.g, b: to.b };
  if (to.a <= 1e-8 && from.a > 1e-8) to = { ...to, r: from.r, g: from.g, b: from.b };

  if (space === 'srgb') {
    return { r: lerp(from.r, to.r, progress), g: lerp(from.g, to.g, progress), b: lerp(from.b, to.b, progress), a: alpha };
  }

  const fromLinearColor = toLinear(from);
  const toLinearColor = toLinear(to);
  if (space === 'linear-srgb') {
    return fromLinear({
      r: lerp(fromLinearColor.r, toLinearColor.r, progress),
      g: lerp(fromLinearColor.g, toLinearColor.g, progress),
      b: lerp(fromLinearColor.b, toLinearColor.b, progress),
    }, alpha);
  }

  const a = linearRgbToOklab(fromLinearColor);
  const b = linearRgbToOklab(toLinearColor);
  let lab;
  if (space === 'oklch') {
    const c1 = Math.hypot(a.a, a.b);
    const c2 = Math.hypot(b.a, b.b);
    const h1 = Math.atan2(a.b, a.a) * 180 / Math.PI;
    const h2 = Math.atan2(b.b, b.a) * 180 / Math.PI;
    const c = lerp(c1, c2, progress);
    const h = h1 + shortestHue(h1, h2) * progress;
    lab = { l: lerp(a.l, b.l, progress), a: c * Math.cos(h * Math.PI / 180), b: c * Math.sin(h * Math.PI / 180) };
  } else if (space === 'oklab') {
    lab = { l: lerp(a.l, b.l, progress), a: lerp(a.a, b.a, progress), b: lerp(a.b, b.b, progress) };
  } else {
    throw new TypeError(`Unknown color interpolation space: ${space}`);
  }
  return fromLinear(oklabToLinearRgb(lab), alpha);
}

export function interpolateColor(from, to, options) {
  const start = parseColor(from);
  const end = parseColor(to);
  return (progress) => formatColor(mixColor(start, end, progress, options));
}
