/** Robust form of the qr/common.mo claim: is the new output one item per line where the old packed them? */
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
const packed = (t: string) => {
    // lines that contain several comma-separated items (the fill signature)
    const ls = t.split('\n');
    const multi = ls.filter((l) => (l.match(/,/g) ?? []).length >= 2);
    return {
        lines: ls.length,
        multiline: multi.length,
        maxPerLine: Math.max(...ls.map((l) => (l.match(/,/g) ?? []).length)),
    };
};
const pa = packed(a),
    pb = packed(b);
console.log(
    `old: lines=${pa.lines} lines-with-2+-commas=${pa.multiline} max-commas-on-a-line=${pa.maxPerLine}`,
);
console.log(
    `new: lines=${pb.lines} lines-with-2+-commas=${pb.multiline} max-commas-on-a-line=${pb.maxPerLine}`,
);
console.log(`\nold sample around the packing:`);
console.log(
    a
        .split('\n')
        .slice(106, 112)
        .map((l: string) => '  | ' + l.slice(0, 96))
        .join('\n'),
);
console.log(`\nnew sample at the same construct:`);
console.log(
    b
        .split('\n')
        .slice(106, 116)
        .map((l: string) => '  | ' + l.slice(0, 96))
        .join('\n'),
);
