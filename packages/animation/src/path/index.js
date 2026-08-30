const COMMAND_PARAMS = Object.freeze({
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
});

const TOKEN_RE = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const EPSILON = 1e-9;

function point(x, y) { return { x, y }; }
const lerp = (a, b, t) => a + (b - a) * t;
const midpoint = (a, b) => point((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const samePoint = (a, b) => Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;

function lineAsCubic(p0, p3) {
  return {
    p0: point(p0.x, p0.y),
    p1: point(lerp(p0.x, p3.x, 1 / 3), lerp(p0.y, p3.y, 1 / 3)),
    p2: point(lerp(p0.x, p3.x, 2 / 3), lerp(p0.y, p3.y, 2 / 3)),
    p3: point(p3.x, p3.y),
  };
}

function quadraticAsCubic(p0, q, p3) {
  return {
    p0: point(p0.x, p0.y),
    p1: point(p0.x + (q.x - p0.x) * (2 / 3), p0.y + (q.y - p0.y) * (2 / 3)),
    p2: point(p3.x + (q.x - p3.x) * (2 / 3), p3.y + (q.y - p3.y) * (2 / 3)),
    p3: point(p3.x, p3.y),
  };
}

function vectorAngle(ux, uy, vx, vy) {
  const dot = ux * vx + uy * vy;
  const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (len <= EPSILON) return 0;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot / len)));
  return (ux * vy - uy * vx < 0 ? -1 : 1) * angle;
}

function arcAsCubics(p0, rxInput, ryInput, rotationDeg, largeArcFlag, sweepFlag, p3) {
  let rx = Math.abs(rxInput);
  let ry = Math.abs(ryInput);
  if (rx <= EPSILON || ry <= EPSILON || samePoint(p0, p3)) {
    return samePoint(p0, p3) ? [] : [lineAsCubic(p0, p3)];
  }

  const phi = rotationDeg * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (p0.x - p3.x) * 0.5;
  const dy2 = (p0.y - p3.y) * 0.5;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const numerator = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
  const denominator = Math.max(EPSILON, rx2 * y1p2 + ry2 * x1p2);
  const sign = Boolean(largeArcFlag) === Boolean(sweepFlag) ? -1 : 1;
  const coefficient = sign * Math.sqrt(numerator / denominator);
  const cxp = coefficient * (rx * y1p / ry);
  const cyp = coefficient * (-ry * x1p / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p3.x) * 0.5;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p3.y) * 0.5;

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  let theta1 = vectorAngle(1, 0, ux, uy);
  let delta = vectorAngle(ux, uy, vx, vy);
  if (!sweepFlag && delta > 0) delta -= Math.PI * 2;
  if (sweepFlag && delta < 0) delta += Math.PI * 2;

  const segmentCount = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segmentCount;
  const result = [];

  const ellipsePoint = (theta) => point(
    cx + rx * cosPhi * Math.cos(theta) - ry * sinPhi * Math.sin(theta),
    cy + rx * sinPhi * Math.cos(theta) + ry * cosPhi * Math.sin(theta),
  );
  const derivative = (theta) => point(
    -rx * cosPhi * Math.sin(theta) - ry * sinPhi * Math.cos(theta),
    -rx * sinPhi * Math.sin(theta) + ry * cosPhi * Math.cos(theta),
  );

  for (let i = 0; i < segmentCount; i += 1) {
    const a = theta1 + i * step;
    const b = a + step;
    const k = (4 / 3) * Math.tan((b - a) / 4);
    const start = i === 0 ? p0 : ellipsePoint(a);
    const end = i === segmentCount - 1 ? p3 : ellipsePoint(b);
    const da = derivative(a);
    const db = derivative(b);
    result.push({
      p0: point(start.x, start.y),
      p1: point(start.x + k * da.x, start.y + k * da.y),
      p2: point(end.x - k * db.x, end.y - k * db.y),
      p3: point(end.x, end.y),
    });
  }
  return result;
}

