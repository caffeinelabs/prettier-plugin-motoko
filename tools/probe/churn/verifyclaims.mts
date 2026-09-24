/** Verify two review claims precisely: the comma-family share, and what actually moves in the 27. */
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
const toks = async (t: string) => {
    try {
        const { root } = await parseTree(t);
        const out: { text: string; inC: boolean }[] = [];
        (function w(n: any, c: boolean) {
            const ic =
                c ||
                (n.nodeType === 'Branch' && String(n.type).includes('comment'));
            if (n.nodeType === 'Token') out.push({ text: n.text, inC: ic });
            for (const ch of n.children ?? [])
                if (ch.nodeType !== 'Text') w(ch, ic);
        })(root, false);
        return out;
    } catch {
        return null;
    }
};
const bag = (a: { text: string; inC: boolean }[]) => {
    const m = new Map<string, number>();
    for (const t of a) m.set(t.text, (m.get(t.text) ?? 0) + 1);
    return m;
};

const fam = new Map<string, number>();
let movedCount = 0;
const movedMech = new Map<string, number>();
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
    const ta = await toks(a),
        tb = await toks(b);
    if (wsEqual || !ta || !tb) continue;
    const ba = bag(ta),
        bb = bag(tb);
    const diff = [...new Set([...ba.keys(), ...bb.keys()])].filter(
        (t) => (ba.get(t) ?? 0) !== (bb.get(t) ?? 0),
    );
    if (!diff.length) {
        // token multiset equal -> this is the "moved" bucket
        movedCount++;
        // what position did the first differing token occupy? Compare the two sequences directly.
        const seqA = ta.map((t) => t.text).filter((t) => t.trim() !== '');
        const seqB = tb.map((t) => t.text).filter((t) => t.trim() !== '');
        let i = 0;
        while (i < seqA.length && i < seqB.length && seqA[i] === seqB[i]) i++;
        const what = `${JSON.stringify(seqA[i])}->${JSON.stringify(seqB[i])}`;
        movedMech.set(what, (movedMech.get(what) ?? 0) + 1);
    } else {
        const codeOnly = diff.filter(
            (t) => !ta.some((x) => x.inC && x.text === t) && t.trim() !== ';',
        );
        if (codeOnly.length === 1 && codeOnly[0].trim() === ',')
            fam.set(',', (fam.get(',') ?? 0) + 1);
        else
            fam.set(
                codeOnly.length ? 'other code token' : 'comment text',
                (fam.get(
                    codeOnly.length ? 'other code token' : 'comment text',
                ) ?? 0) + 1,
            );
    }
}
console.log('non-`;` code-token families (old engine vs source):');
[...fam.entries()]
    .sort((x, y) => y[1] - x[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));
console.log(`\nmoved-bucket files: ${movedCount}`);
console.log('first token that differs in sequence:');
[...movedMech.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 12)
    .forEach(([k, v]) => console.log(`  ${k}  x${v}`));
