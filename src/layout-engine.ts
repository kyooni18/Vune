export interface ProposedSize {
  width?: number
  height?: number
}

export interface LayoutResult {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutNode {
  id: string
  children: LayoutNode[]
  frame?: LayoutResult
  measure(proposal: ProposedSize): LayoutResult
}

export function createLayoutNode(id: string, measure: (proposal: ProposedSize) => LayoutResult, children: LayoutNode[] = []): LayoutNode {
  return { id, children, measure }
}

export function layoutPass(root: LayoutNode, proposal: ProposedSize): LayoutResult {
  const result = root.measure(proposal)
  root.frame = result
  for (const child of root.children) layoutPass(child, { width: result.width, height: result.height })
  return result
}
