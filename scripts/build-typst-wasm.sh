#!/usr/bin/env bash
# Build resources/tree-sitter-typst.wasm from the prose-focused grammar fork.
# Requires: docker (tree-sitter-cli uses emscripten/emsdk:4.0.4 to build wasm).
# tree-sitter-cli is pulled in via Bun-managed devDependencies.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRAMMAR_REPO="${GRAMMAR_REPO:-https://github.com/HRKings/tree-sitter-typst-prose.git}"
GRAMMAR_REF="${GRAMMAR_REF:-prose-focus}"
BUILD_DIR="$REPO_ROOT/build/grammar/tree-sitter-typst"
OUTPUT="$REPO_ROOT/resources/tree-sitter-typst.wasm"
TS_BIN="$REPO_ROOT/node_modules/.bin/tree-sitter"

if [[ ! -x "$TS_BIN" ]]; then
  echo "tree-sitter-cli not found at $TS_BIN. Run 'bun install' first." >&2
  exit 1
fi

if [[ ! -d "$BUILD_DIR/.git" ]]; then
  mkdir -p "$(dirname "$BUILD_DIR")"
  git clone "$GRAMMAR_REPO" "$BUILD_DIR"
fi

(
  cd "$BUILD_DIR"
  git remote set-url origin "$GRAMMAR_REPO"
  git fetch --depth=50 origin "$GRAMMAR_REF"
  git checkout --detach FETCH_HEAD
)

mkdir -p "$REPO_ROOT/resources"
"$TS_BIN" build --wasm --output "$OUTPUT" "$BUILD_DIR"
echo "Wrote $OUTPUT"
