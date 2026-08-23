import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import ts from "typescript"
import * as compiler from "../packages/compiler/dist/index.js"
import * as core from "../packages/core/dist/index.js"
import * as vune from "../dist/index.js"
import * as react from "../packages/react/dist/index.js"
import * as vue from "../packages/vue/dist/index.js"
import * as web from "../packages/web/dist/index.js"

const coreRuntimeExports = [
  "Action", "Alert", "Binding", "BindingValue", "Box", "Button", "Capsule", "Circle", "Divider", "Element", "ElementRef", "ForEach",
  "ForeignComponent", "GeometryReader", "Grid", "Group", "HStack", "Image", "Key", "Label", "LazyGrid", "LazyHStack", "LazyVStack", "Link", "List", "Menu",
  "VuneInitializerAmbiguityError", "VuneInitializerError", "NavigationLink", "NavigationStack", "Picker", "ProgressView", "Rectangle", "RoundedRectangle", "SafeArea", "ScrollView",
  "Section", "Sheet", "Slider", "Spacer", "State", "Stepper", "Text", "TextArea", "TextField", "Toggle", "VStack", "ViewBuilder",
  "ViewIdentityStore", "ViewType", "ZStack", "actionClosure", "assertInitializerCall", "classNameOf", "closureForKind", "closureKindOf",
  "closureVariantsOf", "collectLogicalViewIdentities", "collectStateReads", "createViewIdentityStore", "createViewNode", "defineBuiltinView", "defineView", "edgeInsetsFromCss",
  "flattenViewBuilder", "frameStyle", "geometryView", "initializer", "initializerKinds", "initializersOf", "isBinding", "isForeignComponent", "isStateRef", "isViewNode",
  "keyedViewIdentity", "layoutLength", "lazyView", "markVuneClosure", "modifiedContent", "modifier", "modifierGraphOf", "vuneClosureKind", "vuneClosureVariants",
  "vuneForeignComponent", "vuneInitializers", "vuneNamedArguments", "vuneView", "namedArguments", "overloadClosure", "registerInitializers", "renderViewNode",
  "resolveBuilderClosure", "resolveInitializer", "resolveSemanticCall", "resolveSemanticInitializer", "resolveValue", "SemanticModel", "semanticHtmlAttributeNames", "semanticHtmlAttributeSpec", "semanticHtmlTagNames", "semanticHtmlTagSpec", "stateVersion", "structView", "subscribeState", "valueClosure", "viewBuilderClosure", "viewBuilderSemanticSymbol",
  "viewElement", "viewFragment", "viewHost", "viewIdentityKey", "viewTypeIdentity", "zeroGeometry",
].sort()

const coreTypeOnlyExports = [
  "AlertProps", "BindingRef", "BoxProps", "ClassValue", "EdgeInsets", "ElementViewNode", "FragmentViewNode", "FrameAlignment", "FrameOptions",
  "GeometryFrame", "GeometryProxy", "GeometryReaderCall", "GeometryReaderProps", "GeometryViewNode", "GridOptions", "GridProps", "HStackOptions",
  "HStackProps", "ImageOptions", "ImageProps", "InitializerMatch", "InitializerParameter", "InitializerParameterKind", "InitializerResolution",
  "LabelProps", "LazyGridOptions", "LazyGridProps", "LazyHStackOptions", "LazyHStackProps", "LazyOptions", "LazyVStackOptions", "LazyVStackProps", "LazyViewNode", "LazyViewRange", "Length", "LinkProps", "MenuProps", "ModifiableViewNode", "ModifiedContent", "Modifiers", "VuneClosure", "VuneClosureKind",
  "ForeignComponentDescriptor", "ForeignComponentOptions", "ForeignComponentSchema", "ForeignComponentSlot", "VuneClosureVariants", "VuneCustomElementAttributes", "VuneDOMEvent", "VuneEventHandler", "VuneEventTarget", "VuneGlobalHtmlAttributes", "NamedArguments",
  "SemanticArgument", "SemanticArgumentKind", "SemanticBindingSymbol", "SemanticBuilderTypeSymbol", "SemanticCallResolution", "SemanticClosureRole", "SemanticFieldSymbol", "SemanticForeignComponentTypeSymbol", "SemanticHtmlAttributeCategory", "SemanticHtmlAttributeSpec", "SemanticHtmlAttributeSymbol", "SemanticHtmlAttributeValueType", "SemanticHtmlElementSymbol", "SemanticHtmlTagSpec", "SemanticInitializerParameter", "SemanticInitializerParameterKind", "SemanticInitializerResolution", "SemanticInitializerResolutionFailure", "SemanticInitializerResolutionResult", "SemanticInitializerSymbol", "SemanticResolutionDiagnostic", "SemanticStateSymbol", "SemanticStructSymbol", "SemanticSymbol", "SemanticViewTypeSymbol",
  "VuneHtmlAttributes", "VuneHtmlEventAttributes", "VuneHtmlTagName", "VuneRenderer", "VuneStyleProperties", "VuneStyleValue", "NavigationLinkProps",
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
  assert.deepEqual(Object.keys(vune).sort(), coreRuntimeExports)
})

