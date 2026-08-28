export interface LazyViewportRange {
  readonly start: number
  readonly end: number
}

/**
 * Convert viewport-relative bounding-rect starts to a lazy-list local offset.
 * Both inputs already include the browser scroll transform, so no scrollTop or
 * scrollLeft term belongs here. Keeping this tiny rule shared prevents nested
 * scroll containers from accidentally double-counting their scroll position.
 */
export function lazyViewportOffset(viewportStart: number, listStart: number): number {
  const viewport = Number.isFinite(viewportStart) ? viewportStart : 0
  const list = Number.isFinite(listStart) ? listStart : 0
  return Math.max(0, viewport - list)
}

/**
 * Sparse variable-size index for lazy stacks.
 *
 * Unknown rows use the configured estimate. Measured rows contribute only
 * their delta from that estimate to a Fenwick tree, so construction is O(1),
 * updates are O(log n), and offset/range lookups stay logarithmic without
 * allocating one measurement object per row.
 */
export class LazyMeasurementIndex {
  private countValue: number
  private estimateValue: number
  private gapValue: number
  private tree: Float64Array
  private readonly measured = new Map<number, number>()

  constructor(count: number, estimate: number, gap = 0) {
    this.countValue = normalizedCount(count)
    this.estimateValue = normalizedSize(estimate, 44)
    this.gapValue = normalizedGap(gap)
    this.tree = new Float64Array(this.countValue + 1)
  }

  get count(): number { return this.countValue }
  get estimate(): number { return this.estimateValue }
  get gap(): number { return this.gapValue }

  configure(count: number, estimate: number, gap = this.gapValue): void {
    const nextCount = normalizedCount(count)
    const nextEstimate = normalizedSize(estimate, this.estimateValue)
    const nextGap = normalizedGap(gap)
    if (nextCount === this.countValue && nextEstimate === this.estimateValue && nextGap === this.gapValue) return

    const previous = [...this.measured.entries()].filter(([index]) => index < nextCount)
    this.countValue = nextCount
    this.estimateValue = nextEstimate
    this.gapValue = nextGap
    this.measured.clear()
    this.tree = new Float64Array(nextCount + 1)
    for (const [index, size] of previous) this.set(index, size)
  }

  sizeAt(index: number): number {
    return this.measured.get(index) ?? this.estimateValue
  }

  set(index: number, size: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.countValue) return 0
    const next = normalizedSize(size, this.estimateValue)
    const previous = this.measured.get(index) ?? this.estimateValue
    if (Math.abs(previous - next) < 0.01) return 0
    this.measured.set(index, next)
    this.add(index + 1, next - previous)
    return next - previous
  }

  offsetForIndex(index: number): number {
    const bounded = Math.max(0, Math.min(this.countValue, Math.floor(index)))
    return bounded * this.estimateValue + this.sum(bounded) + this.gapValue * bounded
  }

  totalSize(): number {
    if (this.countValue === 0) return 0
    return this.countValue * this.estimateValue
      + this.sum(this.countValue)
      + this.gapValue * Math.max(0, this.countValue - 1)
  }

  indexAtOffset(offset: number): number {
    if (this.countValue === 0) return 0
    const target = Math.max(0, Number.isFinite(offset) ? offset : 0)
    let low = 0
    let high = this.countValue
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      const end = this.offsetForIndex(mid) + this.sizeAt(mid)
      if (end <= target) low = mid + 1
      else high = mid
    }
    return Math.min(this.countValue - 1, low)
  }

  rangeForViewport(offset: number, viewport: number, overscan: number): LazyViewportRange {
    if (this.countValue === 0) return { start: 0, end: 0 }
    const safeOffset = Math.max(0, Number.isFinite(offset) ? offset : 0)
    const safeViewport = Math.max(1, Number.isFinite(viewport) ? viewport : 1)
    const extra = Number.isSafeInteger(overscan) && overscan > 0 ? overscan : 0
    const first = this.indexAtOffset(safeOffset)
    const last = this.indexAtOffset(safeOffset + safeViewport)
    return {
      start: Math.max(0, first - extra),
      end: Math.min(this.countValue, last + 1 + extra),
    }
  }

  hiddenBeforeSize(start: number): number {
    const bounded = Math.max(0, Math.min(this.countValue, Math.floor(start)))
    if (bounded === 0) return 0
    return Math.max(0, this.offsetForIndex(bounded) - this.gapValue)
  }

  hiddenAfterSize(end: number): number {
    const bounded = Math.max(0, Math.min(this.countValue, Math.ceil(end)))
    if (bounded >= this.countValue) return 0
    return Math.max(0, this.totalSize() - this.offsetForIndex(bounded))
  }

  private add(position: number, delta: number): void {
    for (let index = position; index < this.tree.length; index += index & -index) this.tree[index] += delta
  }

  private sum(position: number): number {
    let total = 0
    for (let index = Math.min(position, this.countValue); index > 0; index -= index & -index) total += this.tree[index]
    return total
  }
}

function normalizedCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

function normalizedSize(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizedGap(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}
