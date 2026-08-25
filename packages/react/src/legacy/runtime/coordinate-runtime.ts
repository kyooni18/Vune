import type { CoordinateSpace, LayoutFrame } from '../coordinate.js'

export type { CoordinateSpace } from '../coordinate.js'
export type Geometry = LayoutFrame

export class CoordinateRegistry {
  private spaces = new Map<string, Geometry>()

  set(name:string, geometry:Geometry) { this.spaces.set(name, geometry) }
  get(name:CoordinateSpace):Geometry|undefined { return this.spaces.get(name) }
}

export const globalCoordinates = new CoordinateRegistry()
