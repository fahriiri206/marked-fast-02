// Entrypoint for make.fun markdown-render-speed-02.
// Reads cases.json from MAKEFUN_INPUT_DIR, renders each case independently in order,
// and writes html.json (a JSON array of HTML strings) to MAKEFUN_OUTPUT_DIR.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as { id: string; markdown: string }[];

if (!Array.isArray(cases)) throw new Error('cases.json must hold a JSON array of { id, markdown }');
for (let i = 0; i < cases.length; i++) {
  if (typeof cases[i]?.markdown !== 'string') {
    throw new Error(`cases.json entry ${i} has no string markdown`);
  }
}

const html: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) html[i] = parse(cases[i].markdown);

writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
