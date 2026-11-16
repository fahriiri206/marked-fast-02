// Fresh-process CPU benchmark over the practice corpus.
// Runs parse() over all cases; prints wall ms and process CPU ms.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../parse.js';
const KIT = process.env.MAKEFUN_KIT ?? '/home/ubuntu/work/makefun/markdown-render-speed-02-work/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(join(KIT, 'practice/input/cases.json'), 'utf8'));
const t0 = process.hrtime.bigint();
const c0 = process.cpuUsage();
let chars = 0;
for (const c of cases) chars += parse(c.markdown).length;
const t1 = process.hrtime.bigint();
const c1 = process.cpuUsage(c0);
console.log(JSON.stringify({ wall_ms: Number(t1 - t0) / 1e6, cpu_ms: (c1.user + c1.system) / 1000, chars }));
