export type MuseHtmlTagName =
  | "a" | "abbr" | "address" | "area" | "article" | "aside" | "audio"
  | "b" | "base" | "bdi" | "bdo" | "blockquote" | "body" | "br" | "button"
  | "canvas" | "caption" | "cite" | "code" | "col" | "colgroup"
  | "data" | "datalist" | "dd" | "del" | "details" | "dfn" | "dialog" | "div" | "dl" | "dt"
  | "em" | "embed" | "fieldset" | "figcaption" | "figure" | "footer" | "form"
  | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "head" | "header" | "hgroup" | "hr" | "html"
  | "i" | "iframe" | "img" | "input" | "ins" | "kbd" | "label" | "legend" | "li" | "link"
  | "main" | "map" | "mark" | "menu" | "meta" | "meter" | "nav" | "noscript" | "object" | "ol" | "optgroup" | "option" | "output"
  | "p" | "picture" | "pre" | "progress" | "q" | "rp" | "rt" | "ruby" | "s" | "samp" | "script" | "search" | "section" | "select" | "slot" | "small" | "source" | "span" | "strong" | "style" | "sub" | "summary" | "sup"
  | "table" | "tbody" | "td" | "template" | "textarea" | "tfoot" | "th" | "thead" | "time" | "title" | "tr" | "track" | "u" | "ul" | "var" | "video" | "wbr"

export interface MuseEventTarget<Tag extends string = string> {
  readonly tagName?: Uppercase<Tag>
  readonly value?: string
  readonly checked?: boolean
  readonly files?: unknown
  readonly key?: string
  readonly code?: string
  readonly clientX?: number
  readonly clientY?: number
  readonly button?: number
}

export interface MuseDOMEvent<Tag extends string = string> {
  readonly target?: MuseEventTarget<Tag>
  readonly currentTarget?: MuseEventTarget<Tag>
  readonly defaultPrevented?: boolean
  preventDefault?(): void
  stopPropagation?(): void
}

export type MuseEventHandler<Tag extends string = string> = (event: MuseDOMEvent<Tag>) => unknown

/** CSS values accepted by the renderer-neutral inline style modifier. */
type MuseStylePropertyValue = string | number | undefined

/**
 * Renderer-neutral CSS properties.
 *
 * Named properties catch misspellings while the template-literal index
 * signature keeps CSS custom properties (`--app-accent`) extensible. External
 * stylesheets and CSS processors remain ordinary host build-tool inputs.
 */
