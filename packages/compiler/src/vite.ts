import { createVuneSourceMap } from "./source-map.js"
import { hasVuneSyntax, transformVuneSource } from "./pipeline.js"
import type { VuneTransformResult, VuneVitePluginOptions } from "./types.js"

const VUNE_SOURCE_RE = /\.vune(?:\.tsx?)?$/i
const HOST_SCRIPT_RE = /\.[cm]?[jt]sx?$/i
const DEFAULT_RESOLVE_EXTENSIONS = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"]

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

export function createVuneVitePlugin(options: VuneVitePluginOptions = {}) {
  const cache = new Map<string, { source: string; result: VuneTransformResult | null }>()
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
    if (isVueScript && isGeneratedVueScript(source)) return null
    const vueSource = isVue && !isVueScript
      ? transformVueSfcSource(source, fileName)
      : source
    if (!isVue && !VUNE_SOURCE_RE.test(fileName) && !hasVuneSyntax(source, false)) return null
    if (isVue && vueSource === source && !isVueScript) return null
    if (isVueScript && !hasVuneSyntax(source, !/(?:^|&)lang\.(?:tsx|jsx)(?:&|$)/.test(query))) return null
    const cacheKey = isVue ? id : fileName
    const cached = cache.get(cacheKey)
    if (cached?.source === source) return cached.result
    const code = isVue && !isVueScript ? vueSource : transformVuneSource(source, fileName)
    const transformed = code === source ? null : { code, map: createVuneSourceMap(source, code, fileName) }
    cache.set(cacheKey, { source, result: transformed })
    return transformed
  }
  const dependencyScanPlugin = {
    name: "vune-compiler:dependency-scan",
    transform,
  }
  return {
    name: "vune-compiler",
    enforce: "pre" as const,
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
