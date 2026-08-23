/**
 * Public graph barrel.
 *
 * Runtime concerns intentionally live behind focused modules so renderer
 * adapters depend on stable graph contracts rather than one monolithic file:
 * types/environment, nodes, modifiers, traversal, and initializer semantics.
 */
export { vuneForeignComponent, vuneInitializers, vuneNamedArguments, vuneView } from "./graph/symbols.js"
export * from "./graph/types.js"
export * from "./graph/environment.js"
export { modifiedContent, modifier, modifierGraphOf } from "./graph/modifiers.js"
export * from "./graph/nodes.js"
export * from "./graph/renderer.js"
export * from "./graph/initializers.js"