export interface MuseStyleProperties {
  readonly [property: `--${string}`]: MuseStylePropertyValue
  readonly accentColor?: MuseStylePropertyValue
  readonly alignContent?: MuseStylePropertyValue
  readonly alignItems?: MuseStylePropertyValue
  readonly alignSelf?: MuseStylePropertyValue
  readonly appearance?: MuseStylePropertyValue
  readonly aspectRatio?: MuseStylePropertyValue
  readonly background?: MuseStylePropertyValue
  readonly backgroundColor?: MuseStylePropertyValue
  readonly backgroundImage?: MuseStylePropertyValue
  readonly backgroundPosition?: MuseStylePropertyValue
  readonly backgroundRepeat?: MuseStylePropertyValue
  readonly backgroundSize?: MuseStylePropertyValue
  readonly blockSize?: MuseStylePropertyValue
  readonly border?: MuseStylePropertyValue
  readonly borderBottom?: MuseStylePropertyValue
  readonly borderColor?: MuseStylePropertyValue
  readonly borderLeft?: MuseStylePropertyValue
  readonly borderRadius?: MuseStylePropertyValue
  readonly borderRight?: MuseStylePropertyValue
  readonly borderStyle?: MuseStylePropertyValue
  readonly borderTop?: MuseStylePropertyValue
  readonly borderWidth?: MuseStylePropertyValue
  readonly bottom?: MuseStylePropertyValue
  readonly boxShadow?: MuseStylePropertyValue
  readonly boxSizing?: MuseStylePropertyValue
  readonly color?: MuseStylePropertyValue
  readonly columnGap?: MuseStylePropertyValue
  readonly columns?: MuseStylePropertyValue
  readonly content?: MuseStylePropertyValue
  readonly cursor?: MuseStylePropertyValue
  readonly display?: MuseStylePropertyValue
  readonly flex?: MuseStylePropertyValue
  readonly flexBasis?: MuseStylePropertyValue
  readonly flexDirection?: MuseStylePropertyValue
  readonly flexGrow?: MuseStylePropertyValue
  readonly flexShrink?: MuseStylePropertyValue
  readonly flexWrap?: MuseStylePropertyValue
  readonly float?: MuseStylePropertyValue
  readonly font?: MuseStylePropertyValue
  readonly fontFamily?: MuseStylePropertyValue
  readonly fontSize?: MuseStylePropertyValue
  readonly fontStyle?: MuseStylePropertyValue
  readonly fontWeight?: MuseStylePropertyValue
  readonly gap?: MuseStylePropertyValue
  readonly gridArea?: MuseStylePropertyValue
  readonly gridAutoColumns?: MuseStylePropertyValue
  readonly gridAutoFlow?: MuseStylePropertyValue
  readonly gridAutoRows?: MuseStylePropertyValue
  readonly gridColumn?: MuseStylePropertyValue
  readonly gridRow?: MuseStylePropertyValue
  readonly gridTemplateColumns?: MuseStylePropertyValue
  readonly gridTemplateRows?: MuseStylePropertyValue
  readonly height?: MuseStylePropertyValue
  readonly inset?: MuseStylePropertyValue
  readonly insetBlock?: MuseStylePropertyValue
  readonly insetInline?: MuseStylePropertyValue
  readonly justifyContent?: MuseStylePropertyValue
  readonly justifyItems?: MuseStylePropertyValue
  readonly justifySelf?: MuseStylePropertyValue
  readonly left?: MuseStylePropertyValue
  readonly letterSpacing?: MuseStylePropertyValue
  readonly lineHeight?: MuseStylePropertyValue
  readonly listStyle?: MuseStylePropertyValue
  readonly margin?: MuseStylePropertyValue
  readonly marginBlock?: MuseStylePropertyValue
  readonly marginInline?: MuseStylePropertyValue
  readonly marginBottom?: MuseStylePropertyValue
  readonly marginLeft?: MuseStylePropertyValue
  readonly marginRight?: MuseStylePropertyValue
  readonly marginTop?: MuseStylePropertyValue
  readonly maxHeight?: MuseStylePropertyValue
  readonly maxWidth?: MuseStylePropertyValue
  readonly minHeight?: MuseStylePropertyValue
  readonly minWidth?: MuseStylePropertyValue
  readonly objectFit?: MuseStylePropertyValue
  readonly opacity?: MuseStylePropertyValue
  readonly order?: MuseStylePropertyValue
  readonly outline?: MuseStylePropertyValue
  readonly overflow?: MuseStylePropertyValue
  readonly overflowX?: MuseStylePropertyValue
  readonly overflowY?: MuseStylePropertyValue
  readonly overscrollBehavior?: MuseStylePropertyValue
  readonly padding?: MuseStylePropertyValue
  readonly paddingBlock?: MuseStylePropertyValue
  readonly paddingInline?: MuseStylePropertyValue
  readonly paddingBottom?: MuseStylePropertyValue
  readonly paddingLeft?: MuseStylePropertyValue
  readonly paddingRight?: MuseStylePropertyValue
  readonly paddingTop?: MuseStylePropertyValue
  readonly placeContent?: MuseStylePropertyValue
  readonly placeItems?: MuseStylePropertyValue
  readonly placeSelf?: MuseStylePropertyValue
  readonly pointerEvents?: MuseStylePropertyValue
  readonly position?: MuseStylePropertyValue
  readonly right?: MuseStylePropertyValue
  readonly rowGap?: MuseStylePropertyValue
  readonly scrollBehavior?: MuseStylePropertyValue
  readonly textAlign?: MuseStylePropertyValue
  readonly textDecoration?: MuseStylePropertyValue
  readonly textOverflow?: MuseStylePropertyValue
  readonly textTransform?: MuseStylePropertyValue
  readonly top?: MuseStylePropertyValue
  readonly transform?: MuseStylePropertyValue
  readonly transformOrigin?: MuseStylePropertyValue
  readonly userSelect?: MuseStylePropertyValue
  readonly verticalAlign?: MuseStylePropertyValue
  readonly visibility?: MuseStylePropertyValue
  readonly whiteSpace?: MuseStylePropertyValue
  readonly width?: MuseStylePropertyValue
  readonly wordBreak?: MuseStylePropertyValue
  readonly zIndex?: MuseStylePropertyValue
  readonly WebkitOverflowScrolling?: MuseStylePropertyValue
  readonly WebkitTapHighlightColor?: MuseStylePropertyValue
}
export type MuseStyleValue = string | MuseStyleProperties

