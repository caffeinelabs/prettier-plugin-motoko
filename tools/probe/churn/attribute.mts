/** Which engine's output fails the grammar, and what is the one file where respacing moved the parse? */
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
const proj = async (t: string) => {
    try {
        const { root } = await parseTree(t);
        const tk: string[] = [],
            ty: string[] = [];
        (function w(n: any) {
            if (n.nodeType === 'Token') tk.push(n.text);
            else if (n.nodeType === 'Branch') ty.push(n.type);
            for (const c of n.children ?? []) if (c.nodeType !== 'Text') w(c);
        })(root);
        return { tk: tk.sort().join(' '), ty: ty.sort().join(' ') };
    } catch {
        return null;
    }
};
let oldFails = 0,
    newFails = 0,
    bothFail = 0;
const respell: string[] = [];
for (const f of files) {
    const src = readFileSync(f, 'utf8');
    let a: string, b: string;
    try {
        a = oldP.format(src, { ...O, filepath: f, plugins: [oldPl] });
    } catch {
        continue;
    }
    try {
        b = await prettier.format(src, {
            ...O,
            parser: 'motoko-tt-parse',
            plugins: [plugin],
        });
    } catch {
        continue;
    }
    if (a === b) continue;
    const pa = await proj(a),
        pb = await proj(b);
    if (!pa && !pb) {
        bothFail++;
        continue;
    }
    if (!pa) {
        oldFails++;
        continue;
    }
    if (!pb) {
        newFails++;
        console.log('NEW ENGINE OUTPUT FAILS GRAMMAR: ' + f);
        continue;
    }
    if (pa.tk === pb.tk && pa.ty !== pb.ty)
        respell.push(f.replace(repoRoot + '/', '').replace('../', ''));
}
console.log(
    `old output fails grammar: ${oldFails}   new output fails: ${newFails}   both: ${bothFail}`,
);
console.log(`respell-changes-parse files: ${respell.length}`);
respell.forEach((r) => console.log('  - ' + r));
