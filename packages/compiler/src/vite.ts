import { createVuneSourceMap } from "./source-map.js"
import { hasVuneSyntax, transformVuneSource } from "./pipeline.js"
import { staticModifierNames } from "./specialization.js"
import type { VuneSourceMap, VuneTransformResult, VuneVitePluginOptions } from "./types.js"

const VUNE_SOURCE_RE = /\.vune(?:\.tsx?)?$/i
const HOST_SCRIPT_RE = /\.[cm]?[jt]sx?$/i
const DEFAULT_RESOLVE_EXTENSIONS = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"]
const VUNE_BINDING_HINT_RE = /\$[A-Za-z_$]/
const VUNE_STRUCT_HINT_RE = /\bstruct\s+[A-Z][A-Za-z0-9_$]*(?:\s*<[^>{}]*>)?\s*:\s*View\b/
const VUNE_BUILDER_HINT_RE = /\b[A-Z][A-Za-z0-9_$]*(?:\.[A-Z][A-Za-z0-9_$]*)?\s*\([^{}\n]*\)\s*\{/
const VUNE_LABELED_CALL_HINT_RE = /\b[A-Z][A-Za-z0-9_$]*(?:\.[A-Z][A-Za-z0-9_$]*)?\s*\([^()\n]*:[^()\n]*\)/
const VUNE_MODIFIER_HINT_RE = new RegExp(`\\.(?:${[...staticModifierNames].join("|")})\\s*\\(`)

function hasCheapVuneHint(source: string, fileName: string, allowRawHtml: boolean): boolean {
  if (VUNE_SOURCE_RE.test(fileName)) return true
  if (VUNE_BINDING_HINT_RE.test(source) || VUNE_STRUCT_HINT_RE.test(source)
    || VUNE_BUILDER_HINT_RE.test(source) || VUNE_LABELED_CALL_HINT_RE.test(source)
    || VUNE_MODIFIER_HINT_RE.test(source)) return true
  return allowRawHtml && /<[A-Za-z][^>]*>/.test(source)
}

function isVuneVueScript(attributes: string): boolean {
  const language = /\blang\s*=\s*(["'])([^"']+)\1/i.exec(attributes)?.[2]
  return !language || /^(?:vune|js|jsx|ts|tsx|mts|cts)$/i.test(language)
}

function isGeneratedVueScript(source: string): boolean {
  return /\b_defineComponent\(\{/.test(source)
    && /\bsetup\(__props(?:\s*,|\s*\))/.test(source)
    && /\b(?:_openBlock|_createBlock|_createElementBlock)\b/.test(source)
}

function transformVueSfcSource(source: string, fileName: string): string {
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  let output = source
  let changed = false
  let match: RegExpExecArray | null
  while ((match = script.exec(source))) {
    if (!isVuneVueScript(match[1])) continue
    const language = /\blang\s*=\s*(["'])([^"']+)\1/i.exec(match[1])?.[2] ?? "ts"
    if (!hasVuneSyntax(match[2], !/^(?:tsx|jsx)$/i.test(language))) continue
    const transformed = transformVuneSource(match[2], `${fileName}#script`)
    if (transformed === match[2]) continue
    const bodyStart = match.index + match[0].indexOf(match[2])
    const outputStart = bodyStart + (output.length - source.length)
    output = output.slice(0, outputStart) + transformed + output.slice(outputStart + match[2].length)
    changed = true
  }
  return changed ? output : source
}

function emptySourceMap(id: string): VuneSourceMap {
  return {
    version: 3,
    file: id,
    sources: [id],
    sourcesContent: [],
    names: [],
    mappings: "",
    x_vune: { lineMappings: [], segments: [] },
  }
}

export function createVuneVitePlugin(options: VuneVitePluginOptions = {}) {
  const cache = new Map<string, { source: string; result: VuneTransformResult | null }>()
  const maximumCacheEntries = 128
  const remember = (key: string, value: { source: string; result: VuneTransformResult | null }): void => {
    cache.delete(key)
    cache.set(key, value)
    while (cache.size > maximumCacheEntries) {
      const oldest = cache.keys().next().value as string | undefined
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }
  let sourceMapEnabled = options.sourceMap !== false
  const transform = (source: string, id: string): VuneTransformResult | null => {
    const fileName = id.split("?", 1)[0]
    const query = id.slice(fileName.length + (id.includes("?") ? 1 : 0))
    // Compiled workspace packages are already TypeScript output. Re-running
    // Vune lowering over their JavaScript can mistake ordinary method calls
    // for authoring syntax and corrupt otherwise valid module code.
    if (/[\\/]node_modules[\\/]/.test(fileName) || /[\\/]dist[\\/]/.test(fileName)) return null
    const isVue = /\.vue$/i.test(fileName)
    const isVueTemplate = isVue && /(?:^|&)type=template(?:&|$)/.test(query)
    const isVueStyle = isVue && /(?:^|&)type=style(?:&|$)/.test(query)
    const isVueScript = isVue && (
      /(?:^|&)type=script(?:&|$)/.test(query)
      || (!isVueTemplate && !isVueStyle && !/<(?:script|template)\b/i.test(source))
    )
    if (!isVue && !VUNE_SOURCE_RE.test(fileName) && !HOST_SCRIPT_RE.test(fileName)) return null
    if (options.include) {
      options.include.lastIndex = 0
      if (!options.include.test(fileName)) return null
    }
    if (isVue && (isVueTemplate || isVueStyle)) return null
    const cacheKey = isVue ? id : fileName
    // Check the exact-source cache before any parser-backed syntax probe. This
    // is especially important for Vite's dependency scan, which can invoke
    // the same transform hook again for unchanged plain TS/JS modules.
    const cached = cache.get(cacheKey)
    if (cached?.source === source) {
      remember(cacheKey, cached)
      return cached.result
    }
    if (isVueScript && isGeneratedVueScript(source)) {
      remember(cacheKey, { source, result: null })
      return null
    }
    const vueSource = isVue && !isVueScript
      ? transformVueSfcSource(source, fileName)
      : source
    const allowRawHtml = isVueScript
      ? !/(?:^|&)lang\.(?:tsx|jsx)(?:&|$)/.test(query)
      : false
    if (!isVue && !hasCheapVuneHint(source, fileName, false)) {
      remember(cacheKey, { source, result: null })
      return null
    }
    if (!isVue && !VUNE_SOURCE_RE.test(fileName) && !hasVuneSyntax(source, false)) {
      remember(cacheKey, { source, result: null })
      return null
    }
    if (isVue && vueSource === source && !isVueScript) {
      remember(cacheKey, { source, result: null })
      return null
    }
    if (isVueScript && !hasCheapVuneHint(source, fileName, allowRawHtml)) {
      remember(cacheKey, { source, result: null })
      return null
    }
    if (isVueScript && !hasVuneSyntax(source, allowRawHtml)) {
      remember(cacheKey, { source, result: null })
      return null
    }
    const code = isVue && !isVueScript ? vueSource : transformVuneSource(source, fileName)
    const transformed = code === source ? null : {
      code,
      map: sourceMapEnabled ? createVuneSourceMap(source, code, fileName) : emptySourceMap(fileName),
    }
    remember(cacheKey, { source, result: transformed })
    return transformed
  }
  const dependencyScanPlugin = {
    name: "vune-compiler:dependency-scan",
    transform,
  }
  return {
    name: "vune-compiler",
    enforce: "pre" as const,
    configResolved(resolvedConfig: { build?: { sourcemap?: boolean | "inline" | "hidden" } }) {
      // Direct unit tests and non-Vite callers have no resolved config, so the
      // option defaults to the historical detailed-map behavior. In a real
      // Vite build, honor build.sourcemap unless explicitly overridden.
      if (options.sourceMap === undefined) sourceMapEnabled = Boolean(resolvedConfig.build?.sourcemap)
    },
    config(userConfig: { resolve?: { extensions?: readonly string[] } } = {}) {
      const hostExtensions = userConfig.resolve?.extensions ?? DEFAULT_RESOLVE_EXTENSIONS
      return {
        resolve: {
          extensions: [...new Set([".vune", ".vune.ts", ".vune.tsx", ...hostExtensions])],
        },
        optimizeDeps: {
          rolldownOptions: {
            plugins: [dependencyScanPlugin],
          },
        },
      }
    },
    transform,
  }
}
