// SPDX-License-Identifier: MIT
//
// Drop-in for marked 18.1.3 with its default options (GFM on, async off).
// parse(markdown) returns exactly the HTML marked.parse(markdown) returns.
// The upstream build is vendored unmodified at vendor/marked/marked.esm.js;
// fast.js is this entry's original Tokenizer overlay.

import { render } from './fast.js';

/** The HTML marked 18.1.3 renders for `markdown` with its default options. */
export function parse(markdown) {
  return render(markdown);
}