test("React adds only renderer APIs and preserves canonical export identity", () => {
  const reactOnly = Object.keys(react).filter(name => !(name in core)).sort()
  assert.deepEqual(reactOnly, ["Component", "VuneView", "Raw", "createRenderer", "reactElement", "render", "statefulView", "view"].sort())
  for (const name of coreRuntimeExports) assert.equal(react[name], core[name], `${name} must remain a core compatibility re-export`)
})

test("Vue, Web, and compiler renderer surfaces remain intentionally narrow", () => {
  assert.deepEqual(Object.keys(vue).sort(), ["Component", "VuneView", "createVueView", "foreignComponent", "fromVueRef", "mount", "render", "toVueRef", "vueComponent"])
  assert.deepEqual(Object.keys(web).sort(), ["mount", "renderToHTML"])
  assert.deepEqual(Object.keys(compiler).sort(), [
    "SemanticModel", "compileVuneFile", "createVuneLanguageService", "createVuneSemanticModel", "createVuneVitePlugin", "diagnoseVuneSource", "formatVuneSource", "lowerVuneBuilderAst",
    "mapGeneratedPosition", "mapOriginalPosition", "parseVuneBuilder", "parseVuneStructs", "resolveSemanticCall", "resolveSemanticInitializer", "semanticHtmlAttributeNames", "semanticHtmlAttributeSpec", "semanticHtmlTagNames", "semanticHtmlTagSpec", "transformVuneSource",
  ])
})

test("canonical authoring does not expose renderer-owned materialization APIs", () => {
  for (const name of ["Component", "VuneView", "Raw", "mount", "reactElement", "render", "renderToHTML", "view"]) {
    assert.equal(name in vune, false, `${name} belongs to a renderer package`)
  }
})

test("@vune-ui/react canonical entry stays independent from legacy compiler machinery", () => {
  const canonicalFiles = ["index.js", "renderer.js", "views.js", "controls.js", "advanced.js", "interop.js", "presentation.js"]
  const source = canonicalFiles.map(file => readFileSync(resolve(`packages/react/dist/${file}`), "utf8")).join("\n")
  assert.doesNotMatch(source, /legacy|typescript|@vune-ui\/compiler/)
  const manifest = JSON.parse(readFileSync(resolve("packages/react/package.json"), "utf8"))
  assert.equal(manifest.dependencies?.typescript, undefined)
  assert.equal(manifest.peerDependencies?.typescript, undefined)
  assert.equal(manifest.dependencies?.["@vune-ui/legacy-react"], "workspace:*")
  const legacyManifest = JSON.parse(readFileSync(resolve("packages/legacy-react/package.json"), "utf8"))
  assert.equal(legacyManifest.dependencies?.typescript, "^5.8.3")
  assert.match(readFileSync(resolve("packages/react/src/legacy/compiler/index.ts"), "utf8"), /@vune-ui\/legacy-react\/compiler/)
})

