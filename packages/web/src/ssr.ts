import { isForeignComponent, renderViewNode, zeroGeometry, type MuseRenderer, type ViewGraphValue, type ViewHostNode } from "@muse/core"
import { classNameOf, escape, escapeAttribute, propsOf, styleAttribute, styleOf, styleText, voidHtmlElements } from "./shared.js"

const htmlRenderer: MuseRenderer<string> = {
  element(type, props, ...children) {
    const foreign = isForeignComponent(type) ? type : undefined
    const tag = typeof type === "string" ? type : "div"
    const effectiveProps = foreign
      ? { ...foreign.props, ...foreign.events, ...(foreign.ref === undefined ? {} : { ref: foreign.ref }), ...(props ?? {}), "data-muse-foreign": foreign.name }
      : props
    const attributes = Object.entries(effectiveProps ?? {})
      .filter(([key, value]) => value !== undefined && value !== null && value !== false && typeof value !== "function" && key !== "children")
      .map(([key, value]) => {
        const name = key === "className" ? "class" : key === "htmlFor" ? "for" : key
        if (value === true) return name
        const serialized = key === "style" ? styleAttribute(value) : String(value)
        return serialized === undefined ? "" : `${name}="${escapeAttribute(serialized)}"`
      })
      .filter(Boolean)
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
        if (value === undefined || value === null || value === false || typeof value === "function") continue
        const name = key === "className" ? "class" : key === "htmlFor" ? "for" : key
        if (name === "class" || name === "style") continue
        const serialized = name === "style" ? styleAttribute(value) : String(value)
        const escaped = value === true ? "" : serialized === undefined ? "" : `="${escapeAttribute(serialized)}"`
        const pattern = new RegExp(`\\s${name}="[^"]*"`)
        nextAttributes = pattern.test(nextAttributes)
          ? nextAttributes.replace(pattern, escaped ? ` ${name}${escaped}` : ` ${name}`)
          : `${nextAttributes} ${name}${escaped}`
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
