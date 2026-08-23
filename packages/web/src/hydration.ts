import { type DomRenderContext } from "./shared.js"
import { rememberDomProps, setDomEvent } from "./props.js"

function synchronizeAttributes(source: Element, target: Element): void {
  const sourceAttributes = new Map([...source.attributes].map(attribute => [
    `${attribute.namespaceURI ?? ""}|${attribute.localName}`,
    attribute,
  ]))
  for (const attribute of [...target.attributes]) {
    const key = `${attribute.namespaceURI ?? ""}|${attribute.localName}`
    if (sourceAttributes.has(key)) continue
    if (attribute.namespaceURI) target.removeAttributeNS(attribute.namespaceURI, attribute.localName)
    else target.removeAttribute(attribute.name)
  }
  for (const attribute of sourceAttributes.values()) {
    if (attribute.namespaceURI) target.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
    else target.setAttribute(attribute.name, attribute.value)
  }
}

function activateHydratedProps(source: Element, target: Element, context: DomRenderContext): void {
  const props = context.hydrationProps.get(source)
  synchronizeAttributes(source, target)
  rememberDomProps(target, props, context, false)
  const tag = context.domTags.get(source)
  if (tag) context.domTags.set(target, tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === "children" || key === "key" || key === "ref" || value === undefined || value === null) continue
    if (typeof value === "function" && /^on[A-Za-z]/.test(key)) {
      setDomEvent(target, key, value, context)
      continue
    }
    if (key === "value" || key === "checked" || key === "selected" || key === "disabled" || key === "multiple" || key === "muted") {
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
  const targetElement = target as Element
  if (sourceElement.namespaceURI !== targetElement.namespaceURI || sourceElement.tagName !== targetElement.tagName) return false
  const sourceChildren = [...source.childNodes]
  const targetChildren = [...target.childNodes]
  if (sourceChildren.length !== targetChildren.length) return false
  activateHydratedProps(sourceElement, targetElement, context)
  const key = context.domKeys.get(sourceElement)
  if (key !== undefined) context.domKeys.set(targetElement, key)
  const lazyKey = context.lazyKeys.get(sourceElement)
  if (lazyKey) context.lazyKeys.set(targetElement, lazyKey)
  return sourceChildren.every((child, index) => hydrateNode(child, targetChildren[index], context))
}

function activateHydratedTree(node: Node, context: DomRenderContext): void {
  if (node.nodeType !== 1) return
  activateHydratedProps(node as Element, node as Element, context)
  node.childNodes.forEach(child => activateHydratedTree(child, context))
}
export { activateHydratedTree }
