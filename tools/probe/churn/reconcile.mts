/** Reconcile: files with equal token multiset but unequal whitespace-stripped bytes (a token MOVED). */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const oldRequire = createRequire(
    join(process.env.CHURN_OLD_HOME ?? '/tmp/churn013', 'package.json'),
);
const oldP = oldRequire('prettier'),
    oldPl = oldRequire('prettier-plugin-motoko');
const prettier = (await import('prettier')).default;
const plugin = (await import('../../../src/index.ts')).default;
const { parse: parseTree } = await import('../../../src/parser/parse.ts');
const O = { printWidth: 80, tabWidth: 2, trailingComma: 'none' } as const;
const roots = [
    join(repoRoot, '..', 'motoko', 'test'),
    join(repoRoot, '..', 'motoko-core', 'src'),
    join(repoRoot, 'tests', 'fixtures'),
];
const SKIP = new Set(['_out', '_build', 'node_modules', '.git']);
const files: string[] = [];
for (const root of roots)
    (function w(d: string) {
        let es;
        try {
            es = readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of es) {
            const p = join(d, e.name);
            if (e.isDirectory()) {
                if (!SKIP.has(e.name)) w(p);
            } else if (e.name.endsWith('.mo')) files.push(p);
        }
    })(root);
files.sort();
const bag = async (t: string) => {
    try {
        const { root } = await parseTree(t);
        const m = new Map<string, number>();
        (function w(n: any) {
            if (n.nodeType === 'Token') m.set(n.text, (m.get(n.text) ?? 0) + 1);
            for (const c of n.children ?? []) if (c.nodeType !== 'Text') w(c);
        })(root);
        return m;
    } catch {
        return null;
    }
};
const eq = (x: Map<string, number> | null, y: Map<string, number> | null) =>
    !!x &&
    !!y &&
    [...new Set([...x.keys(), ...y.keys()])].every(
        (t) => (x.get(t) ?? 0) === (y.get(t) ?? 0),
    );
let moved = 0,
    wsOnly = 0,
    tok = 0;
const movedList: string[] = [];
for (const f of files) {
    const src = readFileSync(f, 'utf8');
    let a: string, b: string;
    try {
        a = oldP.format(src, { ...O, filepath: f, plugins: [oldPl] });
        b = await prettier.format(src, {
            ...O,
            parser: 'motoko-tt-parse',
            plugins: [plugin],
        });
    } catch {
        continue;
    }
    if (a === b) continue;
    const wsEqual = a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
    const bagEqual = eq(await bag(a), await bag(b));
    if (wsEqual) wsOnly++;
    else if (bagEqual) {
        moved++;
        movedList.push(f.replace(repoRoot + '/', '').replace('../', ''));
    } else tok++;
}
console.log(`whitespace-stripped equal (churn.mjs 'layout-only'): ${wsOnly}`);
console.log(
    `token multiset equal but whitespace-stripped unequal (a token MOVED): ${moved}`,
);
console.log(
    `token multiset unequal (churn.mjs 'token-differs' content): ${tok}`,
);
console.log('\nmoved:');
movedList.forEach((f) => console.log('  - ' + f));
