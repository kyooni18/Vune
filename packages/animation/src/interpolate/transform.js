const EPSILON = 1e-10;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const identityTransform = Object.freeze({
  x: 0, y: 0, z: 0,
  scaleX: 1, scaleY: 1, scaleZ: 1,
  rotateX: 0, rotateY: 0, rotateZ: 0,
  skewX: 0, skewY: 0,
  perspective: 0,
});

export const identityMatrix2D = Object.freeze([1, 0, 0, 1, 0, 0]);

export function multiplyMatrix2D(left, right) {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function invertMatrix2D(matrix) {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < EPSILON) return [...identityMatrix2D];
  const inv = 1 / determinant;
  return [d * inv, -b * inv, -c * inv, a * inv, (c * f - d * e) * inv, (b * e - a * f) * inv];
}

export function translationMatrix2D(x, y) { return [1, 0, 0, 1, x, y]; }
export function scaleMatrix2D(x, y = x) { return [x, 0, 0, y, 0, 0]; }
export function rotationMatrix2D(degrees) {
  const radians = degrees * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, s, -s, c, 0, 0];
}
export function skewXMatrix2D(degrees) { return [1, 0, Math.tan(degrees * Math.PI / 180), 1, 0, 0]; }
export function skewYMatrix2D(degrees) { return [1, Math.tan(degrees * Math.PI / 180), 0, 1, 0, 0]; }

function parseNumber(token) {
  const value = Number.parseFloat(String(token).trim());
  if (!Number.isFinite(value)) throw new TypeError(`Invalid transform number: ${token}`);
  return value;
}

function parseLength(token) {
  const text = String(token).trim().toLowerCase();
  if (text === '0') return 0;
  if (text.endsWith('px')) return parseNumber(text);
  if (/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(text)) return parseNumber(text);
  throw new TypeError(`Only px lengths can be interpolated without layout context: ${token}`);
}

function parseAngle(token) {
  const text = String(token).trim().toLowerCase();
  if (text.endsWith('deg')) return parseNumber(text);
  if (text.endsWith('rad')) return parseNumber(text) * 180 / Math.PI;
  if (text.endsWith('turn')) return parseNumber(text) * 360;
  if (text.endsWith('grad')) return parseNumber(text) * 0.9;
  if (text === '0' || /^-?\d*\.?\d+$/.test(text)) return parseNumber(text);
  throw new TypeError(`Unsupported angle: ${token}`);
}

function splitArgs(body) {
  return body.includes(',') ? body.split(',').map((v) => v.trim()) : body.trim().split(/\s+/).filter(Boolean);
}

export function decomposeMatrix2D(matrix) {
  let [a, b, c, d, e, f] = matrix;
  let scaleX = Math.hypot(a, b);
  if (scaleX < EPSILON) return { ...identityTransform, x: e, y: f, scaleX: 0, scaleY: Math.hypot(c, d) };
  a /= scaleX;
  b /= scaleX;
  let shear = a * c + b * d;
  c -= a * shear;
  d -= b * shear;
  let scaleY = Math.hypot(c, d);
  if (scaleY > EPSILON) {
    c /= scaleY;
    d /= scaleY;
    shear /= scaleY;
  }
  if (a * d - b * c < 0) {
    scaleY = -scaleY;
    shear = -shear;
  }
  return {
    ...identityTransform,
    x: e,
    y: f,
    scaleX,
    scaleY,
    rotateZ: Math.atan2(b, a) * 180 / Math.PI,
    skewX: Math.atan(shear) * 180 / Math.PI,
  };
}

export function composeMatrix2D(transform) {
  let matrix = translationMatrix2D(transform.x ?? 0, transform.y ?? 0);
  matrix = multiplyMatrix2D(matrix, rotationMatrix2D(transform.rotateZ ?? transform.rotate ?? 0));
  matrix = multiplyMatrix2D(matrix, skewXMatrix2D(transform.skewX ?? 0));
  matrix = multiplyMatrix2D(matrix, skewYMatrix2D(transform.skewY ?? 0));
  matrix = multiplyMatrix2D(matrix, scaleMatrix2D(transform.scaleX ?? transform.scale ?? 1, transform.scaleY ?? transform.scale ?? 1));
  return matrix;
}

