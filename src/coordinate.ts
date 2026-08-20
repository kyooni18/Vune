export type CoordinateSpace = 'local' | 'global' | string

export interface LayoutFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface CoordinateNode {
  id: string
  frame: LayoutFrame
  coordinateSpace: CoordinateSpace
  children: CoordinateNode[]
}

const spaces = new WeakMap<object, CoordinateSpace>()

export function coordinateSpace<T extends object>(target: T, name: CoordinateSpace): T {
  spaces.set(target, name)
  return target
}

export function coordinateSpaceOf(target: object): CoordinateSpace {
  return spaces.get(target) ?? 'local'
}

export function emptyLayoutNode(id: string): CoordinateNode {
  return {
    id,
    frame: { x: 0, y: 0, width: 0, height: 0 },
    coordinateSpace: 'local',
    children: [],
  }
}