function tokenizePath(path) {
  if (typeof path !== 'string') throw new TypeError('SVG path must be a string.');
  const tokens = path.match(TOKEN_RE) ?? [];
  if (tokens.length === 0) throw new TypeError('SVG path is empty or invalid.');
  return tokens;
}

function isCommand(token) { return /^[a-zA-Z]$/.test(token); }

function takeNumericToken(tokens, cursor, command) {
  if (cursor.index >= tokens.length || isCommand(tokens[cursor.index])) {
    throw new TypeError(`Not enough parameters for SVG command ${command}.`);
  }
  const raw = tokens[cursor.index++];
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new TypeError(`Invalid numeric value in SVG command ${command}.`);
  return value;
}

/**
 * SVG arc flags are single-character grammar productions, not ordinary
 * numbers. The path grammar therefore permits compact forms such as
 * `a2 2 0 00-2-2`, where the large-arc and sweep flags are adjacent. A
 * number-only tokenizer sees `00` as one token, so consume the flag one byte at
 * a time and leave any remainder for the next flag/coordinate.
 */
function takeArcFlag(tokens, cursor, command) {
  if (cursor.index >= tokens.length || isCommand(tokens[cursor.index])) {
    throw new TypeError(`Not enough parameters for SVG command ${command}.`);
  }
  const raw = tokens[cursor.index];
  const flag = raw[0];
  if (flag !== '0' && flag !== '1') throw new TypeError(`Invalid arc flag in SVG command ${command}.`);
  const remainder = raw.slice(1);
  if (remainder.length > 0) tokens[cursor.index] = remainder;
  else cursor.index += 1;
  return Number(flag);
}

function takeCommandArgs(tokens, cursor, upper, command) {
  if (upper === 'A') {
    return [
      takeNumericToken(tokens, cursor, command),
      takeNumericToken(tokens, cursor, command),
      takeNumericToken(tokens, cursor, command),
      takeArcFlag(tokens, cursor, command),
      takeArcFlag(tokens, cursor, command),
      takeNumericToken(tokens, cursor, command),
      takeNumericToken(tokens, cursor, command),
    ];
  }
  const count = COMMAND_PARAMS[upper];
  const args = new Array(count);
  for (let index = 0; index < count; index += 1) args[index] = takeNumericToken(tokens, cursor, command);
  return args;
}

