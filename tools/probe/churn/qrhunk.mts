/** Verify the qr/common.mo hunk claim: the two largest hunks really are the fill->one-per-line rule. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const oldRequire = createRequire(
    join(process.env.CHURN_OLD_HOME ?? '/tmp/churn013', 'package.json'),
);
const oldP = oldRequire('prettier'),
    oldPl = oldRequire('prettier-plugin-motoko');
const prettier = (await import('prettier')).default;
const plugin = (await import('../../../src/index.ts')).default;
const O = { printWidth: 80, tabWidth: 2, trailingComma: 'none' } as const;
const f = process.argv[2];
const src = readFileSync(f, 'utf8');
const a = oldP.format(src, { ...O, filepath: f, plugins: [oldPl] });
const b = await prettier.format(src, {
    ...O,
    parser: 'motoko-tt-parse',
    plugins: [plugin],
});
const la = a.split('\n'),
    lb = b.split('\n');
console.log(`old lines=${la.length} new lines=${lb.length}`);
// Find the longest run of consecutive lines where the two sequences diverge, by anchoring on
// lines that appear in both in order (a longest-common-subsequence-free heuristic: diff by
// aligning unique short lines).
// A minimal LCS-free diff: anchor on lines that appear in both, in order, by hashing. Good enough
// to rank changed runs by size, which is all the claim needs.
const common = new Set<string>();
{
    const seen = new Map<string, number>();
    for (const l of la) seen.set(l, (seen.get(l) ?? 0) + 1);
    for (const l of lb) if (seen.has(l)) common.add(l);
}
const res: { added?: boolean; removed?: boolean; value: string }[] = [];
{
    let i = 0,
        j = 0;
    while (i < la.length || j < lb.length) {
        if (i < la.length && j < lb.length && la[i] === lb[j]) {
            res.push({ value: la[i] + '\n' });
            i++;
            j++;
            continue;
        }
        if (j < lb.length && la[i] !== lb[j] && !common.has(lb[j])) {
            res.push({ added: true, value: lb[j] + '\n' });
            j++;
            continue;
        }
        if (i < la.length && !common.has(la[i])) {
            res.push({ removed: true, value: la[i] + '\n' });
            i++;
            continue;
        }
        if (i < la.length && j < lb.length) {
            res.push({ removed: true, value: la[i] + '\n' });
            i++;
            res.push({ added: true, value: lb[j] + '\n' });
            j++;
            continue;
        }
        if (i < la.length) {
            res.push({ removed: true, value: la[i] + '\n' });
            i++;
        } else {
            res.push({ added: true, value: lb[j] + '\n' });
            j++;
        }
    }
}
// Rank changed runs by size, tracking the source line each side starts at.
let o = 1,
    n = 1,
    i = 0;
const runs: { aStart: number; aLen: number; bStart: number; bLen: number }[] =
    [];
while (i < res.length) {
    if (!res[i].added && !res[i].removed) {
        const c = res[i].value.split('\n').length - 1;
        o += c;
        n += c;
        i++;
        continue;
    }
    const aStart = o,
        bStart = n;
    let aLen = 0,
        bLen = 0;
    while (i < res.length && (res[i].added || res[i].removed)) {
        const c = res[i].value.split('\n').length - 1;
        if (res[i].removed) aLen += c;
        else bLen += c;
        i++;
    }
    o += aLen;
    n += bLen;
    runs.push({ aStart, aLen, bStart, bLen });
}
console.log(`changed runs=${runs.length}`);
runs.sort((x, y) => y.aLen + y.bLen - (x.aLen + x.bLen))
    .slice(0, 3)
    .forEach((h) =>
        console.log(
            `  old[${h.aStart}:${h.aStart + h.aLen}] -> new[${h.bStart}:${h.bStart + h.bLen}]`,
        ),
    );
