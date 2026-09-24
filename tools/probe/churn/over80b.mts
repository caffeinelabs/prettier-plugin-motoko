/** printWidth adherence: count lines STRICTLY over 80, and show the survivors' content. */
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
const over = (t: string) => t.split('\n').filter((l) => l.length > 80);
for (const f of process.argv.slice(2)) {
    const src = readFileSync(f, 'utf8');
    let a: string, b: string;
    try {
        a = oldP.format(src, { ...O, filepath: f, plugins: [oldPl] });
    } catch {
        a = '';
    }
    try {
        b = await prettier.format(src, {
            ...O,
            parser: 'motoko-tt-parse',
            plugins: [plugin],
        });
    } catch {
        b = '';
    }
    if (!a || !b) {
        console.log(`${f.split('/').pop()}: an engine threw`);
        continue;
    }
    const oa = over(a),
        ob = over(b);
    console.log(
        `\n${f.split('/').slice(-2).join('/')}  strictly-over-80: old=${oa.length} new=${ob.length}`,
    );
    ob.slice(0, 6).forEach((l) =>
        console.log(`   new ${l.length}: ${JSON.stringify(l.slice(0, 88))}`),
    );
}
