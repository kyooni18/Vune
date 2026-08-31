import type {
  KernelExpression,
  PackedLayout,
  ResidentRegionIR,
} from "@vune-ui/core/internal/execution"

interface EmitContext {
  readonly fields: ReadonlyMap<string, string>
  readonly captures: ReadonlyMap<string, string>
  readonly index: string
}

function safeFunctionName(name: string): string {
  if (!/^[$A-Z_a-z][$\w]*$/u.test(name)) throw new TypeError(`invalid resident executor name: ${name}`)
  return name
}

function sameLayout(left: PackedLayout, right: PackedLayout): boolean {
  return left.length === right.length
    && left.fields.length === right.fields.length
    && left.fields.every((field, index) => {
      const other = right.fields[index]
      return other?.name === field.name && other.type === field.type
    })
}

function emitExpression(expression: KernelExpression, context: EmitContext): string {
  if (expression.op === "const") return typeof expression.value === "boolean" ? String(expression.value) : JSON.stringify(expression.value)
  if (expression.op === "index") return context.index
  if (expression.op === "capture") {
    const capture = context.captures.get(expression.name)
    if (!capture) throw new TypeError(`resident kernel capture is not declared: ${expression.name}`)
    return capture
  }
  if (expression.op === "load") {
    if (expression.path.length !== 1 || typeof expression.path[0] !== "string") {
      throw new TypeError("packed JS code generation requires a single statically proven column load")
    }
    const field = context.fields.get(expression.path[0])
    if (!field) throw new TypeError(`resident kernel reads unknown packed field: ${expression.path[0]}`)
    return `${field}[${context.index}]`
  }
  if (expression.op === "unary") return `(${expression.operator}${emitExpression(expression.value, context)})`
  if (expression.op === "select") {
    return `(${emitExpression(expression.condition, context)} ? ${emitExpression(expression.whenTrue, context)} : ${emitExpression(expression.whenFalse, context)})`
  }
  return `(${emitExpression(expression.left, context)} ${expression.operator} ${emitExpression(expression.right, context)})`
}

/**
 * Emit a CSP-safe executor body at Vune compile time. The resulting bundle has
 * an ordinary numeric loop; it does not interpret Kernel IR in the browser.
 */
export function emitResidentRegionJS(region: ResidentRegionIR, functionName = "__vuneResidentRegion"): string {
  const name = safeFunctionName(functionName)
  if (region.inputResidency !== "packed" || region.outputResidency !== "packed") {
    throw new TypeError("resident JS code generation requires packed input and output")
  }
  if (!sameLayout(region.source.layout, region.sink.layout)) {
    throw new TypeError("resident JS code generation currently requires matching source and sink layouts")
  }
  if (region.kernels.length === 0 || region.kernels.some(kernel => kernel.kind !== "map")) {
    throw new TypeError("resident JS code generation currently requires map kernels")
  }

  const fieldVariables = new Map(region.sink.layout.fields.map((field, index) => [field.name, `__vuneColumn${index}`]))
  const captureNames = new Set(region.kernels.flatMap(kernel => [...kernel.captures]))
  const captureVariables = new Map([...captureNames].sort().map((capture, index) => [capture, `__vuneCapture${index}`]))
  const context: EmitContext = { fields: fieldVariables, captures: captureVariables, index: "__vuneIndex" }
  const lines = [
    `function ${name}(__vuneSourceStorage, __vuneSinkStorage = __vuneSourceStorage, __vuneCaptures = {}, __vuneInputRanges = null) {`,
    `  const __vuneSource = __vuneSourceStorage.buffers`,
    `  const __vuneSink = __vuneSinkStorage.buffers`,
    `  if (__vuneSourceStorage.layout.length !== ${region.source.layout.length} || __vuneSinkStorage.layout.length !== ${region.sink.layout.length}) throw new RangeError("resident storage length does not match compiled layout")`,
    `  const __vuneRanges = Array.isArray(__vuneInputRanges) ? __vuneInputRanges : [{ start: 0, end: ${region.sink.layout.length} }]`,
    `  if (__vuneRanges.length === 0) return __vuneSinkStorage`,
    `  if (__vuneSource !== __vuneSink) {`,
    `    for (let __vuneColumn = 0; __vuneColumn < ${region.sink.layout.fields.length}; __vuneColumn += 1) {`,
    `      const __vuneInput = __vuneSource[__vuneColumn]`,
    `      const __vuneOutput = __vuneSink[__vuneColumn]`,
    `      if (__vuneInput === __vuneOutput) continue`,
    `      for (let __vuneRangeIndex = 0; __vuneRangeIndex < __vuneRanges.length; __vuneRangeIndex += 1) {`,
    `        const __vuneRange = __vuneRanges[__vuneRangeIndex]`,
    `        if (!__vuneRange || !Number.isSafeInteger(__vuneRange.start) || !Number.isSafeInteger(__vuneRange.end) || __vuneRange.start < 0 || __vuneRange.end < __vuneRange.start || __vuneRange.end > ${region.sink.layout.length}) throw new RangeError("resident execution range does not match compiled layout")`,
    `        __vuneOutput.set(__vuneInput.subarray(__vuneRange.start, __vuneRange.end), __vuneRange.start)`,
    `      }`,
    `    }`,
    `  }`,
    ...region.sink.layout.fields.map((_, index) => `  const __vuneColumn${index} = __vuneSink[${index}]`),
    ...[...captureVariables].map(([capture, variable]) => `  const ${variable} = __vuneCaptures[${JSON.stringify(capture)}]`),
    ...[...captureVariables].map(([capture, variable]) => `  if (typeof ${variable} !== "number" && typeof ${variable} !== "boolean") throw new TypeError(${JSON.stringify(`resident kernel capture is missing or non-numeric: ${capture}`)})`),
    `  for (let __vuneRangeIndex = 0; __vuneRangeIndex < __vuneRanges.length; __vuneRangeIndex += 1) {`,
    `    const __vuneRange = __vuneRanges[__vuneRangeIndex]`,
    `    if (!__vuneRange || !Number.isSafeInteger(__vuneRange.start) || !Number.isSafeInteger(__vuneRange.end) || __vuneRange.start < 0 || __vuneRange.end < __vuneRange.start || __vuneRange.end > ${region.sink.layout.length}) throw new RangeError("resident execution range does not match compiled layout")`,
    `    for (let __vuneIndex = __vuneRange.start; __vuneIndex < __vuneRange.end; __vuneIndex += 1) {`,
  ]
  for (let kernelIndex = 0; kernelIndex < region.kernels.length; kernelIndex += 1) {
    const kernel = region.kernels[kernelIndex]!
    if (kernel.kind !== "map") continue
    for (let outputIndex = 0; outputIndex < kernel.outputs.length; outputIndex += 1) {
      const output = kernel.outputs[outputIndex]!
      lines.push(`    const __vuneKernel${kernelIndex}Output${outputIndex} = ${emitExpression(output.value, context)}`)
    }
    for (let outputIndex = 0; outputIndex < kernel.outputs.length; outputIndex += 1) {
      const output = kernel.outputs[outputIndex]!
      const field = fieldVariables.get(output.name)
      if (!field) throw new TypeError(`resident kernel writes unknown packed field: ${output.name}`)
      lines.push(`    ${field}[__vuneIndex] = __vuneKernel${kernelIndex}Output${outputIndex}`)
    }
  }
  lines.push(
    `    }`,
    `  }`,
    `  __vuneSinkStorage.version += 1`,
    `  return __vuneSinkStorage`,
    `}`,
  )
  return lines.join("\n")
}