function parse2DString(text) {
  if (text === 'none' || text === '') return [...identityMatrix2D];
  const pattern = /([a-zA-Z0-9]+)\(([^)]*)\)/g;
  let match;
  let matrix = [...identityMatrix2D];
  let consumed = '';
  while ((match = pattern.exec(text))) {
    consumed += match[0];
    const name = match[1].toLowerCase();
    const args = splitArgs(match[2]);
    let next;
    switch (name) {
      case 'matrix':
        if (args.length !== 6) return null;
        next = args.map(parseNumber);
        break;
      case 'translate': next = translationMatrix2D(parseLength(args[0] ?? 0), parseLength(args[1] ?? 0)); break;
      case 'translatex': next = translationMatrix2D(parseLength(args[0] ?? 0), 0); break;
      case 'translatey': next = translationMatrix2D(0, parseLength(args[0] ?? 0)); break;
      case 'scale': next = scaleMatrix2D(parseNumber(args[0] ?? 1), parseNumber(args[1] ?? args[0] ?? 1)); break;
      case 'scalex': next = scaleMatrix2D(parseNumber(args[0] ?? 1), 1); break;
      case 'scaley': next = scaleMatrix2D(1, parseNumber(args[0] ?? 1)); break;
      case 'rotate': next = rotationMatrix2D(parseAngle(args[0] ?? 0)); break;
      case 'skewx': next = skewXMatrix2D(parseAngle(args[0] ?? 0)); break;
      case 'skewy': next = skewYMatrix2D(parseAngle(args[0] ?? 0)); break;
      case 'skew':
        next = multiplyMatrix2D(skewXMatrix2D(parseAngle(args[0] ?? 0)), skewYMatrix2D(parseAngle(args[1] ?? 0)));
        break;
      default: return null;
    }
    matrix = multiplyMatrix2D(matrix, next);
  }
  return consumed ? matrix : null;
}

function parse3DComponents(text) {
  const result = { ...identityTransform };
  const pattern = /([a-zA-Z0-9]+)\(([^)]*)\)/g;
  let match;
  let found = false;
  while ((match = pattern.exec(text))) {
    found = true;
    const name = match[1].toLowerCase();
    const args = splitArgs(match[2]);
    switch (name) {
      case 'translate3d': [result.x, result.y, result.z] = [parseLength(args[0]), parseLength(args[1]), parseLength(args[2])]; break;
      case 'translatez': result.z = parseLength(args[0]); break;
      case 'scale3d': [result.scaleX, result.scaleY, result.scaleZ] = args.slice(0, 3).map(parseNumber); break;
      case 'scalez': result.scaleZ = parseNumber(args[0]); break;
      case 'rotatex': result.rotateX = parseAngle(args[0]); break;
      case 'rotatey': result.rotateY = parseAngle(args[0]); break;
      case 'rotatez': result.rotateZ = parseAngle(args[0]); break;
      case 'perspective': result.perspective = parseLength(args[0]); break;
      case 'translate': result.x = parseLength(args[0] ?? 0); result.y = parseLength(args[1] ?? 0); break;
      case 'translatex': result.x = parseLength(args[0]); break;
      case 'translatey': result.y = parseLength(args[0]); break;
      case 'scale': result.scaleX = parseNumber(args[0]); result.scaleY = parseNumber(args[1] ?? args[0]); break;
      case 'scalex': result.scaleX = parseNumber(args[0]); break;
      case 'scaley': result.scaleY = parseNumber(args[0]); break;
      case 'rotate': result.rotateZ = parseAngle(args[0]); break;
      case 'skewx': result.skewX = parseAngle(args[0]); break;
      case 'skewy': result.skewY = parseAngle(args[0]); break;
      default: throw new TypeError(`Unsupported 3D transform function: ${name}`);
    }
  }
  if (!found) throw new TypeError(`Invalid transform: ${text}`);
  return result;
}

