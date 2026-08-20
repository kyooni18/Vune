export type CoordinateSpace = 'local' | 'global' | string

export interface Geometry {
  x:number
  y:number
  width:number
  height:number
}

export class CoordinateRegistry {
  private spaces = new Map<string, Geometry>()

  set(name:string, geometry:Geometry) { this.spaces.set(name, geometry) }
  get(name:CoordinateSpace):Geometry|undefined { return this.spaces.get(name) }
}

export const globalCoordinates = new CoordinateRegistry()
