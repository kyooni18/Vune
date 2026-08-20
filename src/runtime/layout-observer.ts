import { coordinateSpaceOf, type LayoutFrame, type LayoutNode } from '../coordinate.js'
import { globalCoordinates } from './coordinate-runtime.js'

export function measureElement(element: Element): LayoutFrame {
  const r = element.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

export function observeLayout(element: Element, node: LayoutNode, update?: (node: LayoutNode) => void) {
  const apply = () => {
    node.frame = measureElement(element)
    const space = coordinateSpaceOf(element)
    if (space !== 'local') node.coordinateSpace = space
    if (node.coordinateSpace !== 'local') globalCoordinates.set(node.coordinateSpace, node.frame)
    update?.(node)
  }
  apply()
  const observer = new ResizeObserver(apply)
  observer.observe(element)
  return () => observer.disconnect()
}