export function parseTransform(input) {
  if (!input || input === 'none') return { ...identityTransform };
  if (typeof input === 'object') {
    const scale = Number(input.scale ?? 1);
    return {
      ...identityTransform,
      ...input,
      x: Number(input.x ?? 0), y: Number(input.y ?? 0), z: Number(input.z ?? 0),
      scaleX: Number(input.scaleX ?? scale), scaleY: Number(input.scaleY ?? scale), scaleZ: Number(input.scaleZ ?? scale),
      rotateX: Number(input.rotateX ?? 0), rotateY: Number(input.rotateY ?? 0), rotateZ: Number(input.rotateZ ?? input.rotate ?? 0),
      skewX: Number(input.skewX ?? 0), skewY: Number(input.skewY ?? 0), perspective: Number(input.perspective ?? 0),
    };
  }
  if (typeof input !== 'string') throw new TypeError('Transform must be a string or component object.');
  const text = input.trim();
  const matrix = parse2DString(text);
  return matrix ? decomposeMatrix2D(matrix) : parse3DComponents(text);
}

function shortestAngle(from, to) {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

export function mixTransform(fromInput, toInput, progress, { shortestRotation = true } = {}) {
  const from = parseTransform(fromInput);
  const to = parseTransform(toInput);
  const t = clamp(progress, 0, 1);
  const angle = (key) => shortestRotation ? from[key] + shortestAngle(from[key], to[key]) * t : lerp(from[key], to[key], t);
  return {
    x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), z: lerp(from.z, to.z, t),
    scaleX: lerp(from.scaleX, to.scaleX, t), scaleY: lerp(from.scaleY, to.scaleY, t), scaleZ: lerp(from.scaleZ, to.scaleZ, t),
    rotateX: angle('rotateX'), rotateY: angle('rotateY'), rotateZ: angle('rotateZ'),
    skewX: angle('skewX'), skewY: angle('skewY'),
    perspective: lerp(from.perspective, to.perspective, t),
  };
}

function clean(value) { return Math.abs(value) < 1e-7 ? 0 : Math.round(value * 100000) / 100000; }

export function formatTransform(value) {
  const t = parseTransform(value);
  const parts = [];
  if (t.perspective) parts.push(`perspective(${clean(t.perspective)}px)`);
  if (t.x || t.y || t.z) parts.push(`translate3d(${clean(t.x)}px, ${clean(t.y)}px, ${clean(t.z)}px)`);
  if (Math.abs(t.rotateX) > 1e-7) parts.push(`rotateX(${clean(t.rotateX)}deg)`);
  if (Math.abs(t.rotateY) > 1e-7) parts.push(`rotateY(${clean(t.rotateY)}deg)`);
  if (Math.abs(t.rotateZ) > 1e-7) parts.push(`rotate(${clean(t.rotateZ)}deg)`);
  if (Math.abs(t.skewX) > 1e-7) parts.push(`skewX(${clean(t.skewX)}deg)`);
  if (Math.abs(t.skewY) > 1e-7) parts.push(`skewY(${clean(t.skewY)}deg)`);
  if (t.scaleX !== 1 || t.scaleY !== 1 || t.scaleZ !== 1) parts.push(`scale3d(${clean(t.scaleX)}, ${clean(t.scaleY)}, ${clean(t.scaleZ)})`);
  return parts.length ? parts.join(' ') : 'none';
}

export function interpolateTransform(from, to, options) {
  const start = parseTransform(from);
  const end = parseTransform(to);
  return (progress) => formatTransform(mixTransform(start, end, progress, options));
}

export function formatMatrix2D(matrix) {
  return `matrix(${matrix.map(clean).join(', ')})`;
}