type AriaAttributes = { readonly [Name in `aria-${string}`]?: string | number | boolean }
type DataAttributes = { readonly [Name in `data-${string}`]?: string | number | boolean }

export interface MuseGlobalHtmlAttributes {
  readonly id?: string
  readonly class?: string
  readonly className?: string
  readonly style?: MuseStyleValue
  readonly title?: string
  readonly role?: string
  readonly hidden?: boolean
  readonly lang?: string
  readonly dir?: "ltr" | "rtl" | "auto"
  readonly tabindex?: number
  readonly tabIndex?: number
  readonly draggable?: boolean
  readonly spellcheck?: boolean
  readonly contenteditable?: boolean | "plaintext-only"
  readonly slot?: string
  readonly part?: string
  readonly ref?: unknown
}

export type MuseHtmlEventAttributes<Tag extends string> = {
  readonly onclick?: MuseEventHandler<Tag>
  readonly onClick?: MuseEventHandler<Tag>
  readonly onchange?: MuseEventHandler<Tag>
  readonly onChange?: MuseEventHandler<Tag>
  readonly oninput?: MuseEventHandler<Tag>
  readonly onInput?: MuseEventHandler<Tag>
  readonly onsubmit?: MuseEventHandler<Tag>
  readonly onSubmit?: MuseEventHandler<Tag>
  readonly onkeydown?: MuseEventHandler<Tag>
  readonly onKeyDown?: MuseEventHandler<Tag>
  readonly onkeyup?: MuseEventHandler<Tag>
  readonly onKeyUp?: MuseEventHandler<Tag>
  readonly onfocus?: MuseEventHandler<Tag>
  readonly onFocus?: MuseEventHandler<Tag>
  readonly onblur?: MuseEventHandler<Tag>
  readonly onBlur?: MuseEventHandler<Tag>
  readonly onpointerdown?: MuseEventHandler<Tag>
  readonly onPointerDown?: MuseEventHandler<Tag>
  readonly onpointermove?: MuseEventHandler<Tag>
  readonly onPointerMove?: MuseEventHandler<Tag>
  readonly onpointerup?: MuseEventHandler<Tag>
  readonly onPointerUp?: MuseEventHandler<Tag>
  readonly onpointerenter?: MuseEventHandler<Tag>
  readonly onPointerEnter?: MuseEventHandler<Tag>
  readonly onpointerleave?: MuseEventHandler<Tag>
  readonly onPointerLeave?: MuseEventHandler<Tag>
  readonly onmouseenter?: MuseEventHandler<Tag>
  readonly onMouseEnter?: MuseEventHandler<Tag>
  readonly onmouseleave?: MuseEventHandler<Tag>
  readonly onMouseLeave?: MuseEventHandler<Tag>
  readonly onmousemove?: MuseEventHandler<Tag>
  readonly onMouseMove?: MuseEventHandler<Tag>
  readonly onmouseover?: MuseEventHandler<Tag>
  readonly onMouseOver?: MuseEventHandler<Tag>
  readonly oncontextmenu?: MuseEventHandler<Tag>
  readonly onContextMenu?: MuseEventHandler<Tag>
  readonly ondblclick?: MuseEventHandler<Tag>
  readonly onDoubleClick?: MuseEventHandler<Tag>
  readonly onwheel?: MuseEventHandler<Tag>
  readonly onWheel?: MuseEventHandler<Tag>
  readonly onscroll?: MuseEventHandler<Tag>
  readonly onScroll?: MuseEventHandler<Tag>
  readonly onfocusin?: MuseEventHandler<Tag>
  readonly onFocusIn?: MuseEventHandler<Tag>
  readonly onfocusout?: MuseEventHandler<Tag>
  readonly onFocusOut?: MuseEventHandler<Tag>
  readonly oncompositionstart?: MuseEventHandler<Tag>
  readonly onCompositionStart?: MuseEventHandler<Tag>
  readonly oncompositionend?: MuseEventHandler<Tag>
  readonly onCompositionEnd?: MuseEventHandler<Tag>
  readonly ondragstart?: MuseEventHandler<Tag>
  readonly onDragStart?: MuseEventHandler<Tag>
  readonly ondragover?: MuseEventHandler<Tag>
  readonly onDragOver?: MuseEventHandler<Tag>
  readonly ondrop?: MuseEventHandler<Tag>
  readonly onDrop?: MuseEventHandler<Tag>
  readonly oncopy?: MuseEventHandler<Tag>
  readonly onCopy?: MuseEventHandler<Tag>
  readonly oncut?: MuseEventHandler<Tag>
  readonly onCut?: MuseEventHandler<Tag>
  readonly onpaste?: MuseEventHandler<Tag>
  readonly onPaste?: MuseEventHandler<Tag>
  readonly ontouchstart?: MuseEventHandler<Tag>
  readonly onTouchStart?: MuseEventHandler<Tag>
  readonly ontouchmove?: MuseEventHandler<Tag>
  readonly onTouchMove?: MuseEventHandler<Tag>
  readonly ontouchend?: MuseEventHandler<Tag>
  readonly onTouchEnd?: MuseEventHandler<Tag>
  readonly onload?: MuseEventHandler<Tag>
  readonly onLoad?: MuseEventHandler<Tag>
  readonly onerror?: MuseEventHandler<Tag>
  readonly onError?: MuseEventHandler<Tag>
}

