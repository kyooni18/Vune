# Publishing Vune to npm

Vune publishes a synchronized set of nine packages:

1. `@vune-ui/core`
2. `@vune-ui/compiler`
3. `@vune-ui/legacy-react`
4. `@vune-ui/react`
5. `@vune-ui/vue`
6. `@vune-ui/web`
7. `@vune-ui/vite`
8. `vune-ui`
9. `create-vune-ui`

The repository includes a release helper that verifies, packs, and publishes them in dependency order.

## One-time npm setup

Log in to npm first:

```bash
npm login
npm whoami
```

The scoped packages use `@vune-ui/*`. If your npm username is not `vune-ui`, the `vune-ui` npm organization/scope must exist and your account must have publish access to it.

The script never stores an npm token or OTP. Authentication is handled by the normal npm CLI. If npm requires a one-time password during direct publishing, enter it when npm asks for it.

## Inspect the release plan

This does not build, contact npm, change versions, or publish anything:

```bash
pnpm release:plan
```

## Dry run

Run the release checks, build the actual tarballs, then ask npm to perform a publish dry-run for all packages:

```bash
pnpm release:dry
```

## Publish the current version

```bash
pnpm release
```

The command:

1. refuses a dirty Git tree by default;
2. runs the full release gate;
3. creates fresh tarballs with `pnpm pack`;
4. verifies that no packed manifest contains `workspace:` dependencies;
5. verifies npm authentication;
6. asks for final confirmation;
7. publishes packages in dependency order;
8. skips an identical version that is already on npm, so an interrupted release can be resumed safely.

## Bump and publish

All publishable Vune packages always share one version. The helper can update every package manifest before verification and publication:

```bash
pnpm release:patch
pnpm release:minor
pnpm release:major
```

For an explicit version or prerelease:

```bash
pnpm release -- --version 0.2.0-beta.1 --tag next
```

Stable versions default to the `latest` dist-tag. Versions containing a prerelease suffix default to `next`.

## Useful options

```bash
# Do the normal package/test/release checks but skip perf + built-browser gates.
pnpm release -- --quick

# Publish using a different dist-tag.
pnpm release -- --tag next

# Publish without the interactive final confirmation.
pnpm release -- --yes

# Allow uncommitted changes intentionally.
pnpm release -- --allow-dirty

# Pass npm provenance through in a supported CI environment.
pnpm release -- --provenance --yes

# Emergency-only: skip all validation.
pnpm release -- --skip-checks
```

Use `--skip-checks` only when the exact artifacts were already validated elsewhere. The normal release path is deliberately conservative.

## Partial failure / resume

If npm accepts some packages and a later package fails, fix the npm/auth/network problem and run the same release command again. Before each real publish the helper queries npm for that exact `name@version`. Existing versions are skipped, and the remaining packages continue in the original dependency order.

Do not bump the version after a partial release unless you intentionally want to abandon that release and publish a new version.
