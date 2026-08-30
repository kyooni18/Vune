export type PathMorphOptions = {
  align?: boolean;
  allowReverse?: boolean;
  precision?: number;
  alignmentCandidates?: number;
};

export type ParsedPathSegment = {
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  p3: { x: number; y: number };
};

export function parsePath(path: string): {
  subpaths: Array<{ segments: ParsedPathSegment[]; closed: boolean }>;
};

export function normalizePathPair(fromPath: string, toPath: string, options?: PathMorphOptions): {
  from: { coords: Float64Array; subpaths: Array<{ offset: number; count: number; closed: boolean }> };
  to: { coords: Float64Array; subpaths: Array<{ offset: number; count: number; closed: boolean }> };
};

export class PathMorpher {
  constructor(fromPath: string, toPath: string, options?: PathMorphOptions);
  readonly coordinateCount: number;
  readonly segmentCount: number;
  readonly from: Float64Array;
  readonly to: Float64Array;
  readonly buffer: Float64Array;
  sampleInto(progress: number, output?: Float64Array): Float64Array;
  format(buffer?: Float64Array): string;
  sample(progress: number): string;
}

export function createPathMorpher(fromPath: string, toPath: string, options?: PathMorphOptions): PathMorpher;
export function interpolatePath(fromPath: string, toPath: string, options?: PathMorphOptions): (progress: number) => string;
