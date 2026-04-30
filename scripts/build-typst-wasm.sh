#!/usr/bin/env bash
# Build resources/tree-sitter-typst.wasm from a pinned uben0/tree-sitter-typst commit.
# Requires: docker (tree-sitter-cli uses emscripten/emsdk:4.0.4 to build wasm).
# tree-sitter-cli is pulled in via npm devDependencies.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRAMMAR_REPO="https://github.com/uben0/tree-sitter-typst.git"
GRAMMAR_REF="46cf4ded12ee974a70bf8457263b67ad7ee0379d"
BUILD_DIR="$REPO_ROOT/build/grammar/tree-sitter-typst"
OUTPUT="$REPO_ROOT/resources/tree-sitter-typst.wasm"
TS_BIN="$REPO_ROOT/node_modules/.bin/tree-sitter"

if [[ ! -x "$TS_BIN" ]]; then
  echo "tree-sitter-cli not found at $TS_BIN. Run 'npm install' first." >&2
  exit 1
fi

if [[ ! -d "$BUILD_DIR/.git" ]]; then
  mkdir -p "$(dirname "$BUILD_DIR")"
  git clone "$GRAMMAR_REPO" "$BUILD_DIR"
fi

(
  cd "$BUILD_DIR"
  git fetch --depth=50 origin "$GRAMMAR_REF" || true
  git checkout "$GRAMMAR_REF"
)

mkdir -p "$REPO_ROOT/resources"
"$TS_BIN" build --wasm --output "$OUTPUT" "$BUILD_DIR"
echo "Wrote $OUTPUT"
