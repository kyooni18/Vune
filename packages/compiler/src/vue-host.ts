import { createSemanticModel } from "./semantic.js"
import { transformVuneSource } from "./pipeline.js"

export interface VuneVueHostGenerationOptions {
  /** View to expose when a file contains more than one struct View. */
  readonly viewName?: string
  /** Module specifier used to import the compiled Vune View. */
  readonly viewImport: string
  /** Framework adapter that exports createVuneWebHost. */
  readonly hostFactoryImport?: string
  /** Optional legacy prop names keyed by Vune initializer field name. */
  readonly aliases?: Readonly<Record<string, string>>
  readonly initializerIndex?: number
  /** Emit TypeScript-only props declarations/assertions. Disable for Vite runtime transforms. */
  readonly emitTypes?: boolean
}

export interface VuneVueHostGenerationResult {
  readonly viewName: string
  readonly propsTypeName: string
  readonly code: string
}

function hostType(type: string | undefined, kind: string): string {
  if (kind === "action") return "(...args: any[]) => unknown"
  if (kind === "viewBuilder") return "() => unknown"
  if (kind === "binding") return "unknown"
  const normalized = type?.trim()
  if (!normalized || normalized === "unknown" || normalized === "any") return "unknown"
  return normalized
}

function propertyName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value)
}

/**
 * Generate a thin, typed Vue placement module from the same semantic model the
 * Vune compiler and IDE use. This is intentionally a migration tool: it moves
 * initializer/prop mapping to build time without making Vue part of Vune core.
 */
export function generateVueHostModule(
  source: string,
  fileName: string,
  options: VuneVueHostGenerationOptions,
): VuneVueHostGenerationResult {
  const model = createSemanticModel(source, fileName, transformVuneSource(source, fileName))
  const view = options.viewName ? model.view(options.viewName) : model.views[0]
  if (!view) throw new TypeError(`No Vune View found in ${fileName}`)
  if (options.viewName && view.name !== options.viewName && view.qualifiedName !== options.viewName) {
    throw new TypeError(`Vune View ${options.viewName} was not found in ${fileName}`)
  }
  if (view.genericParameters) throw new TypeError(`Generic Vune View ${view.qualifiedName} cannot be emitted as a legacy Vue host`)

  const initializerIndex = options.initializerIndex ?? 0
  const initializer = view.initializers[initializerIndex]
  if (!initializer && (initializerIndex !== 0 || view.initializers.length > 0)) {
    throw new RangeError(`Initializer ${initializerIndex} does not exist on ${view.qualifiedName}`)
  }
  const aliases = options.aliases ?? {}
  if (!initializer && Object.keys(aliases).length > 0) {
    throw new TypeError(`Aliases require an explicit initializer on ${view.qualifiedName}`)
  }
  const propsTypeName = `${view.name}VueProps`
  const properties = (initializer?.parameters ?? []).flatMap(parameter => {
    const name = parameter.name ?? parameter.label
    if (!name) return []
    const legacyName = aliases[name] ?? name
    const optional = parameter.required === false ? "?" : ""
    return [`  readonly ${propertyName(legacyName)}${optional}: ${hostType(parameter.type, parameter.kind)}`]
  })
  const aliasSource = Object.keys(aliases).length > 0
    ? `, aliases: ${JSON.stringify(aliases)}`
    : ""
  const hostOptions = initializer
    ? `, { initializerIndex: ${initializerIndex}${aliasSource} }`
    : ""
  const hostName = `${view.name}VueHost`
  const propsDeclaration = properties.length > 0
    ? [`export interface ${propsTypeName} {`, ...properties, "}"].join("\n")
    : `export interface ${propsTypeName} {}`
  const emitTypes = options.emitTypes !== false
  const code = emitTypes
    ? [
      `import { ${view.name} } from ${JSON.stringify(options.viewImport)}`,
      `import { createVuneWebHost } from ${JSON.stringify(options.hostFactoryImport ?? "@/vune/compat-vue.js")}`,
      "",
      propsDeclaration,
      "",
      `const ${hostName} = createVuneWebHost(${view.name}${hostOptions})`,
      `export default ${hostName} as typeof ${hostName} & { new(): { $props: ${propsTypeName} } }`,
      "",
    ].join("\n")
    : [
      `import { ${view.name} } from ${JSON.stringify(options.viewImport)}`,
      `import { createVuneWebHost } from ${JSON.stringify(options.hostFactoryImport ?? "@/vune/compat-vue.js")}`,
      "",
      `const ${hostName} = createVuneWebHost(${view.name}${hostOptions})`,
      `export default ${hostName}`,
      "",
    ].join("\n")
  return { viewName: view.name, propsTypeName, code }
}
