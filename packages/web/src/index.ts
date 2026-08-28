/** Public Web adapter. DOM, SSR, and hydration internals stay behind focused modules. */
export { renderToHTML } from "./ssr.js"
export { mount } from "./dom.js"
export type { WebMountOptions } from "./dom.js"

export * from "./devtools.js"

export { LazyMeasurementIndex, lazyViewportOffset } from "./lazy-index.js"
export type { LazyViewportRange } from "./lazy-index.js"

export * from "./transition.js"
export * from "./presentation.js"

export * from "./element-motion.js"
