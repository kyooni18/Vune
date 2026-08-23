import { isForeignComponent, renderViewNode, zeroGeometry, type MuseRenderer, type ViewGraphValue, type ViewHostNode } from "@muse/core"
import { classNameOf, escape, escapeAttribute, htmlAttributeName, isBooleanHtmlAttribute, isEnumeratedBooleanAttribute, propsOf, styleAttribute, styleOf, styleText, voidHtmlElements } from "./shared.js"


function serializedAttribute(key: string, value: unknown): string | undefined {
  if (key === "children" || key === "key" || key === "ref" || value === undefined || value === null || typeof value === "function") return undefined
  const name = htmlAttributeName(key)
  const serialized = key === "style" ? styleAttribute(value) : key === "className" || key === "class" ? classNameOf(value) : String(value)
  if (serialized === undefined) return undefined
  if (isBooleanHtmlAttribute(name)) return value ? name : undefined
  if (value === false || value === true) {
    if (name.startsWith("aria-") || name.startsWith("data-") || isEnumeratedBooleanAttribute(name)) {
      return `${name}="${String(value)}"`
    }
    return value ? name : `${name}="false"`
  }
  return `${name}="${escapeAttribute(serialized)}"`
}

const htmlRenderer: MuseRenderer<string> = {
  element(type, props, ...children) {
    const foreign = isForeignComponent(type) ? type : undefined
    const tag = typeof type === "string" ? type : "div"
    const effectiveProps = foreign
      ? { ...foreign.props, ...foreign.events, ...(foreign.ref === undefined ? {} : { ref: foreign.ref }), ...(props ?? {}), "data-muse-foreign": foreign.name }
      : props
    const attributes = Object.entries(effectiveProps ?? {})
      .map(([key, value]) => serializedAttribute(key, value))
      .filter((value): value is string => Boolean(value))
      .join(" ")
    const opening = `<${tag}${attributes ? ` ${attributes}` : ""}>`
    return voidHtmlElements.has(tag.toLowerCase()) ? opening : `${opening}${children.join("")}</${tag}>`
  },
  fragment(children) { return children.join("") },
  value(value) { return value === null || value === undefined || value === false ? "" : escape(value) },
  modifier(content, modifier) {
    if (modifier.name === "frame") {
      const style = styleText(styleOf(modifier))
      return `<div${style ? ` style="${escapeAttribute(style)}"` : ""}>${content}</div>`
    }
    const extraStyle = styleText(styleOf(modifier))
    const extraProps = propsOf(modifier)
    const propStyle = styleAttribute(extraProps.style)
    const propClass = classNameOf(extraProps.className ?? extraProps.class)
    if (!extraStyle && !propStyle && !propClass && Object.keys(extraProps).length === 0) return content
    return content.replace(/^(<[^ >]+)([^>]*)(>)/, (_match, start: string, attributes: string, end: string) => {
      let nextAttributes = attributes
      const styleMatch = /\sstyle="([^"]*)"/.exec(attributes)
      const extraStyles = [extraStyle, propStyle].filter(Boolean).join(";")
      if (styleMatch && extraStyles) {
        const merged = `${styleMatch[1]};${extraStyles}`
        nextAttributes = nextAttributes.replace(styleMatch[0], ` style="${merged}"`)
      } else if (extraStyles) {
        nextAttributes += ` style="${extraStyles}"`
      }
      if (propClass) {
        const classMatch = /\sclass="([^"]*)"/.exec(nextAttributes)
        const merged = [classMatch?.[1], propClass].filter(Boolean).join(" ")
        if (classMatch) nextAttributes = nextAttributes.replace(classMatch[0], ` class="${escapeAttribute(merged)}"`)
        else nextAttributes += ` class="${escapeAttribute(propClass)}"`
      }
      for (const [key, value] of Object.entries(extraProps)) {
        const name = htmlAttributeName(key)
        if (name === "class" || name === "style" || name === "key" || name === "ref" || name === "children") continue
        const attribute = serializedAttribute(key, value)
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const pattern = new RegExp(`\\s${escapedName}(?:="[^"]*")?`)
        if (!attribute) nextAttributes = nextAttributes.replace(pattern, "")
        else nextAttributes = pattern.test(nextAttributes)
          ? nextAttributes.replace(pattern, ` ${attribute}`)
          : `${nextAttributes} ${attribute}`
      }
      return `${start}${nextAttributes}${end}`
    })
  },
  view(node: ViewHostNode, render) {
    const state = node.state?.(node.props) ?? {}
    return render({ ...node.props, ...state })
  },
  geometry(_node, render) {
    return `<div data-muse="GeometryReader">${render(zeroGeometry)}</div>`
  },
}
export function renderToHTML(value: ViewGraphValue): string {
  return renderViewNode(value, htmlRenderer)
}