export function parsePath(path) {
  const tokens = tokenizePath(path);
  const subpaths = [];
  let currentSubpath = null;
  let i = 0;
  let command = null;
  let current = point(0, 0);
  let subpathStart = point(0, 0);
  let previousCubicControl = null;
  let previousQuadraticControl = null;

  const ensureSubpath = () => {
    if (!currentSubpath) {
      currentSubpath = { segments: [], closed: false };
      subpaths.push(currentSubpath);
      subpathStart = point(current.x, current.y);
    }
  };

  const addSegment = (segment) => {
    ensureSubpath();
    currentSubpath.segments.push(segment);
    current = point(segment.p3.x, segment.p3.y);
  };

  while (i < tokens.length) {
    if (isCommand(tokens[i])) command = tokens[i++];
    if (!command) throw new TypeError('SVG path must begin with a command.');
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const paramCount = COMMAND_PARAMS[upper];
    if (paramCount == null) throw new TypeError(`Unsupported SVG path command: ${command}`);

    if (upper === 'Z') {
      if (currentSubpath) {
        if (!samePoint(current, subpathStart)) addSegment(lineAsCubic(current, subpathStart));
        currentSubpath.closed = true;
        current = point(subpathStart.x, subpathStart.y);
      }
      previousCubicControl = null;
      previousQuadraticControl = null;
      command = null;
      continue;
    }

    let firstSet = true;
    while (i < tokens.length && !isCommand(tokens[i])) {
      const cursor = { index: i };
      const args = takeCommandArgs(tokens, cursor, upper, command);
      i = cursor.index;

      const absX = (value) => relative ? current.x + value : value;
      const absY = (value) => relative ? current.y + value : value;

      if (upper === 'M') {
        const next = point(absX(args[0]), absY(args[1]));
        if (firstSet) {
          current = next;
          subpathStart = point(next.x, next.y);
          currentSubpath = { segments: [], closed: false };
          subpaths.push(currentSubpath);
        } else {
          addSegment(lineAsCubic(current, next));
        }
        previousCubicControl = null;
        previousQuadraticControl = null;
      } else if (upper === 'L') {
        addSegment(lineAsCubic(current, point(absX(args[0]), absY(args[1]))));
        previousCubicControl = null;
        previousQuadraticControl = null;
      } else if (upper === 'H') {
        addSegment(lineAsCubic(current, point(absX(args[0]), current.y)));
        previousCubicControl = null;
        previousQuadraticControl = null;
      } else if (upper === 'V') {
        addSegment(lineAsCubic(current, point(current.x, absY(args[0]))));
        previousCubicControl = null;
        previousQuadraticControl = null;
      } else if (upper === 'C') {
        const p1 = point(absX(args[0]), absY(args[1]));
        const p2 = point(absX(args[2]), absY(args[3]));
        const p3 = point(absX(args[4]), absY(args[5]));
        addSegment({ p0: point(current.x, current.y), p1, p2, p3 });
        previousCubicControl = point(p2.x, p2.y);
        previousQuadraticControl = null;
      } else if (upper === 'S') {
        const p1 = previousCubicControl
          ? point(current.x * 2 - previousCubicControl.x, current.y * 2 - previousCubicControl.y)
          : point(current.x, current.y);
        const p2 = point(absX(args[0]), absY(args[1]));
        const p3 = point(absX(args[2]), absY(args[3]));
        addSegment({ p0: point(current.x, current.y), p1, p2, p3 });
        previousCubicControl = point(p2.x, p2.y);
        previousQuadraticControl = null;
      } else if (upper === 'Q') {
        const q = point(absX(args[0]), absY(args[1]));
        const p3 = point(absX(args[2]), absY(args[3]));
        addSegment(quadraticAsCubic(current, q, p3));
        previousQuadraticControl = point(q.x, q.y);
        previousCubicControl = null;
      } else if (upper === 'T') {
        const q = previousQuadraticControl
          ? point(current.x * 2 - previousQuadraticControl.x, current.y * 2 - previousQuadraticControl.y)
          : point(current.x, current.y);
        const p3 = point(absX(args[0]), absY(args[1]));
        addSegment(quadraticAsCubic(current, q, p3));
        previousQuadraticControl = point(q.x, q.y);
        previousCubicControl = null;
      } else if (upper === 'A') {
        const p3 = point(absX(args[5]), absY(args[6]));
        const cubics = arcAsCubics(current, args[0], args[1], args[2], args[3] !== 0, args[4] !== 0, p3);
        for (const segment of cubics) addSegment(segment);
        previousCubicControl = cubics.length ? point(cubics.at(-1).p2.x, cubics.at(-1).p2.y) : null;
        previousQuadraticControl = null;
      }

      firstSet = false;
      if (upper === 'M') command = relative ? 'l' : 'L';
      if (i >= tokens.length || isCommand(tokens[i])) break;
    }
  }

  return { subpaths: subpaths.filter((subpath) => subpath.segments.length > 0) };
}

function cloneSegment(segment) {
  return {
    p0: point(segment.p0.x, segment.p0.y),
    p1: point(segment.p1.x, segment.p1.y),
    p2: point(segment.p2.x, segment.p2.y),
    p3: point(segment.p3.x, segment.p3.y),
  };
}

