import * as ts from 'typescript'
import { formatVuneSource } from './language-tools.js'
import {
  createVuneSourceMap,
  mapGeneratedPosition,
  mapOriginalPosition,
  type VuneSourceMap,
} from './source-map.js'

export interface VuneTypeScriptLanguageServiceOptions {
  /** Restrict preprocessing to files that match this predicate. */
  readonly isVuneFile?: (fileName: string) => boolean
}

function defaultIsVuneFile(fileName: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(fileName.split('?', 1)[0])
}

interface VuneDocument {
  readonly source: string
  readonly generated: string
  readonly map: VuneSourceMap
  readonly version: string
}

function linePosition(source: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(source.length, Math.trunc(offset)))
  const before = source.slice(0, bounded)
  const lineStart = before.lastIndexOf('\n') + 1
  return { line: before.split('\n').length, column: bounded - lineStart + 1 }
}

function offsetAt(source: string, position: { line: number; column: number }): number {
  const line = Math.max(1, Math.trunc(position.line))
  const column = Math.max(1, Math.trunc(position.column))
  const lines = source.split('\n')
  const lineStart = lines.slice(0, Math.min(line - 1, lines.length - 1))
    .reduce((offset, value) => offset + value.length + 1, 0)
  return Math.max(0, Math.min(source.length, lineStart + column - 1))
}

function documentFor(
  snapshot: ts.IScriptSnapshot | undefined,
  fileName: string,
  isVuneFile: (fileName: string) => boolean,
  version: string,
): VuneDocument | undefined {
  if (!snapshot || !isVuneFile(fileName)) return undefined
  const source = snapshot.getText(0, snapshot.getLength())
  try {
    const generated = formatVuneSource(source)
    return { source, generated, version, map: createVuneSourceMap(source, generated, fileName) }
  } catch {
    return { source, generated: source, version, map: createVuneSourceMap(source, source, fileName) }
  }
}

function mapOffset(document: VuneDocument, offset: number, reverse: boolean): number {
  const position = linePosition(reverse ? document.source : document.generated, offset)
  const mapped = reverse
    ? mapOriginalPosition(document.map, position)
    : mapGeneratedPosition(document.map, position)
  return offsetAt(reverse ? document.generated : document.source, mapped)
}

function mapTextSpan(span: ts.TextSpan | undefined, document: VuneDocument | undefined): ts.TextSpan | undefined {
  if (!span || !document) return span
  const start = mapOffset(document, span.start, false)
  const end = mapOffset(document, span.start + span.length, false)
  return { start, length: Math.max(0, end - start) }
}

function mapDiagnostic(diagnostic: ts.Diagnostic, documents: Map<string, VuneDocument>): ts.Diagnostic {
  const fileName = diagnostic.file?.fileName
  const document = fileName ? documents.get(fileName) : undefined
  const relatedInformation = diagnostic.relatedInformation?.map(info => mapDiagnostic(info, documents))
  if (!document || diagnostic.start === undefined) {
    return relatedInformation ? { ...diagnostic, relatedInformation } : diagnostic
  }
  const span = mapTextSpan({ start: diagnostic.start, length: diagnostic.length ?? 0 }, document)
  return {
    ...diagnostic,
    ...(span ? { start: span.start, length: span.length } : {}),
    ...(relatedInformation ? { relatedInformation } : {}),
  }
}

function mapFileSpan<T extends { fileName: string; textSpan: ts.TextSpan }>(value: T, documents: Map<string, VuneDocument>): T {
  const document = documents.get(value.fileName)
  if (!document) return value
  return { ...value, textSpan: mapTextSpan(value.textSpan, document) ?? value.textSpan }
}

