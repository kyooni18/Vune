# Local development

This is the recommended workflow while Vune packages are not published to npm.
The Vune checkout and the application remain completely separate projects.

## 1. Prepare the Vune checkout

```bash
cd ~/Code/Web/React/Vune
pnpm install
pnpm build
```

Internal workspace dependencies use `workspace:*`. This guarantees that
building Vune itself never depends on a previously published `@vune-ui/*`
version. `pnpm pack` rewrites those workspace dependencies to the package
version for release archives.

## 2. Link an existing app

From the Vune checkout:

```bash
pnpm dev:link ~/Code/Web/React/MyApp
```

The command edits the target `package.json` with direct source links:

```json
{
  "dependencies": {
    "vune-ui": "link:/absolute/path/to/Vune",
    "@vune-ui/react": "link:/absolute/path/to/Vune/packages/react"
  },
  "devDependencies": {
    "@vune-ui/core": "link:/absolute/path/to/Vune/packages/core",
    "@vune-ui/compiler": "link:/absolute/path/to/Vune/packages/compiler",
    "@vune-ui/legacy-react": "link:/absolute/path/to/Vune/packages/legacy-react",
    "@vune-ui/vite": "link:/absolute/path/to/Vune/packages/vite"
  }
}
```

`link:` packages do not install their own dependency graph, so the linker also
adds the internal packages needed by the selected renderer directly as development
dependencies. It writes `overrides:` to the target `pnpm-workspace.yaml` for all
internal Vune packages as a second guard. This prevents a linked `@vune-ui/vite` from trying to download `@vune-ui/compiler`, or a linked
React renderer from trying to download `@vune-ui/core`, from npm.

Use another renderer explicitly when needed:

```bash
pnpm dev:link /path/to/vue-app --renderer vue
pnpm dev:link /path/to/web-app --renderer web
```

Pass `--no-install` if you only want the manifest changed.

## 3. Keep Vune outputs fresh

```bash
pnpm dev:watch
```

The watch command performs one clean build and then watches the root package and
each TypeScript workspace package. A linked app can stay open in its own Vite
dev server while Vune is edited.

## 4. Create a separate app directly from the checkout

```bash
pnpm dev:create ~/Code/Web/React/MyVuneApp
```

This is equivalent to:

```bash
node bin/vune-ui.mjs create ~/Code/Web/React/MyVuneApp --local
```

The generated project is not a Vune workspace member. Its dependencies point
back to the Vune checkout through `link:` paths.

## 5. Local tarballs when links are undesirable

Generate current-version archives:

```bash
pnpm pack:local
```

Then configure another project with the generated archives:

```bash
pnpm local:install /path/to/my-app
```

The installer adds `file:` dependencies and pnpm 11 workspace overrides for all internal
archives, so transitive unpublished packages cannot leak to the registry.

Generated `.tgz` files and `manifest.json` are ignored by Git. Do not commit
local package archives; regenerate them from the current source instead.

## 6. Vite configuration

React:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { vunePlugin } from '@vune-ui/vite'

export default defineConfig({
  plugins: [vunePlugin(), react()],
})
```

The Vune transform must run before the renderer plugin.