function splitCubic(segment) {
  const p01 = midpoint(segment.p0, segment.p1);
  const p12 = midpoint(segment.p1, segment.p2);
  const p23 = midpoint(segment.p2, segment.p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p = midpoint(p012, p123);
  return [
    { p0: cloneSegment(segment).p0, p1: p01, p2: p012, p3: p },
    { p0: p, p1: p123, p2: p23, p3: cloneSegment(segment).p3 },
  ];
}

function approximateCubicLength(segment) {
  return distance(segment.p0, segment.p1) + distance(segment.p1, segment.p2) + distance(segment.p2, segment.p3);
}

function equalizeSegments(segments, targetCount) {
  const result = segments.map(cloneSegment);
  while (result.length < targetCount) {
    let longestIndex = 0;
    let longestLength = -1;
    for (let i = 0; i < result.length; i += 1) {
      const length = approximateCubicLength(result[i]);
      if (length > longestLength) {
        longestLength = length;
        longestIndex = i;
      }
    }
    const [a, b] = splitCubic(result[longestIndex]);
    result.splice(longestIndex, 1, a, b);
  }
  return result;
}

function reverseSegments(segments) {
  return [...segments].reverse().map((segment) => ({
    p0: point(segment.p3.x, segment.p3.y),
    p1: point(segment.p2.x, segment.p2.y),
    p2: point(segment.p1.x, segment.p1.y),
    p3: point(segment.p0.x, segment.p0.y),
  }));
}

function rotateSegments(segments, shift) {
  if (shift === 0) return segments.map(cloneSegment);
  const n = segments.length;
  const result = [];
  for (let i = 0; i < n; i += 1) result.push(cloneSegment(segments[(i + shift) % n]));
  return result;
}

function segmentScore(a, b) {
  const pairs = [
    [a.p0, b.p0], [a.p1, b.p1], [a.p2, b.p2], [a.p3, b.p3],
  ];
  let score = 0;
  for (const [p, q] of pairs) {
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    score += dx * dx + dy * dy;
  }
  return score;
}

function alignmentScore(from, to) {
  let score = 0;
  for (let i = 0; i < from.length; i += 1) score += segmentScore(from[i], to[i]);
  return score;
}

function alignmentCandidateShifts(from, candidate, maxCandidates) {
  const n = candidate.length;
  if (n <= maxCandidates) return Array.from({ length: n }, (_, index) => index);
  const anchor = from[0].p0;
  const ranked = candidate.map((segment, index) => {
    const dx = segment.p0.x - anchor.x;
    const dy = segment.p0.y - anchor.y;
    return { index, score: dx * dx + dy * dy };
  });
  ranked.sort((a, b) => a.score - b.score);
  const result = new Set();
  const seedCount = Math.max(1, Math.floor(maxCandidates / 3));
  for (let i = 0; i < Math.min(seedCount, ranked.length); i += 1) {
    const index = ranked[i].index;
    result.add(index);
    result.add((index + n - 1) % n);
    result.add((index + 1) % n);
  }
  return [...result].slice(0, maxCandidates);
}

function alignClosedSegments(from, to, allowReverse, maxCandidates = 18) {
  let best = to.map(cloneSegment);
  let bestScore = Infinity;
  const candidates = allowReverse ? [to, reverseSegments(to)] : [to];
  for (const candidate of candidates) {
    const shifts = alignmentCandidateShifts(from, candidate, Math.max(3, maxCandidates));
    for (const shift of shifts) {
      const rotated = rotateSegments(candidate, shift);
      const score = alignmentScore(from, rotated);
      if (score < bestScore) {
        bestScore = score;
        best = rotated;
      }
    }
  }
  return best;
}

function maybeReverseOpen(from, to, allowReverse) {
  if (!allowReverse || from.length === 0 || to.length === 0) return to;
  const direct = distance(from[0].p0, to[0].p0) + distance(from.at(-1).p3, to.at(-1).p3);
  const reversed = distance(from[0].p0, to.at(-1).p3) + distance(from.at(-1).p3, to[0].p0);
  return reversed < direct ? reverseSegments(to) : to;
}

function flattenSubpaths(parsed, options) {
  const meta = [];
  const coords = [];
  for (const subpath of parsed.subpaths) {
    const offset = coords.length;
    for (const segment of subpath.segments) {
      coords.push(
        segment.p0.x, segment.p0.y,
        segment.p1.x, segment.p1.y,
        segment.p2.x, segment.p2.y,
        segment.p3.x, segment.p3.y,
      );
    }
    meta.push({ offset, count: subpath.segments.length, closed: subpath.closed });
  }
  return { coords: new Float64Array(coords), subpaths: meta, options };
}

export function normalizePathPair(fromPath, toPath, { align = true, allowReverse = true, alignmentCandidates = 18 } = {}) {
  const from = parsePath(fromPath);
  const to = parsePath(toPath);
  if (from.subpaths.length !== to.subpaths.length) {
    throw new TypeError(`Path morph requires the same number of subpaths (${from.subpaths.length} !== ${to.subpaths.length}).`);
  }

  const normalizedFrom = { subpaths: [] };
  const normalizedTo = { subpaths: [] };
  for (let i = 0; i < from.subpaths.length; i += 1) {
    const a = from.subpaths[i];
    const b = to.subpaths[i];
    const count = Math.max(a.segments.length, b.segments.length);
    let aSegments = equalizeSegments(a.segments, count);
    let bSegments = equalizeSegments(b.segments, count);

    if (align && a.closed && b.closed) bSegments = alignClosedSegments(aSegments, bSegments, allowReverse, alignmentCandidates);
    else if (align && !a.closed && !b.closed) bSegments = maybeReverseOpen(aSegments, bSegments, allowReverse);

    normalizedFrom.subpaths.push({ segments: aSegments, closed: a.closed });
    normalizedTo.subpaths.push({ segments: bSegments, closed: b.closed });
  }

  const flatFrom = flattenSubpaths(normalizedFrom, { align, allowReverse });
  const flatTo = flattenSubpaths(normalizedTo, { align, allowReverse });
  return { from: flatFrom, to: flatTo };
}

function formatNumber(value, precision) {
  if (Math.abs(value) < 10 ** (-(precision + 1))) return '0';
  const rounded = Number(value.toFixed(precision));
  return String(rounded);
}

export class PathMorpher {
  constructor(fromPath, toPath, options = {}) {
    const normalized = normalizePathPair(fromPath, toPath, options);
    this.from = normalized.from.coords;
    this.to = normalized.to.coords;
    this.subpaths = normalized.from.subpaths;
    this.precision = Math.max(0, Math.min(8, Math.floor(options.precision ?? 3)));
    this.buffer = new Float64Array(this.from.length);
    this.fromPath = fromPath;
    this.toPath = toPath;
  }

  get coordinateCount() { return this.from.length; }
  get segmentCount() { return this.from.length / 8; }

  sampleInto(progress, output = this.buffer) {
    if (!output || output.length < this.from.length) throw new RangeError('Path morph output buffer is too small.');
    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    for (let i = 0; i < this.from.length; i += 1) output[i] = this.from[i] + (this.to[i] - this.from[i]) * t;
    return output;
  }

  format(buffer = this.buffer) {
    const parts = [];
    for (const subpath of this.subpaths) {
      const start = subpath.offset;
      const f = (index) => formatNumber(buffer[index], this.precision);
      parts.push(`M${f(start)} ${f(start + 1)}`);
      for (let i = 0; i < subpath.count; i += 1) {
        const offset = start + i * 8;
        parts.push(`C${f(offset + 2)} ${f(offset + 3)} ${f(offset + 4)} ${f(offset + 5)} ${f(offset + 6)} ${f(offset + 7)}`);
      }
      if (subpath.closed) parts.push('Z');
    }
    return parts.join(' ');
  }

  sample(progress) {
    if (progress <= 0) return this.fromPath;
    if (progress >= 1) return this.toPath;
    return this.format(this.sampleInto(progress));
  }
}

export function createPathMorpher(fromPath, toPath, options = {}) {
  return new PathMorpher(fromPath, toPath, options);
}

export function interpolatePath(fromPath, toPath, options = {}) {
  const morpher = new PathMorpher(fromPath, toPath, options);
  return (progress) => morpher.sample(progress);
}
