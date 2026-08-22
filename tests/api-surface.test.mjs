import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import ts from "typescript"
import * as compiler from "../packages/compiler/dist/index.js"
import * as core from "../packages/core/dist/index.js"
import * as muse from "../packages/muse/dist/index.js"
import * as react from "../packages/react/dist/index.js"
import * as vue from "../packages/vue/dist/index.js"
import * as web from "../packages/web/dist/index.js"

const coreRuntimeExports = [
  "Action", "Alert", "Binding", "BindingValue", "Box", "Button", "Capsule", "Circle", "Divider", "Element", "ElementRef", "ForEach",
  "ForeignComponent", "GeometryReader", "Grid", "Group", "HStack", "Image", "Key", "Label", "LazyGrid", "LazyHStack", "LazyVStack", "Link", "List", "Menu",
  "MuseInitializerAmbiguityError", "MuseInitializerError", "NavigationLink", "NavigationStack", "Picker", "ProgressView", "Rectangle", "RoundedRectangle", "SafeArea", "ScrollView",
  "Section", "Sheet", "Slider", "Spacer", "State", "Stepper", "Text", "TextArea", "TextField", "Toggle", "VStack", "ViewBuilder",
  "ViewIdentityStore", "ViewType", "ZStack", "actionClosure", "assertInitializerCall", "classNameOf", "closureForKind", "closureKindOf",
  "closureVariantsOf", "collectStateReads", "createViewIdentityStore", "createViewNode", "defineBuiltinView", "defineView", "edgeInsetsFromCss",
  "flattenViewBuilder", "frameStyle", "geometryView", "initializer", "initializerKinds", "initializersOf", "isBinding", "isForeignComponent", "isStateRef", "isViewNode",
  "keyedViewIdentity", "layoutLength", "lazyView", "markMuseClosure", "modifiedContent", "modifier", "modifierGraphOf", "museClosureKind", "museClosureVariants",
  "museForeignComponent", "museInitializers", "museNamedArguments", "museView", "namedArguments", "overloadClosure", "registerInitializers", "renderViewNode",
  "resolveBuilderClosure", "resolveInitializer", "resolveSemanticInitializer", "resolveValue", "SemanticModel", "semanticHtmlAttributeNames", "semanticHtmlAttributeSpec", "semanticHtmlTagNames", "semanticHtmlTagSpec", "stateVersion", "structView", "subscribeState", "valueClosure", "viewBuilderClosure", "viewBuilderSemanticSymbol",
  "viewElement", "viewFragment", "viewHost", "viewIdentityKey", "zeroGeometry",
].sort()

const coreTypeOnlyExports = [
  "AlertProps", "BindingRef", "BoxProps", "ClassValue", "EdgeInsets", "ElementViewNode", "FragmentViewNode", "FrameAlignment", "FrameOptions",
  "GeometryFrame", "GeometryProxy", "GeometryReaderCall", "GeometryReaderProps", "GeometryViewNode", "GridOptions", "GridProps", "HStackOptions",
  "HStackProps", "ImageOptions", "ImageProps", "InitializerMatch", "InitializerParameter", "InitializerParameterKind", "InitializerResolution",
  "LabelProps", "LazyGridOptions", "LazyGridProps", "LazyHStackOptions", "LazyHStackProps", "LazyOptions", "LazyVStackOptions", "LazyVStackProps", "LazyViewNode", "LazyViewRange", "Length", "LinkProps", "MenuProps", "ModifiableViewNode", "ModifiedContent", "Modifiers", "MuseClosure", "MuseClosureKind",
  "ForeignComponentDescriptor", "ForeignComponentOptions", "ForeignComponentSchema", "ForeignComponentSlot", "MuseClosureVariants", "MuseCustomElementAttributes", "MuseDOMEvent", "MuseEventHandler", "MuseEventTarget", "MuseGlobalHtmlAttributes", "NamedArguments",
  "SemanticArgument", "SemanticArgumentKind", "SemanticBindingSymbol", "SemanticBuilderTypeSymbol", "SemanticFieldSymbol", "SemanticForeignComponentTypeSymbol", "SemanticHtmlAttributeCategory", "SemanticHtmlAttributeSpec", "SemanticHtmlAttributeSymbol", "SemanticHtmlAttributeValueType", "SemanticHtmlElementSymbol", "SemanticHtmlTagSpec", "SemanticInitializerParameter", "SemanticInitializerParameterKind", "SemanticInitializerResolution", "SemanticInitializerResolutionFailure", "SemanticInitializerResolutionResult", "SemanticInitializerSymbol", "SemanticStateSymbol", "SemanticStructSymbol", "SemanticSymbol", "SemanticViewTypeSymbol",
  "MuseHtmlAttributes", "MuseHtmlEventAttributes", "MuseHtmlTagName", "MuseRenderer", "MuseStyleProperties", "MuseStyleValue", "NavigationLinkProps",
  "NavigationStackProps", "PickerOption", "PickerProps", "ProgressViewOptions", "ProgressViewProps", "RoundedRectangleProps", "SafeAreaCall",
  "SafeAreaEdge", "SafeAreaProps", "ScrollAxis", "ScrollViewCall", "ScrollViewProps", "SheetProps", "SliderOptions", "SliderProps", "SpacerCall",
  "SpacerProps", "StackCall", "StateRef", "StepperProps", "TextAreaProps", "TextFieldProps", "ToggleProps", "TypedViewConstructor",
  "VStackOptions", "VStackProps", "Value", "View", "ViewBuilderClosure", "ViewBuilderContent", "ViewBuilderResult", "ViewConstructor",
  "ViewConstructorMetadata", "ViewDefinition", "ViewFieldDefinition", "ViewGraphChild", "ViewGraphLeaf", "ViewGraphValue", "ViewHostNode",
  "ViewIdentity", "ViewIdentitySegment", "ViewModifier", "ViewModifierNode", "ViewNode", "ViewValue", "ZStackOptions", "ZStackProps",
].sort()

