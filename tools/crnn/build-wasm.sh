#!/bin/sh
# Compiles the CRNN kernels to WebAssembly (SIMD) and embeds them as base64 in js/crnn-wasm.js.
set -e
cd "$(dirname "$0")"
clang --target=wasm32 -O3 -msimd128 -nostdlib -ffreestanding -fno-builtin-exp -fno-builtin-tanh -Wl,--no-entry -Wl,--export=__heap_base -Wl,--initial-memory=33554432 -Wl,--max-memory=268435456 -Wl,-z,stack-size=65536 -o out/kernels.wasm kernels.c
B64=$(base64 -w0 out/kernels.wasm)
printf '/* Inkleaf — CRNN WebAssembly kernels (SIMD), built by tools/crnn/build-wasm.sh. */\n(function(){ const root = typeof window !== "undefined" ? window : self; (root.IL = root.IL || {}).crnnWasmB64 = "%s"; })();\n' "$B64" > ../../js/crnn-wasm.js
ls -la out/kernels.wasm ../../js/crnn-wasm.js
