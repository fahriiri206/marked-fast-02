// Compares parse.js byte-for-byte with marked 18.1.3 on the practice set and
// on randomly generated edge cases. Practice data lives outside the repo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../parse.js';
import { marked } from '../vendor/marked/marked.esm.js';

const KIT = process.env.MAKEFUN_KIT ?? '/home/ubuntu/work/makefun/markdown-render-speed-02-work/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(join(KIT, 'practice/input/cases.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(KIT, 'practice/reference/expected.json'), 'utf8')).cases;

let pass = 0;
let fail = 0;
for (let i = 0; i < cases.length; i++) {
  const got = parse(cases[i].markdown);
  const want = expected[i].html;
  if (got === want) pass++;
  else {
    fail++;
    if (fail <= 3) {
      let at = 0;
      while (at < got.length && at < want.length && got[at] === want[at]) at++;
      console.error(`FAIL ${cases[i].id} at ${at}: got ${JSON.stringify(got.slice(at, at + 80))} want ${JSON.stringify(want.slice(at, at + 80))}`);
    }
  }
}
console.log(`practice: ${pass}/${cases.length} pass, ${fail} fail`);

// Deterministic fuzz across the constructs marked supports.
let seed = 0x9e3779b9;
function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
const atoms = ['a', 'b', ' ', '\n', '\t', '*', '_', '~', '`', '[', ']', '(', ')', '!', '<', '>', '&', '\\', '#', '-', '+', '|', ':', '"', "'", '\r', '0', '.', '/', '=', '?', 'x@y.z', 'http://x', 'www.a.b', '&amp;', '&#65;', '<!--c-->', '<b>', '</b>', '    ', '\n\n'];
let fuzzFail = 0;
const N = Number(process.env.FUZZ ?? 2000);
for (let i = 0; i < N; i++) {
  let s = '';
  const n = 1 + Math.floor(rnd() * 60);
  for (let j = 0; j < n; j++) s += atoms[Math.floor(rnd() * atoms.length)];
  const got = parse(s);
  const want = marked.parse(s);
  if (got !== want) {
    fuzzFail++;
    if (fuzzFail <= 5) console.error(`FUZZ FAIL ${JSON.stringify(s)}\n got ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`);
  }
}
console.log(`fuzz: ${N - fuzzFail}/${N} pass, ${fuzzFail} fail`);
if (fail || fuzzFail) process.exit(1);