function mapLanguageServiceResult(
  method: string,
  result: any,
  documents: Map<string, VuneDocument>,
  inputFileName?: string,
): any {
  if (result === undefined || result === null) return result
  const inputDocument = inputFileName ? documents.get(inputFileName) : undefined
  if (method === 'getQuickInfoAtPosition') {
    return { ...result, textSpan: mapTextSpan(result.textSpan, inputDocument) }
  }
  if (method === 'getCompletionInfo') {
    return { ...result, replacementSpan: mapTextSpan(result.replacementSpan, inputDocument) }
  }
  if (method === 'getSignatureHelpItems') {
    return { ...result, applicableSpan: mapTextSpan(result.applicableSpan, inputDocument) }
  }
  if (method === 'getDefinitionAndBoundSpan') {
    return {
      ...result,
      textSpan: mapTextSpan(result.textSpan, inputDocument),
      definitions: result.definitions?.map((value: any) => mapFileSpan(value, documents)),
    }
  }
  if (method === 'getRenameInfo') {
    return { ...result, triggerSpan: mapTextSpan(result.triggerSpan, inputDocument) }
  }
  if (method === 'getOutliningSpans') {
    return result.map((value: any) => ({
      ...value,
      textSpan: mapTextSpan(value.textSpan, inputDocument),
      hintSpan: mapTextSpan(value.hintSpan, inputDocument),
    }))
  }
  if (method === 'findRenameLocations' || method === 'getReferencesAtPosition' || method === 'getImplementationAtPosition' || method === 'getTypeDefinitionAtPosition') {
    return result.map((value: any) => mapFileSpan(value, documents))
  }
  return result
}

const diagnosticMethods = new Set([
  'getSyntacticDiagnostics',
  'getSemanticDiagnostics',
  'getSuggestionDiagnostics',
])

const positionMethods = new Set([
  'getQuickInfoAtPosition',
  'getCompletionInfo',
  'getSignatureHelpItems',
  'getDefinitionAndBoundSpan',
  'getRenameInfo',
  'findRenameLocations',
  'getReferencesAtPosition',
  'getImplementationAtPosition',
  'getTypeDefinitionAtPosition',
])

/**
 * Wrap a TypeScript host so editor services parse the same lowered program as
 * the standalone compiler and Vite plugin. The wrapper keeps script versions
 * and all filesystem behavior owned by the caller.
 */
export function createVuneTypeScriptLanguageService(
  host: ts.LanguageServiceHost,
  options: VuneTypeScriptLanguageServiceOptions = {},
  documentRegistry?: ts.DocumentRegistry,
): ts.LanguageService {
  const isVuneFile = options.isVuneFile ?? defaultIsVuneFile
  const documents = new Map<string, VuneDocument>()
  const vuneHost: ts.LanguageServiceHost = {
    ...host,
    getScriptSnapshot(fileName) {
      const snapshot = host.getScriptSnapshot(fileName)
      if (!isVuneFile(fileName)) return snapshot
      const version = host.getScriptVersion?.(fileName) ?? ''
      const cached = documents.get(fileName)
      if (cached?.version === version) {
        return cached.generated !== cached.source
          ? ts.ScriptSnapshot.fromString(cached.generated)
          : snapshot
      }
      const document = documentFor(snapshot, fileName, isVuneFile, version)
      if (document) documents.set(fileName, document)
      return document && document.generated !== document.source
        ? ts.ScriptSnapshot.fromString(document.generated)
        : snapshot
    },
  }
  const ensureDocument = (fileName: string): VuneDocument | undefined => {
    if (!isVuneFile(fileName)) return undefined
    const version = host.getScriptVersion?.(fileName) ?? ''
    const cached = documents.get(fileName)
    if (cached?.version === version) return cached
    const document = documentFor(host.getScriptSnapshot(fileName), fileName, isVuneFile, version)
    if (document) documents.set(fileName, document)
    return document
  }
  const service = ts.createLanguageService(vuneHost, documentRegistry)
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      const method = String(property)
      return (...args: any[]) => {
        const mappedArgs = [...args]
        if (typeof mappedArgs[0] === 'string') ensureDocument(mappedArgs[0])
        if (positionMethods.has(method) && typeof mappedArgs[0] === 'string' && typeof mappedArgs[1] === 'number') {
          const document = documents.get(mappedArgs[0])
          if (document) mappedArgs[1] = mapOffset(document, mappedArgs[1], true)
        }
        const result = value.apply(target, mappedArgs)
        if (diagnosticMethods.has(method)) {
          return (result as ts.Diagnostic[]).map(diagnostic => mapDiagnostic(diagnostic, documents))
        }
        return mapLanguageServiceResult(method, result, documents, typeof mappedArgs[0] === 'string' ? mappedArgs[0] : undefined)
      }
    },
  }) as ts.LanguageService
}
