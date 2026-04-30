# Typst parser spike — go/no-go report

**Branch:** `spike/tree-sitter-typst`
**Date:** 2026-04-30
**Goal:** decide whether to replace the current semantic-token-based extractor (`@myriaddreamin/typst-ts-parser`) with a real syntax tree from `web-tree-sitter` + a vendored `uben0/tree-sitter-typst` grammar.

## Decision

**Go**, with caveats on grammar maturity. The packaging story is sane, the artifact is small, the new builder passes the existing test corpus byte-for-byte equivalent to the old one, and the upstream grammar surfaces real syntactic categories instead of inferred token classes. Recommend a follow-up plan to: (a) make the new builder the default, (b) drop `@myriaddreamin/typst-ts-parser`, (c) extend fixtures to cover constructs the semantic-token extractor mishandles.

## What was built

1. **Vendored grammar artifact** — `resources/tree-sitter-typst.wasm` (760 KB), built from `uben0/tree-sitter-typst@46cf4ded` via `tree-sitter build --wasm` (uses `emscripten/emsdk:4.0.4` under Docker).
2. **Reproducible build script** — `scripts/build-typst-wasm.sh`. Pulls grammar at pinned commit, runs `tree-sitter-cli` (npm devDep, pinned to `0.25.10` to ABI-match `web-tree-sitter@0.25.10`).
3. **New builder** — `src/TypstTreeSitterAnnotatedTextBuilder.ts`. Same `build(text): Promise<IAnnotatedtext>` shape as the old one. Static `init(wasmPath)` loads the grammar once.
4. **Activation wiring** — `src/extension.ts:activate()` is now `async` and calls `init()` when the spike flag is set, before constructing `Linter`.
5. **Builder dispatch** — `src/Linter.ts` selects builder via `process.env.LTL_TREE_SITTER === "1"`. Spike-only flag; remove on merge.
6. **Test glue** — `test/suite/linter.typst.test.ts:suiteSetup` calls `init()` when the flag is set so the in-suite Linter instance can build.

## Verification

| Run                              | Tests | Result |
| -------------------------------- | ----- | ------ |
| Default (`@myriaddreamin/...`)   | 7/7   | pass   |
| `LTL_TREE_SITTER=1` (web-tree-sitter) | 7/7 | pass |

Same fixtures (`test-fixtures/workspace/typst/{basic,advanced}.typ`), same assertions on prose vs markup partitioning. The new builder passes every existing assertion. No new fixtures added in this spike — to be added once the new builder is the default, since the existing fixtures already cover headings, paragraphs, raw blocks, code, math, comments, lists, function calls, and link constructs.

## Cost

| Metric                                | Before                    | After                                        | Delta    |
| ------------------------------------- | ------------------------- | -------------------------------------------- | -------- |
| `dist/extension.js` (production)      | ~640 KB                   | 648 KB                                       | ~+8 KB   |
| Bundled `tree-sitter.wasm` (runtime)  | —                         | 201 KB                                       | +201 KB  |
| Vendored grammar `tree-sitter-typst.wasm` | —                     | 760 KB                                       | +760 KB  |
| `node_modules` install (devDep `tree-sitter-cli`) | n/a           | required for rebuilding wasm                 | ship-only when re-building |
| Activation latency                    | sync                      | one extra `await Parser.init()` + `Language.load(wasm)` (only when flag set) | small one-time |

VSIX size impact: roughly +960 KB. Acceptable for a feature that improves prose-extraction fidelity.

## ABI pinning

`web-tree-sitter@0.25.10` (runtime) and `tree-sitter-cli@0.25.10` (devDep) match. tree-sitter requires the wasm grammar's ABI version to be ≤ the runtime's; lockstep major+minor is the safe stance. CI should fail if either drifts. The build script pulls the grammar at a fixed commit so re-builds are deterministic.

## Grammar caveats found

`uben0/tree-sitter-typst` README warns the grammar may have bugs and that Typst has no official tree-sitter grammar. During this spike no behavioral problems showed up against the existing fixtures, but coverage is narrow:

- The `code` / `call` family is recursive and contains nested `content` blocks that hold prose (e.g. `#strong[hello world]`). The new builder treats `content` as a recurse-into container, which works for the existing fixtures, but the grammar's handling of edge cases (nested calls, math inside content, function definitions with content args) is not exhaustively probed.
- `parbreak` is treated as markup (no prose). In the old extractor, blank lines fold into the surrounding span via `interpretMarkup`, which preserves sentence boundaries. The new builder relies on the fact that the source text *between* prose `text` nodes already contains the literal newlines, and those characters end up in the markup runs that wrap each prose annotation — same effect as the old behavior.
- Math-mode prose (`math` → `formula`) is fully excluded. Same as the old extractor.

Bugs to watch for in a follow-up: incremental editing fidelity (we currently re-parse every time), behavior on very large files, behavior on syntactically-broken Typst (the parser produces an error-tolerant tree; verify error nodes don't break offset accounting).

## Why not the alternatives

| Option | Verdict | Reason |
| ------ | ------- | ------ |
| `tree-sitter` native binding | no-go | node-gyp + Electron ABI mismatch in extension host |
| `typst-syntax` crate via wasm-bindgen | risky | best fidelity, worst packaging — would need to ship and maintain a custom Rust→WASM wrapper |
| `typst.js` / `@myriaddreamin/typst.ts` | no-go | compile-only, no AST/spans exposed |
| Tinymist (LSP) | no-go | not embeddable as library |

`web-tree-sitter` won on packaging sanity: pure WASM, works in extension host (VS Code itself ships `@vscode/tree-sitter-wasm`), byte-offset round-trip is free.

## Follow-up plan (not done in this spike)

1. Make `TypstTreeSitterAnnotatedTextBuilder` the default; remove the `LTL_TREE_SITTER` flag.
2. Remove `@myriaddreamin/typst-ts-parser` from `dependencies`; delete `src/TypstAnnotatedTextBuilder.ts`.
3. Move the small shared helpers (`buildAnnotatedText`, `buildAnnotation`, `interpretMarkup`, `isWordCharacter`) out of the new builder into a `src/AnnotatedTextHelpers.ts` so they're reusable / testable.
4. Add fixtures that target known weak spots of the old extractor (nested calls, math inside markup, unusual link syntaxes, multi-line raw blocks adjacent to prose).
5. Decide whether to keep `init()` in `extension.ts:activate` always (small one-time cost) or behind a config key.
6. CI: run `scripts/build-typst-wasm.sh` and diff against the vendored artifact; fail on drift, so the artifact stays auditable.
