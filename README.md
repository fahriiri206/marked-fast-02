# marked-fast-02

[![markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/fahriiri206/marked-fast-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard)
[![reward](https://make.fun/badge/markdown-render-speed-02/fahriiri206/marked-fast-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

A dependency-free, synchronous drop-in for **marked 18.1.3** with its default
options (GFM on, async off), built for the make.fun
[markdown-render-speed-02](https://make.fun/bounty/markdown-render-speed-02)
bounty. `parse(markdown)` returns exactly the HTML marked renders for the same
input, byte for byte.

## Layout

| File | Role |
| --- | --- |
| `main.ts` | Entrypoint. Reads `MAKEFUN_INPUT_DIR/cases.json`, renders each case independently in order, writes `MAKEFUN_OUTPUT_DIR/html.json`. |
| `parse.js` | Public `parse(markdown)` used by the driver and tests. |
| `fast.js` | This entry's original performance overlay: `FastTokenizer` and `FastLexer`. |
| `vendor/marked/marked.esm.js` | Upstream marked 18.1.3, vendored **unmodified**. |
| `vendor/marked/LICENSE`, `NOTICE` | Upstream marked licence and provenance, unchanged. |
| `test/correctness.mjs` | Practice-set and deterministic fuzz comparison against upstream marked. |
| `test/bench.mjs` | Fresh-process corpus CPU benchmark. |

## Implementation

Upstream marked is kept exactly as shipped. The speedup is an overlay that
subclasses its exported `Tokenizer` and `Lexer`; it never edits or monkeypatches
the vendored module. `render()` builds a fresh options object per call, so no
state is carried between cases.

`FastTokenizer`:

- **First-character dispatch.** Every anchored tokenizer regex is gated on the
  character it must start with (after at most three spaces for block rules), so
  ordinary text no longer runs ten inline regexes per token. `emStrong` and
  `del` are intentionally left inherited: marked's mask pre-pass keys off
  whether those two methods were overridden.
- **Rewritten `list`.** Keeps marked's token shape and rules, but replaces
  per-line `split`/`trim`/`replace` callbacks with plain scans, expands leading
  tabs allocation-free, and only runs the block-start regexes that the current
  line's first character can trigger.
- **Cheap block gates** for `lheading` and `table`, which need a `=`/`-`
  underline or a dash in the delimiter row respectively.

`FastLexer`:

- **Plain inline-group fast path.** A group that cannot contain an inline
  construct becomes one text token, skipping the private mask pre-pass and the
  tokenizer dispatch loop. The guard is deliberately conservative and covers
  backtick, backslash, `<`, `!`, `[`, `*`, `_`, `~`, `&`, newline, `@`, and the
  `http`/`ftp`/`www.`/`mailto:`/`xmpp:` triggers. Empty groups return the token
  list untouched, and `inRawBlock`, `escaped`, text merging and
  `linkParenPossible` follow upstream's semantics exactly.

The driver calls `new FastLexer(options).lex(markdown)` rather than the static
`Lexer.lex`, because the static method hardcodes the base constructor.

## Run

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

`main.ts` defaults to `/input` and `/output`, matching the sandbox.

## Test

```sh
node test/correctness.mjs   # practice corpus + deterministic fuzz
node test/bench.mjs         # fresh-process corpus CPU timing
```

`test/correctness.mjs` compares against upstream marked directly and against the
kit's `expected.json`; set `MAKEFUN_KIT` to the unpacked kit directory.

## Measured locally (cautiously)

All runs were on a shared, loaded 2-core host with a live screen recorder
running, so treat these as indicative rather than official numbers.

- A single interleaved 5-round fresh-process run of the real drivers reported a
  median **3542.9 ms** CPU for the kit baseline and **3195.6 ms** for this entry,
  about a **9.8% reduction**, with byte-identical `html.json`.
- An earlier official-image 1-CPU Docker run (before the `FastLexer` fix)
  reported **4000.6 ms** baseline vs **3734.1 ms** candidate over 7 rounds, a
  6.7% reduction.

No claim is made that these transfer exactly to the grading host; the official
heat is authoritative.

## Provenance and licence

- Upstream: **marked 18.1.3**, MIT, Copyright (c) 2018-2026 MarkedJS and
  Copyright (c) 2011-2018 Christopher Jeffrey. The vendored
  `vendor/marked/marked.esm.js` is byte-for-byte the npm package build
  (`sha256 e76f3b37046a5d294159872002e5f6fcda8ed232e1be45ff76b3863f2919dae3`).
  Its `LICENSE` and `NOTICE` are included unchanged.
- `fast.js` is original code written for this entry: an overlay over marked's
  public classes, not a copy or reformatting of marked's source. It is MIT
  licensed under the repository `LICENSE`.
- This repository is MIT licensed. See `LICENSE` (`SPDX-License-Identifier: MIT`).

The implementation is stateless across cases, reads no clock, network, native
code or WebAssembly, and contains no precomputed case output or cross-case
cache.