function declarationExports(path) {
  const file = resolve(path)
  const program = ts.createProgram([file], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
  })
  const source = program.getSourceFile(file)
  assert.ok(source, `missing declaration entry point: ${path}`)
  const checker = program.getTypeChecker()
  const symbol = checker.getSymbolAtLocation(source)
  assert.ok(symbol, `missing declaration module symbol: ${path}`)
  return checker.getExportsOfModule(symbol).map(item => item.name).sort()
}

test("the 1.0 candidate core runtime surface changes only through an explicit snapshot update", () => {
  assert.deepEqual(Object.keys(core).sort(), coreRuntimeExports)
  assert.deepEqual(Object.keys(muse).sort(), coreRuntimeExports)
})

test("React adds only renderer APIs and preserves canonical export identity", () => {
  const reactOnly = Object.keys(react).filter(name => !(name in core)).sort()
  assert.deepEqual(reactOnly, ["Component", "MuseView", "Raw", "createRenderer", "reactElement", "render", "statefulView", "view"])
  for (const name of coreRuntimeExports) assert.equal(react[name], core[name], `${name} must remain a core compatibility re-export`)
})

test("Vue, Web, and compiler renderer surfaces remain intentionally narrow", () => {
  assert.deepEqual(Object.keys(vue).sort(), ["Component", "MuseView", "createVueView", "foreignComponent", "fromVueRef", "mount", "render", "toVueRef", "vueComponent"])
  assert.deepEqual(Object.keys(web).sort(), ["mount", "renderToHTML"])
  assert.deepEqual(Object.keys(compiler).sort(), [
    "SemanticModel", "compileMuseFile", "createMuseLanguageService", "createMuseSemanticModel", "createMuseVitePlugin", "diagnoseMuseSource", "formatMuseSource", "lowerMuseBuilderAst",
    "mapGeneratedPosition", "mapOriginalPosition", "parseMuseBuilder", "parseMuseStructs", "resolveSemanticInitializer", "semanticHtmlAttributeNames", "semanticHtmlAttributeSpec", "semanticHtmlTagNames", "semanticHtmlTagSpec", "transformMuseSource",
  ])
})

test("canonical authoring does not expose renderer-owned materialization APIs", () => {
  for (const name of ["Component", "MuseView", "Raw", "mount", "reactElement", "render", "renderToHTML", "view"]) {
    assert.equal(name in muse, false, `${name} belongs to a renderer package`)
  }
})

