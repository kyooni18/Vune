export type VuneHtmlTagName =
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

export interface VuneEventTarget<Tag extends string = string> {
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

export interface VuneDOMEvent<Tag extends string = string> {
  readonly target?: VuneEventTarget<Tag>
  readonly currentTarget?: VuneEventTarget<Tag>
  readonly defaultPrevented?: boolean
  preventDefault?(): void
  stopPropagation?(): void
}

export type VuneEventHandler<Tag extends string = string> = (event: VuneDOMEvent<Tag>) => unknown

/** CSS values accepted by the renderer-neutral inline style modifier. */
type VuneStylePropertyValue = string | number | undefined

/**
 * Renderer-neutral CSS properties.
 *
 * Named properties catch misspellings while the template-literal index
 * signature keeps CSS custom properties (`--app-accent`) extensible. External
 * stylesheets and CSS processors remain ordinary host build-tool inputs.
 */
export interface VuneStyleProperties {
  readonly [property: `--${string}`]: VuneStylePropertyValue
  readonly accentColor?: VuneStylePropertyValue
  readonly alignContent?: VuneStylePropertyValue
  readonly alignItems?: VuneStylePropertyValue
  readonly alignSelf?: VuneStylePropertyValue
  readonly appearance?: VuneStylePropertyValue
  readonly aspectRatio?: VuneStylePropertyValue
  readonly background?: VuneStylePropertyValue
  readonly backgroundColor?: VuneStylePropertyValue
  readonly backgroundImage?: VuneStylePropertyValue
  readonly backgroundPosition?: VuneStylePropertyValue
  readonly backgroundRepeat?: VuneStylePropertyValue
  readonly backgroundSize?: VuneStylePropertyValue
  readonly blockSize?: VuneStylePropertyValue
  readonly border?: VuneStylePropertyValue
  readonly borderBottom?: VuneStylePropertyValue
  readonly borderColor?: VuneStylePropertyValue
  readonly borderLeft?: VuneStylePropertyValue
  readonly borderRadius?: VuneStylePropertyValue
  readonly cornerShape?: VuneStylePropertyValue
  readonly borderRight?: VuneStylePropertyValue
  readonly borderStyle?: VuneStylePropertyValue
  readonly borderTop?: VuneStylePropertyValue
  readonly borderWidth?: VuneStylePropertyValue
  readonly bottom?: VuneStylePropertyValue
  readonly boxShadow?: VuneStylePropertyValue
  readonly boxSizing?: VuneStylePropertyValue
  readonly color?: VuneStylePropertyValue
  readonly columnGap?: VuneStylePropertyValue
  readonly columns?: VuneStylePropertyValue
  readonly content?: VuneStylePropertyValue
  readonly cursor?: VuneStylePropertyValue
  readonly display?: VuneStylePropertyValue
  readonly flex?: VuneStylePropertyValue
  readonly flexBasis?: VuneStylePropertyValue
  readonly flexDirection?: VuneStylePropertyValue
  readonly flexGrow?: VuneStylePropertyValue
  readonly flexShrink?: VuneStylePropertyValue
  readonly flexWrap?: VuneStylePropertyValue
  readonly float?: VuneStylePropertyValue
  readonly font?: VuneStylePropertyValue
  readonly fontFamily?: VuneStylePropertyValue
  readonly fontSize?: VuneStylePropertyValue
  readonly fontStyle?: VuneStylePropertyValue
  readonly fontWeight?: VuneStylePropertyValue
  readonly gap?: VuneStylePropertyValue
  readonly gridArea?: VuneStylePropertyValue
  readonly gridAutoColumns?: VuneStylePropertyValue
  readonly gridAutoFlow?: VuneStylePropertyValue
  readonly gridAutoRows?: VuneStylePropertyValue
  readonly gridColumn?: VuneStylePropertyValue
  readonly gridRow?: VuneStylePropertyValue
  readonly gridTemplateColumns?: VuneStylePropertyValue
  readonly gridTemplateRows?: VuneStylePropertyValue
  readonly height?: VuneStylePropertyValue
  readonly inset?: VuneStylePropertyValue
  readonly insetBlock?: VuneStylePropertyValue
  readonly insetInline?: VuneStylePropertyValue
  readonly justifyContent?: VuneStylePropertyValue
  readonly justifyItems?: VuneStylePropertyValue
  readonly justifySelf?: VuneStylePropertyValue
  readonly left?: VuneStylePropertyValue
  readonly letterSpacing?: VuneStylePropertyValue
  readonly lineHeight?: VuneStylePropertyValue
  readonly listStyle?: VuneStylePropertyValue
  readonly margin?: VuneStylePropertyValue
  readonly marginBlock?: VuneStylePropertyValue
  readonly marginInline?: VuneStylePropertyValue
  readonly marginBottom?: VuneStylePropertyValue
  readonly marginLeft?: VuneStylePropertyValue
  readonly marginRight?: VuneStylePropertyValue
  readonly marginTop?: VuneStylePropertyValue
  readonly mask?: VuneStylePropertyValue
  readonly maskImage?: VuneStylePropertyValue
  readonly maskSize?: VuneStylePropertyValue
  readonly maxHeight?: VuneStylePropertyValue
  readonly maxWidth?: VuneStylePropertyValue
  readonly minHeight?: VuneStylePropertyValue
  readonly minWidth?: VuneStylePropertyValue
  readonly objectFit?: VuneStylePropertyValue
  readonly opacity?: VuneStylePropertyValue
  readonly order?: VuneStylePropertyValue
  readonly outline?: VuneStylePropertyValue
  readonly overflow?: VuneStylePropertyValue
  readonly overflowX?: VuneStylePropertyValue
  readonly overflowY?: VuneStylePropertyValue
  readonly overscrollBehavior?: VuneStylePropertyValue
  readonly padding?: VuneStylePropertyValue
  readonly paddingBlock?: VuneStylePropertyValue
  readonly paddingInline?: VuneStylePropertyValue
  readonly paddingBottom?: VuneStylePropertyValue
  readonly paddingLeft?: VuneStylePropertyValue
  readonly paddingRight?: VuneStylePropertyValue
  readonly paddingTop?: VuneStylePropertyValue
  readonly placeContent?: VuneStylePropertyValue
  readonly placeItems?: VuneStylePropertyValue
  readonly placeSelf?: VuneStylePropertyValue
  readonly pointerEvents?: VuneStylePropertyValue
  readonly position?: VuneStylePropertyValue
  readonly right?: VuneStylePropertyValue
  readonly rowGap?: VuneStylePropertyValue
  readonly scrollBehavior?: VuneStylePropertyValue
  readonly textAlign?: VuneStylePropertyValue
  readonly textDecoration?: VuneStylePropertyValue
  readonly textOverflow?: VuneStylePropertyValue
  readonly textTransform?: VuneStylePropertyValue
  readonly top?: VuneStylePropertyValue
  readonly transform?: VuneStylePropertyValue
  readonly transformOrigin?: VuneStylePropertyValue
  readonly userSelect?: VuneStylePropertyValue
  readonly verticalAlign?: VuneStylePropertyValue
  readonly visibility?: VuneStylePropertyValue
  readonly WebkitMask?: VuneStylePropertyValue
  readonly WebkitMaskImage?: VuneStylePropertyValue
  readonly WebkitMaskSize?: VuneStylePropertyValue
  readonly whiteSpace?: VuneStylePropertyValue
  readonly width?: VuneStylePropertyValue
  readonly wordBreak?: VuneStylePropertyValue
  readonly zIndex?: VuneStylePropertyValue
  readonly WebkitOverflowScrolling?: VuneStylePropertyValue
  readonly WebkitTapHighlightColor?: VuneStylePropertyValue
}
export type VuneStyleValue = string | VuneStyleProperties

type AriaAttributes = { readonly [Name in `aria-${string}`]?: string | number | boolean }
type DataAttributes = { readonly [Name in `data-${string}`]?: string | number | boolean }

export interface VuneGlobalHtmlAttributes {
  readonly id?: string
  readonly class?: string
  readonly className?: string
  readonly style?: VuneStyleValue
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

export type VuneHtmlEventAttributes<Tag extends string> = {
  readonly onclick?: VuneEventHandler<Tag>
  readonly onClick?: VuneEventHandler<Tag>
  readonly onchange?: VuneEventHandler<Tag>
  readonly onChange?: VuneEventHandler<Tag>
  readonly oninput?: VuneEventHandler<Tag>
  readonly onInput?: VuneEventHandler<Tag>
  readonly onsubmit?: VuneEventHandler<Tag>
  readonly onSubmit?: VuneEventHandler<Tag>
  readonly onkeydown?: VuneEventHandler<Tag>
  readonly onKeyDown?: VuneEventHandler<Tag>
  readonly onkeyup?: VuneEventHandler<Tag>
  readonly onKeyUp?: VuneEventHandler<Tag>
  readonly onfocus?: VuneEventHandler<Tag>
  readonly onFocus?: VuneEventHandler<Tag>
  readonly onblur?: VuneEventHandler<Tag>
  readonly onBlur?: VuneEventHandler<Tag>
  readonly onpointerdown?: VuneEventHandler<Tag>
  readonly onPointerDown?: VuneEventHandler<Tag>
  readonly onpointermove?: VuneEventHandler<Tag>
  readonly onPointerMove?: VuneEventHandler<Tag>
  readonly onpointerup?: VuneEventHandler<Tag>
  readonly onPointerUp?: VuneEventHandler<Tag>
  readonly onpointerenter?: VuneEventHandler<Tag>
  readonly onPointerEnter?: VuneEventHandler<Tag>
  readonly onpointerleave?: VuneEventHandler<Tag>
  readonly onPointerLeave?: VuneEventHandler<Tag>
  readonly onmouseenter?: VuneEventHandler<Tag>
  readonly onMouseEnter?: VuneEventHandler<Tag>
  readonly onmouseleave?: VuneEventHandler<Tag>
  readonly onMouseLeave?: VuneEventHandler<Tag>
  readonly onmousemove?: VuneEventHandler<Tag>
  readonly onMouseMove?: VuneEventHandler<Tag>
  readonly onmouseover?: VuneEventHandler<Tag>
  readonly onMouseOver?: VuneEventHandler<Tag>
  readonly oncontextmenu?: VuneEventHandler<Tag>
  readonly onContextMenu?: VuneEventHandler<Tag>
  readonly ondblclick?: VuneEventHandler<Tag>
  readonly onDoubleClick?: VuneEventHandler<Tag>
  readonly onwheel?: VuneEventHandler<Tag>
  readonly onWheel?: VuneEventHandler<Tag>
  readonly onscroll?: VuneEventHandler<Tag>
  readonly onScroll?: VuneEventHandler<Tag>
  readonly onfocusin?: VuneEventHandler<Tag>
  readonly onFocusIn?: VuneEventHandler<Tag>
  readonly onfocusout?: VuneEventHandler<Tag>
  readonly onFocusOut?: VuneEventHandler<Tag>
  readonly oncompositionstart?: VuneEventHandler<Tag>
  readonly onCompositionStart?: VuneEventHandler<Tag>
  readonly oncompositionend?: VuneEventHandler<Tag>
  readonly onCompositionEnd?: VuneEventHandler<Tag>
  readonly ondragstart?: VuneEventHandler<Tag>
  readonly onDragStart?: VuneEventHandler<Tag>
  readonly ondragover?: VuneEventHandler<Tag>
  readonly onDragOver?: VuneEventHandler<Tag>
  readonly ondrop?: VuneEventHandler<Tag>
  readonly onDrop?: VuneEventHandler<Tag>
  readonly oncopy?: VuneEventHandler<Tag>
  readonly onCopy?: VuneEventHandler<Tag>
  readonly oncut?: VuneEventHandler<Tag>
  readonly onCut?: VuneEventHandler<Tag>
  readonly onpaste?: VuneEventHandler<Tag>
  readonly onPaste?: VuneEventHandler<Tag>
  readonly ontouchstart?: VuneEventHandler<Tag>
  readonly onTouchStart?: VuneEventHandler<Tag>
  readonly ontouchmove?: VuneEventHandler<Tag>
  readonly onTouchMove?: VuneEventHandler<Tag>
  readonly ontouchend?: VuneEventHandler<Tag>
  readonly onTouchEnd?: VuneEventHandler<Tag>
  readonly onload?: VuneEventHandler<Tag>
  readonly onLoad?: VuneEventHandler<Tag>
  readonly onerror?: VuneEventHandler<Tag>
  readonly onError?: VuneEventHandler<Tag>
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

type TagAttributes<Tag extends VuneHtmlTagName> =
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

export type VuneHtmlAttributes<Tag extends VuneHtmlTagName> =
  VuneGlobalHtmlAttributes & AriaAttributes & DataAttributes & VuneHtmlEventAttributes<Tag> & TagAttributes<Tag>

export type VuneCustomElementAttributes<Tag extends `${string}-${string}` = `${string}-${string}`> =
  VuneGlobalHtmlAttributes & AriaAttributes & DataAttributes & VuneHtmlEventAttributes<Tag> & Readonly<Record<string, unknown>>
