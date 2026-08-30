#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
COMMON=(
  --target=wasm32
  -O3
  -nostdlib
  -Wl,--no-entry
  -Wl,--export-memory
  -Wl,--initial-memory=4194304
  -Wl,--max-memory=67108864
  -Wl,--strip-all
)
SHARED=(
  --target=wasm32
  -O3
  -nostdlib
  -matomics
  -mbulk-memory
  -Wl,--no-entry
  -Wl,--import-memory
  -Wl,--shared-memory
  -Wl,--initial-memory=4194304
  -Wl,--max-memory=67108864
  -Wl,--strip-all
)
clang "${COMMON[@]}" kernel.c -o kernel-scalar.wasm
clang "${COMMON[@]}" -DMOTION_SIMD=1 -msimd128 kernel.c -o kernel-simd.wasm
clang "${SHARED[@]}" kernel.c -o kernel-shared-scalar.wasm
clang "${SHARED[@]}" -DMOTION_SIMD=1 -msimd128 kernel.c -o kernel-shared-simd.wasm
printf 'Built scalar/SIMD and shared scalar/SIMD kernels\n'