test("@muse/react canonical entry stays independent from legacy compiler machinery", () => {
  const canonicalFiles = ["index.js", "renderer.js", "views.js", "controls.js", "advanced.js", "interop.js", "presentation.js"]
  const source = canonicalFiles.map(file => readFileSync(resolve(`packages/react/dist/${file}`), "utf8")).join("\n")
  assert.doesNotMatch(source, /legacy|typescript|@muse\/compiler/)
  const manifest = JSON.parse(readFileSync(resolve("packages/react/package.json"), "utf8"))
  assert.equal(manifest.dependencies?.typescript, undefined)
  assert.equal(manifest.peerDependencies?.typescript, undefined)
  assert.equal(manifest.dependencies?.["@muse/legacy-react"], "workspace:*")
  const legacyManifest = JSON.parse(readFileSync(resolve("packages/legacy-react/package.json"), "utf8"))
  assert.equal(legacyManifest.dependencies?.typescript, "^5.8.3")
  assert.match(readFileSync(resolve("packages/react/src/legacy/compiler/index.ts"), "utf8"), /@muse\/legacy-react\/compiler/)
})

test("the 1.0 candidate declaration surface includes type-only exports in the freeze gate", () => {
  const coreDeclarations = [...coreRuntimeExports, ...coreTypeOnlyExports].sort()
  assert.deepEqual(declarationExports("packages/core/dist/index.d.ts"), coreDeclarations)
  assert.deepEqual(declarationExports("packages/muse/dist/index.d.ts"), coreDeclarations)
  const reactDeclarations = declarationExports("packages/react/dist/index.d.ts")
  assert.deepEqual(reactDeclarations.filter(name => !coreDeclarations.includes(name)), [
    "Component", "MuseView", "Raw", "StatefulViewDefinition", "createRenderer", "reactElement", "render", "statefulView", "view",
  ])
  assert.deepEqual(declarationExports("packages/vue/dist/index.d.ts"), [
    "Component", "MuseView", "MuseViewProps", "MuseVueSlot", "VueComponentProps", "VueComponentView", "VueMountOptions", "VueView",
    "createVueView", "foreignComponent", "fromVueRef", "mount", "render", "toVueRef", "vueComponent",
  ])
  assert.deepEqual(declarationExports("packages/web/dist/index.d.ts"), ["WebMountOptions", "mount", "renderToHTML"])
  assert.deepEqual(declarationExports("packages/compiler/dist/index.d.ts"), [
    "MuseArgument", "MuseAstLowering", "MuseBuilderNode", "MuseBuilderProgram", "MuseCallExpression", "MuseClosureExpression",
    "MuseConditionalExpression", "MuseDiagnostic", "MuseLanguageService", "MuseRawExpression", "MuseSemanticCall", "MuseSemanticField",
    "MuseSemanticForeignComponent", "MuseSemanticHtmlDiagnostic", "MuseSemanticHtmlElement", "MuseSemanticImport", "MuseSemanticInitializer", "MuseSemanticModel", "MuseSemanticView", "MuseSourceMap", "MuseSourceMapAnchor",
    "MuseSourcePosition", "MuseSourceRange", "MuseStructDeclaration", "MuseStructField", "MuseStructInitializer", "MuseTransformResult",
    "MuseVitePluginOptions", "SemanticArgument", "SemanticArgumentKind", "SemanticBindingSymbol", "SemanticBuilderTypeSymbol", "SemanticFieldSymbol", "SemanticForeignComponentTypeSymbol", "SemanticHtmlAttributeCategory", "SemanticHtmlAttributeSpec", "SemanticHtmlAttributeSymbol", "SemanticHtmlAttributeValueType", "SemanticHtmlElementSymbol", "SemanticHtmlTagSpec", "SemanticInitializerParameter", "SemanticInitializerParameterKind", "SemanticInitializerResolution", "SemanticInitializerResolutionFailure", "SemanticInitializerResolutionResult", "SemanticInitializerSymbol", "SemanticModel", "SemanticStateSymbol", "SemanticStructSymbol", "SemanticSymbol", "SemanticViewTypeSymbol",
    "compileMuseFile", "createMuseLanguageService", "createMuseSemanticModel", "createMuseVitePlugin", "diagnoseMuseSource", "formatMuseSource",
    "lowerMuseBuilderAst", "mapGeneratedPosition", "mapOriginalPosition", "parseMuseBuilder", "parseMuseStructs", "resolveSemanticInitializer", "semanticHtmlAttributeNames", "semanticHtmlAttributeSpec", "semanticHtmlTagNames", "semanticHtmlTagSpec", "transformMuseSource",
  ])
})
