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
}

export interface MuseDOMEvent<Tag extends string = string> {
  readonly target?: MuseEventTarget<Tag>
  readonly currentTarget?: MuseEventTarget<Tag>
  readonly defaultPrevented?: boolean
  preventDefault?(): void
  stopPropagation?(): void
}

export type MuseEventHandler<Tag extends string = string> = (event: MuseDOMEvent<Tag>) => unknown
export type MuseStyleProperties = Readonly<Record<string, string | number | undefined>>
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
  readonly onpointerup?: MuseEventHandler<Tag>
  readonly onPointerUp?: MuseEventHandler<Tag>
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
