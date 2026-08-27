/** Build a SwiftUI-style continuous-corner outline for a measured element. */
export interface CornerRadii {
  readonly topLeft: number
  readonly topRight: number
  readonly bottomRight: number
  readonly bottomLeft: number
}

const toRadians = (degrees: number): number => degrees * Math.PI / 180
const round4 = (value: number): number => Math.round(value * 1e4) / 1e4

interface CornerPathParameters {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly p: number
  readonly arcSectionLength: number
  readonly radius: number
}

function cornerPathParameters(radius: number, smoothing: number, budget: number): CornerPathParameters {
  const safeRadius = Math.max(0, Math.min(radius, budget))
  const safeSmoothing = Math.max(0, Math.min(smoothing, safeRadius === 0 ? 0 : budget / safeRadius - 1))
  const p = Math.min((1 + safeSmoothing) * safeRadius, budget)
  const arcMeasure = 90 * (1 - safeSmoothing)
  const arcSectionLength = Math.sin(toRadians(arcMeasure / 2)) * safeRadius * Math.sqrt(2)
  const angleAlpha = (90 - arcMeasure) / 2
  const p3ToP4 = safeRadius * Math.tan(toRadians(angleAlpha / 2))
  const angleBeta = 45 * safeSmoothing
  const c = p3ToP4 * Math.cos(toRadians(angleBeta))
  const d = c * Math.tan(toRadians(angleBeta))
  const b = (p - arcSectionLength - c - d) / 3
  return { a: 2 * b, b, c, d, p, arcSectionLength, radius: safeRadius }
}

function topRightPath(parameters: CornerPathParameters): string {
  const { radius, a, b, c, d, p, arcSectionLength } = parameters
  if (radius === 0) return `L ${round4(p)} 0`
  return `c ${round4(a)} 0 ${round4(a + b)} 0 ${round4(a + b + c)} ${round4(d)} a ${round4(radius)} ${round4(radius)} 0 0 1 ${round4(arcSectionLength)} ${round4(arcSectionLength)} c ${round4(d)} ${round4(c)} ${round4(d)} ${round4(b + c)} ${round4(d)} ${round4(a + b + c)}`
}

function bottomRightPath(parameters: CornerPathParameters): string {
  const { radius, a, b, c, d, p, arcSectionLength } = parameters
  if (radius === 0) return `L 0 ${round4(p)}`
  return `c 0 ${round4(a)} 0 ${round4(a + b)} ${round4(-d)} ${round4(a + b + c)} a ${round4(radius)} ${round4(radius)} 0 0 1 -${round4(arcSectionLength)} ${round4(arcSectionLength)} c ${round4(-c)} ${round4(d)} ${round4(-(b + c))} ${round4(d)} ${round4(-(a + b + c))} ${round4(d)}`
}

function bottomLeftPath(parameters: CornerPathParameters): string {
  const { radius, a, b, c, d, p, arcSectionLength } = parameters
  if (radius === 0) return `L ${round4(-p)} 0`
  return `c ${round4(-a)} 0 ${round4(-(a + b))} 0 ${round4(-(a + b + c))} ${round4(-d)} a ${round4(radius)} ${round4(radius)} 0 0 1 -${round4(arcSectionLength)} -${round4(arcSectionLength)} c ${round4(-d)} ${round4(-c)} ${round4(-d)} ${round4(-(b + c))} ${round4(-d)} ${round4(-(a + b + c))}`
}

function topLeftPath(parameters: CornerPathParameters): string {
  const { radius, a, b, c, d, p, arcSectionLength } = parameters
  if (radius === 0) return `L 0 ${round4(-p)}`
  return `c 0 ${round4(-a)} 0 ${round4(-(a + b))} ${round4(d)} ${round4(-(a + b + c))} a ${round4(radius)} ${round4(radius)} 0 0 1 ${round4(arcSectionLength)} -${round4(arcSectionLength)} c ${round4(c)} ${round4(-d)} ${round4(b + c)} ${round4(-d)} ${round4(a + b + c)} ${round4(-d)}`
}

export function continuousCornerPath(width: number, height: number, radii: CornerRadii, smoothing = 0.6): string {
  const safeWidth = Math.max(0, width)
  const safeHeight = Math.max(0, height)
  const budget = Math.min(safeWidth, safeHeight) / 2
  const parameters = {
    topLeft: cornerPathParameters(radii.topLeft, smoothing, budget),
    topRight: cornerPathParameters(radii.topRight, smoothing, budget),
    bottomRight: cornerPathParameters(radii.bottomRight, smoothing, budget),
    bottomLeft: cornerPathParameters(radii.bottomLeft, smoothing, budget),
  }
  return [
    `M ${round4(safeWidth - parameters.topRight.p)} 0`,
    topRightPath(parameters.topRight),
    `L ${round4(safeWidth)} ${round4(safeHeight - parameters.bottomRight.p)}`,
    bottomRightPath(parameters.bottomRight),
    `L ${round4(parameters.bottomLeft.p)} ${round4(safeHeight)}`,
    bottomLeftPath(parameters.bottomLeft),
    `L 0 ${round4(parameters.topLeft.p)}`,
    topLeftPath(parameters.topLeft),
    "Z",
  ].join(" ")
}
