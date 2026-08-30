const DEFAULT_ALPHA = 0.12;

export class FrameBudgetGovernor {
  constructor({
    budgetMs = 8,
    alpha = DEFAULT_ALPHA,
    minWasmThreshold = 64,
    minWorkerThreshold = 512,
  } = {}) {
    this.budgetMs = Math.max(0.1, Number(budgetMs) || 8);
    this.alpha = Math.min(1, Math.max(0.01, Number(alpha) || DEFAULT_ALPHA));
    this.minWasmThreshold = Math.max(1, Math.floor(minWasmThreshold));
    this.minWorkerThreshold = Math.max(this.minWasmThreshold, Math.floor(minWorkerThreshold));
    this.samples = 0;
    this.emaMainThreadMs = 0;
    this.peakMainThreadMs = 0;
    this.pressure = 0;
    this.level = 'idle';
  }

  observe(mainThreadMs) {
    if (!Number.isFinite(mainThreadMs) || mainThreadMs < 0) return this.snapshot();
    this.samples += 1;
    if (this.samples === 1) this.emaMainThreadMs = mainThreadMs;
    else this.emaMainThreadMs += (mainThreadMs - this.emaMainThreadMs) * this.alpha;
    this.peakMainThreadMs = Math.max(this.peakMainThreadMs * 0.995, mainThreadMs);
    this.pressure = this.emaMainThreadMs / this.budgetMs;
    this.level = this.pressure >= 1.15
      ? 'critical'
      : this.pressure >= 0.75
        ? 'pressured'
        : this.pressure >= 0.25
          ? 'comfortable'
          : 'idle';
    return this.snapshot();
  }

  wasmThreshold(baseThreshold, activeCount) {
    const base = Math.max(1, Math.floor(baseThreshold));
    if (this.pressure < 0.75 || activeCount < this.minWasmThreshold) return base;
    const pressureScale = this.pressure >= 1.15 ? 0.35 : 0.6;
    return Math.max(this.minWasmThreshold, Math.min(base, Math.floor(base * pressureScale)));
  }

  workerThreshold(baseThreshold, activeCount) {
    const base = Math.max(1, Math.floor(baseThreshold));
    if (this.pressure < 1 || activeCount < this.minWorkerThreshold) return base;
    const pressureScale = this.pressure >= 1.35 ? 0.35 : 0.6;
    return Math.max(this.minWorkerThreshold, Math.min(base, Math.floor(base * pressureScale)));
  }

  snapshot() {
    return {
      budgetMs: this.budgetMs,
      emaMainThreadMs: this.emaMainThreadMs,
      peakMainThreadMs: this.peakMainThreadMs,
      pressure: this.pressure,
      level: this.level,
      samples: this.samples,
    };
  }
}
