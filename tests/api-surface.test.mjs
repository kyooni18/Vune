import assert from "node:assert/strict"
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
  "GeometryReader", "Grid", "Group", "HStack", "Image", "Key", "Label", "LazyGrid", "LazyHStack", "LazyVStack", "Link", "List", "Menu",
  "MuseInitializerError", "NavigationLink", "NavigationStack", "Picker", "ProgressView", "Rectangle", "RoundedRectangle", "SafeArea", "ScrollView",
  "Section", "Sheet", "Slider", "Spacer", "State", "Stepper", "Text", "TextArea", "TextField", "Toggle", "VStack", "ViewBuilder",
  "ViewIdentityStore", "ViewType", "ZStack", "actionClosure", "assertInitializerCall", "classNameOf", "closureForKind", "closureKindOf",
  "closureVariantsOf", "collectStateReads", "createViewIdentityStore", "createViewNode", "defineBuiltinView", "defineView", "edgeInsetsFromCss",
  "flattenViewBuilder", "frameStyle", "geometryView", "initializer", "initializerKinds", "initializersOf", "isBinding", "isStateRef", "isViewNode",
  "keyedViewIdentity", "layoutLength", "markMuseClosure", "modifiedContent", "modifier", "modifierGraphOf", "museClosureKind", "museClosureVariants",
  "museInitializers", "museNamedArguments", "museView", "namedArguments", "overloadClosure", "registerInitializers", "renderViewNode",
  "resolveBuilderClosure", "resolveInitializer", "resolveValue", "stateVersion", "structView", "subscribeState", "valueClosure", "viewBuilderClosure",
  "viewElement", "viewFragment", "viewHost", "viewIdentityKey", "zeroGeometry",
].sort()

const coreTypeOnlyExports = [
  "AlertProps", "BindingRef", "BoxProps", "ClassValue", "EdgeInsets", "ElementViewNode", "FragmentViewNode", "FrameAlignment", "FrameOptions",
  "GeometryFrame", "GeometryProxy", "GeometryReaderCall", "GeometryReaderProps", "GeometryViewNode", "GridOptions", "GridProps", "HStackOptions",
  "HStackProps", "ImageOptions", "ImageProps", "InitializerMatch", "InitializerParameter", "InitializerParameterKind", "InitializerResolution",
  "LabelProps", "Length", "LinkProps", "MenuProps", "ModifiableViewNode", "ModifiedContent", "Modifiers", "MuseClosure", "MuseClosureKind",
  "MuseClosureVariants", "MuseCustomElementAttributes", "MuseDOMEvent", "MuseEventHandler", "MuseEventTarget", "MuseGlobalHtmlAttributes",
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
  assert.deepEqual(Object.keys(vue).sort(), ["Component", "MuseView", "createVueView", "fromVueRef", "mount", "render", "toVueRef", "vueComponent"])
  assert.deepEqual(Object.keys(web).sort(), ["mount", "renderToHTML"])
  assert.deepEqual(Object.keys(compiler).sort(), [
    "compileMuseFile", "createMuseLanguageService", "createMuseVitePlugin", "diagnoseMuseSource", "formatMuseSource", "lowerMuseBuilderAst",
    "mapGeneratedPosition", "mapOriginalPosition", "parseMuseBuilder", "parseMuseStructs", "transformMuseSource",
  ])
})

test("canonical authoring does not expose renderer-owned materialization APIs", () => {
  for (const name of ["Component", "MuseView", "Raw", "mount", "reactElement", "render", "renderToHTML", "view"]) {
    assert.equal(name in muse, false, `${name} belongs to a renderer package`)
  }
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
    "createVueView", "fromVueRef", "mount", "render", "toVueRef", "vueComponent",
  ])
  assert.deepEqual(declarationExports("packages/web/dist/index.d.ts"), ["WebMountOptions", "mount", "renderToHTML"])
  assert.deepEqual(declarationExports("packages/compiler/dist/index.d.ts"), [
    "MuseArgument", "MuseAstLowering", "MuseBuilderNode", "MuseBuilderProgram", "MuseCallExpression", "MuseClosureExpression",
    "MuseConditionalExpression", "MuseDiagnostic", "MuseLanguageService", "MuseRawExpression", "MuseSourceMap", "MuseSourceMapAnchor",
    "MuseSourcePosition", "MuseSourceRange", "MuseStructDeclaration", "MuseStructField", "MuseStructInitializer", "MuseTransformResult",
    "MuseVitePluginOptions", "compileMuseFile", "createMuseLanguageService", "createMuseVitePlugin", "diagnoseMuseSource", "formatMuseSource",
    "lowerMuseBuilderAst", "mapGeneratedPosition", "mapOriginalPosition", "parseMuseBuilder", "parseMuseStructs", "transformMuseSource",
  ])
})
