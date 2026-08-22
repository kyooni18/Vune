import { type DomRenderContext } from "./shared.js"
import { rememberDomProps, setDomEvent, setDomRef } from "./props.js"

function activateHydratedProps(source: Element, target: HTMLElement, context: DomRenderContext): void {
  const props = context.hydrationProps.get(source)
  rememberDomProps(target, props, context)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === "children" || key === "key" || value === undefined || value === null || value === false) continue
    if (key === "ref") { setDomRef(value, target, context); continue }
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) {
      setDomEvent(target, key, value, context)
      continue
    }
    if (key === "value" || key === "checked" || key === "selected" || key === "disabled") {
      try { (target as unknown as Record<string, unknown>)[key] = value } catch { /* attribute remains authoritative */ }
    }
  }
}

export function hydrateNode(source: Node, target: Node, context: DomRenderContext): boolean {
  if (source.nodeType !== target.nodeType) return false
  if (source.nodeType === 3) {
    target.nodeValue = source.nodeValue
    return true
  }
  if (source.nodeType !== 1 || target.nodeType !== 1) return source.nodeType === target.nodeType
  const sourceElement = source as Element
  const targetElement = target as HTMLElement
  if (sourceElement.tagName !== targetElement.tagName) return false
  activateHydratedProps(sourceElement, targetElement, context)
  context.domKeys.set(targetElement, context.domKeys.get(sourceElement))
  const sourceChildren = [...source.childNodes]
  const targetChildren = [...target.childNodes]
  if (sourceChildren.length !== targetChildren.length) return false
  return sourceChildren.every((child, index) => hydrateNode(child, targetChildren[index], context))
}

function activateHydratedTree(node: Node, context: DomRenderContext): void {
  if (node.nodeType !== 1) return
  activateHydratedProps(node as Element, node as HTMLElement, context)
  node.childNodes.forEach(child => activateHydratedTree(child, context))
}
export { activateHydratedTree }