test("the 1.0 candidate declaration surface includes type-only exports in the freeze gate", () => {
  const coreDeclarations = [...coreRuntimeExports, ...coreTypeOnlyExports].sort()
  assert.deepEqual(declarationExports("packages/core/dist/index.d.ts"), coreDeclarations)
  assert.deepEqual(declarationExports("dist/index.d.ts"), coreDeclarations)
  const reactDeclarations = declarationExports("packages/react/dist/index.d.ts")
  assert.deepEqual(reactDeclarations.filter(name => !coreDeclarations.includes(name)), [
    "Component", "VuneView", "Raw", "StatefulViewDefinition", "createRenderer", "reactElement", "render", "statefulView", "view",
  ].sort())
  assert.deepEqual(declarationExports("packages/vue/dist/index.d.ts"), [
    "Component", "VuneView", "VuneViewProps", "VuneVueSlot", "VueComponentProps", "VueComponentView", "VueMountOptions", "VueView",
    "createVueView", "foreignComponent", "fromVueRef", "mount", "render", "toVueRef", "vueComponent",
  ].sort())
  assert.deepEqual(declarationExports("packages/web/dist/index.d.ts"), ["WebMountOptions", "mount", "renderToHTML"].sort())
  assert.deepEqual(declarationExports("packages/compiler/dist/index.d.ts"), [
    "VuneArgument", "VuneAstLowering", "VuneBuilderNode", "VuneBuilderProgram", "VuneCallExpression", "VuneClosureExpression",
    "VuneConditionalExpression", "VuneDiagnostic", "VuneLanguageService", "VuneRawExpression", "VuneSemanticCall", "VuneSemanticField",
    "VuneSemanticForeignComponent", "VuneSemanticHtmlDiagnostic", "VuneSemanticHtmlElement", "VuneSemanticImport", "VuneSemanticInitializer", "VuneSemanticModel", "VuneSemanticView", "VuneSourceMap", "VuneSourceMapAnchor",
    "VuneSourcePosition", "VuneSourceRange", "VuneStructDeclaration", "VuneStructField", "VuneStructInitializer", "VuneTransformResult",
    "VuneVitePluginOptions", "SemanticArgument", "SemanticArgumentKind", "SemanticBindingSymbol", "SemanticBuilderTypeSymbol", "SemanticCallResolution", "SemanticClosureRole", "SemanticFieldSymbol", "SemanticForeignComponentTypeSymbol", "SemanticHtmlAttributeCategory", "SemanticHtmlAttributeSpec", "SemanticHtmlAttributeSymbol", "SemanticHtmlAttributeValueType", "SemanticHtmlElementSymbol", "SemanticHtmlTagSpec", "SemanticInitializerParameter", "SemanticInitializerParameterKind", "SemanticInitializerResolution", "SemanticInitializerResolutionFailure", "SemanticInitializerResolutionResult", "SemanticInitializerSymbol", "SemanticModel", "SemanticResolutionDiagnostic", "SemanticStateSymbol", "SemanticStructSymbol", "SemanticSymbol", "SemanticViewTypeSymbol",
    "compileVuneFile", "createVuneLanguageService", "createVuneSemanticModel", "createVuneVitePlugin", "diagnoseVuneSource", "formatVuneSource",
    "lowerVuneBuilderAst", "mapGeneratedPosition", "mapOriginalPosition", "parseVuneBuilder", "parseVuneStructs", "resolveSemanticCall", "resolveSemanticInitializer", "semanticHtmlAttributeNames", "semanticHtmlAttributeSpec", "semanticHtmlTagNames", "semanticHtmlTagSpec", "transformVuneSource",
  ].sort())
})
