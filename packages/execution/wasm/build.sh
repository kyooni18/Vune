#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLANG_BIN=${CLANG:-clang}
COMMON_FLAGS="--target=wasm32 -O3 -nostdlib -fno-builtin -Wl,--no-entry -Wl,--export=resident_alloc -Wl,--export=resident_reset_allocator -Wl,--export=resident_simd_enabled -Wl,--export=resident_execute -Wl,--export=__heap_base -Wl,--import-memory -Wl,--initial-memory=131072 -Wl,--max-memory=67108864"

"$CLANG_BIN" $COMMON_FLAGS "$SCRIPT_DIR/resident-kernel.c" -o "$SCRIPT_DIR/resident-kernel-scalar.wasm"
"$CLANG_BIN" $COMMON_FLAGS -DRESIDENT_SIMD=1 -msimd128 "$SCRIPT_DIR/resident-kernel.c" -o "$SCRIPT_DIR/resident-kernel-simd.wasm"
"$CLANG_BIN" $COMMON_FLAGS -matomics -mbulk-memory -Wl,--shared-memory "$SCRIPT_DIR/resident-kernel.c" -o "$SCRIPT_DIR/resident-kernel-shared-scalar.wasm"
"$CLANG_BIN" $COMMON_FLAGS -DRESIDENT_SIMD=1 -msimd128 -matomics -mbulk-memory -Wl,--shared-memory "$SCRIPT_DIR/resident-kernel.c" -o "$SCRIPT_DIR/resident-kernel-shared-simd.wasm"

for wasm_file in "$SCRIPT_DIR"/resident-kernel-*.wasm; do
  base64 < "$wasm_file" | tr -d '\n' > "$SCRIPT_DIR/prebuilt/$(basename "$wasm_file").b64"
done
