#!/usr/bin/env bash
set -Eeuo pipefail
set -o pipefail

BRANCH=codex/collection-runtime-finalize-20260830
stage=bootstrap
log=/tmp/current-stage.log

configure_git() {
  git config user.name github-actions[bot]
  git config user.email 41898282+github-actions[bot]@users.noreply.github.com
}

record_failure() {
  code=$?
  trap - ERR
  set +e
  git reset
  mkdir -p .github
  {
    printf 'stage=%s\n' "$stage"
    printf 'sha=%s\n' "$(git rev-parse HEAD)"
    printf 'exit=%s\n' "$code"
    printf 'time=%s\n' "$(date -u +%FT%TZ)"
    printf '\nlast-command-output:\n'
    if [ -f "$log" ]; then
      tail -n 600 "$log"
    fi
  } > .github/collection-runtime-v5-failure.txt
  configure_git
  git add .github/collection-runtime-v5-failure.txt
  git commit --only .github/collection-runtime-v5-failure.txt \
    -m "chore: collection runtime v5 failed at ${stage} [skip ci]" || true
  git push origin HEAD:${BRANCH} || true
  exit "$code"
}
trap record_failure ERR

run_stage() {
  stage=$1
  shift
  : > "$log"
  "$@" 2>&1 | tee "$log"
}

configure_git

stage=apply-product-patch
: > "$log"
if [ -f .github/collection-runtime-apply.mjs ] && [ -d .github/collection-runtime-patch ]; then
  if node .github/collection-runtime-apply.mjs 2>&1 | tee "$log"; then
    echo 'Applied prepared product patch.' | tee -a "$log"
  else
    git reset --hard HEAD
    node - <<'NODE'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
const directory = '.github/collection-runtime-patch'
const encoded = readdirSync(directory)
  .sort()
  .map((name) => readFileSync(`${directory}/${name}`, 'utf8'))
  .join('')
writeFileSync('/tmp/collection-runtime-product.patch', gunzipSync(Buffer.from(encoded, 'base64')))
NODE
    if git apply --reverse --check /tmp/collection-runtime-product.patch >> "$log" 2>&1; then
      echo 'Prepared product patch is already present in the branch.' | tee -a "$log"
    else
      false
    fi
  fi
else
  echo 'No prepared patch bundle remains; validating the current product tree.' | tee "$log"
fi
git diff --cached --check

run_stage install pnpm install --frozen-lockfile
run_stage build-before-cleanup pnpm run build
run_stage state-core-before-cleanup node --test tests/core.test.mjs
run_stage collection-web-before-cleanup \
  node --test \
  --test-name-pattern='row-local invalidation|flat keyed host rows|batches in-place ForEach mutations|compiled keyed collection|eventful compiled collection|push pop and reverse|duplicate occurrence identity' \
  tests/web-package.test.mjs
run_stage compiler-before-cleanup node --test tests/compiler-package.test.mjs
run_stage adapters-before-cleanup \
  node --test \
  --test-name-pattern='compiler-planned State collections' \
  tests/react-client.test.mjs tests/vue-live.test.mjs
run_stage full-web-before-cleanup node --test tests/web-package.test.mjs
run_stage full-suite-before-cleanup pnpm test

stage=cleanup
find .github -maxdepth 1 -type f -name 'collection-*' -print -delete
rm -rf .github/collection-runtime-patch
find .github/workflows -maxdepth 1 -type f -name 'collection-runtime*.yml' -print -delete

git add -A
git diff --cached --check

run_stage build-after-cleanup pnpm run build
run_stage state-core-after-cleanup node --test tests/core.test.mjs
run_stage collection-web-after-cleanup \
  node --test \
  --test-name-pattern='row-local invalidation|flat keyed host rows|batches in-place ForEach mutations|compiled keyed collection|eventful compiled collection|push pop and reverse|duplicate occurrence identity' \
  tests/web-package.test.mjs
run_stage compiler-after-cleanup node --test tests/compiler-package.test.mjs
run_stage adapters-after-cleanup \
  node --test \
  --test-name-pattern='compiler-planned State collections' \
  tests/react-client.test.mjs tests/vue-live.test.mjs
run_stage full-web-after-cleanup node --test tests/web-package.test.mjs

stage=benchmark-after-cleanup
: > /tmp/collection-runtime-benchmark.txt
node benchmarks/collection-runtime.mjs 2>&1 | tee /tmp/collection-runtime-benchmark.txt

run_stage full-suite-after-cleanup pnpm test

stage=write-report
mkdir -p benchmarks
cat > benchmarks/collection-runtime-validation-20260830.md <<EOF
# Keyed collection runtime validation — 2026-08-30

Validated branch: \`${BRANCH}\`
Validated input SHA: \`$(git rev-parse HEAD)\`
Node: \`$(node --version)\`
pnpm: \`$(pnpm --version)\`

## Validation

The following commands completed successfully both before and after removal of temporary collection diagnostics:

- \`pnpm run build\`
- \`node --test tests/core.test.mjs\`
- collection-specific cases in \`tests/web-package.test.mjs\`
- \`node --test tests/compiler-package.test.mjs\`
- compiler-planned collection cases in the React and Vue adapters
- \`node --test tests/web-package.test.mjs\`
- \`pnpm test\`

## 25,000-row JSDOM benchmark

Previous checkpoint measurements supplied for comparison:

- mount: approximately 1082 ms
- single replacement: approximately 33.3 ms
- direct field mutation: approximately 0.33 ms
- push: approximately 11.6 ms
- pop: approximately 30.4 ms
- reverse: approximately 71.5 s, dominated by 25,000 DOM moves in JSDOM

Final run output:

\`\`\`text
$(cat /tmp/collection-runtime-benchmark.txt)
\`\`\`
EOF

git add -A
git diff --cached --check

stage=commit-final-product
git commit -m 'Finalize keyed collection runtime performance'
git push origin HEAD:${BRANCH}
trap - ERR
