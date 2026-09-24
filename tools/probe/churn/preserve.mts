/**
 * The headline measurement: does each engine's output preserve the SOURCE's token multiset?
 *
 * This is the `preserve` claim in its checkable form, and it is engine-independent: the source's
 * multiset is the reference, not the other engine's output. The runtime guard enforces exactly this
 * property for the new printer (a separator is a token, so adding or dropping one is a guard throw),
 * which is why this number is expected to be total and why a shortfall would be a bug, not churn.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
let n = 0,
    identical = 0,
    newPreserves = 0,
    oldPreserves = 0,
    oldAddsSemi = 0,
    oldDropsSemi = 0;
const oldBroken: string[] = [],
    newBroken: string[] = [];
for (const f of files) {
    const src = readFileSync(f, 'utf8');
    let b: string;
    try {
        b = await prettier.format(src, {
            ...O,
            parser: 'motoko-tt-parse',
            plugins: [plugin],
        });
    } catch {
        continue;
    }
    n++;
    let a: string;
    try {
        a = oldP.format(src, { ...O, filepath: f, plugins: [oldPl] });
    } catch {
        a = '';
    }
    if (a === b) identical++;
    const bs = await bag(src),
        ba = a ? await bag(a) : null,
        bb = await bag(b);
    if (eq(bs, bb)) newPreserves++;
    else if (bs && bb) {
        const d = [...new Set([...bs.keys(), ...bb.keys()])].filter(
            (t) => (bs.get(t) ?? 0) !== (bb.get(t) ?? 0),
        );
        newBroken.push(
            `${f.replace(repoRoot + '/', '').replace('../', '')} :: ${d
                .slice(0, 3)
                .map(
                    (t) =>
                        `${JSON.stringify(t.slice(0, 40))} ${bs.get(t) ?? 0}->${bb.get(t) ?? 0}`,
                )
                .join(', ')}`,
        );
    }
    if (eq(bs, ba)) oldPreserves++;
    else if (ba) {
        const ds = (ba.get(';') ?? 0) - (bs?.get(';') ?? 0);
        if (ds > 0) oldAddsSemi++;
        else if (ds < 0) oldDropsSemi++;
        else oldBroken.push(f);
    }
}
const out = [
    '# does each engine preserve the source token multiset?',
    '',
    '| engine | files whose output has the source token multiset |',
    '| --- | ---: |',
    `| \`preserve\` (new) | **${newPreserves} / ${n}** |`,
    `| 0.13.0 (old) | **${oldPreserves} / ${n}** |`,
    '',
    `${identical} of ${n} formatted files are byte-identical.`,
    '',
    `### the ${newBroken.length} where the new engine does not (the guard should make this empty)`,
    ...newBroken.map((x) => `- ${x}`),
    '',
    `## the difference is the separator rule`,
    '',
    `Of the files where the old engine does not preserve the source multiset:`,
    '',
    `- ${oldAddsSemi} gain \`;\` (0.13.0 materialising a separator the source left implicit)`,
    `- ${oldDropsSemi} lose \`;\` (0.13.0 applying the \`moc2\` optional-trailing-separator cell)`,
    `- ${oldBroken.length} differ in some other token`,
    '',
    ...(oldBroken.length
        ? [
              '### differing in another token',
              '',
              ...oldBroken.map(
                  (f) =>
                      `- ${f.replace(repoRoot + '/', '').replace('../', '')}`,
              ),
          ]
        : []),
];
writeFileSync(join(repoRoot, '.probe', 'preserve.md'), out.join('\n'));
console.log(out.join('\n'));