type AnchorAttributes = { readonly href?: string; readonly target?: "_self" | "_blank" | "_parent" | "_top" | string; readonly rel?: string; readonly download?: string | boolean; readonly hreflang?: string }
type ButtonAttributes = { readonly type?: "button" | "submit" | "reset"; readonly disabled?: boolean; readonly name?: string; readonly value?: string | number; readonly autofocus?: boolean; readonly form?: string }
type FormAttributes = { readonly action?: string; readonly method?: "get" | "post" | "dialog"; readonly enctype?: string; readonly target?: string; readonly novalidate?: boolean; readonly autocomplete?: "on" | "off" }
type ImageAttributes = { readonly src: string; readonly alt: string; readonly width?: number | string; readonly height?: number | string; readonly loading?: "eager" | "lazy"; readonly decoding?: "sync" | "async" | "auto" }
type InputAttributes = { readonly type?: string; readonly value?: string | number; readonly checked?: boolean; readonly disabled?: boolean; readonly readonly?: boolean; readonly required?: boolean; readonly multiple?: boolean; readonly name?: string; readonly placeholder?: string; readonly min?: string | number; readonly max?: string | number; readonly step?: string | number; readonly accept?: string; readonly autocomplete?: string }
type LabelAttributes = { readonly for?: string; readonly htmlFor?: string }
type OptionAttributes = { readonly value?: string | number; readonly selected?: boolean; readonly disabled?: boolean; readonly label?: string }
type SelectAttributes = { readonly value?: string | number; readonly disabled?: boolean; readonly required?: boolean; readonly multiple?: boolean; readonly name?: string }
type TextAreaAttributes = { readonly value?: string; readonly disabled?: boolean; readonly readonly?: boolean; readonly required?: boolean; readonly name?: string; readonly placeholder?: string; readonly rows?: number; readonly cols?: number; readonly maxlength?: number }
type MediaAttributes = { readonly src?: string; readonly controls?: boolean; readonly autoplay?: boolean; readonly loop?: boolean; readonly muted?: boolean; readonly preload?: "none" | "metadata" | "auto" }
type ProgressAttributes = { readonly value?: number; readonly max?: number }
type TableCellAttributes = { readonly colspan?: number; readonly rowspan?: number; readonly headers?: string; readonly scope?: "row" | "col" | "rowgroup" | "colgroup" }

type TagAttributes<Tag extends MuseHtmlTagName> =
  Tag extends "a" ? AnchorAttributes
  : Tag extends "button" ? ButtonAttributes
  : Tag extends "form" ? FormAttributes
  : Tag extends "img" ? ImageAttributes
  : Tag extends "input" ? InputAttributes
  : Tag extends "label" ? LabelAttributes
  : Tag extends "option" ? OptionAttributes
  : Tag extends "select" ? SelectAttributes
  : Tag extends "textarea" ? TextAreaAttributes
  : Tag extends "audio" | "video" ? MediaAttributes
  : Tag extends "progress" | "meter" ? ProgressAttributes
  : Tag extends "td" | "th" ? TableCellAttributes
  : Record<never, never>

export type MuseHtmlAttributes<Tag extends MuseHtmlTagName> =
  MuseGlobalHtmlAttributes & AriaAttributes & DataAttributes & MuseHtmlEventAttributes<Tag> & TagAttributes<Tag>

export type MuseCustomElementAttributes<Tag extends `${string}-${string}` = `${string}-${string}`> =
  MuseGlobalHtmlAttributes & AriaAttributes & DataAttributes & MuseHtmlEventAttributes<Tag> & Readonly<Record<string, unknown>>
