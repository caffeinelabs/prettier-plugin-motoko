/**
 * Orthogonal decomposition of the churn, so the review's claims are measured rather than asserted.
 *
 * Two independent axes, asked of each file separately:
 *   tokens    — is the multiset of non-comment tokens identical? (a content difference)
 *   whitespace— with ALL whitespace removed, are the byte strings identical? (a layout-only difference)
 *
 * The four cells partition the differing files. Token multiset is the right content test because a
 * separator IS a token and its *placement* is layout: a `;` moved to the next line keeps the multiset
 * and changes only whitespace, which is exactly how the two engines spell the same tree.
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

const { parse: parseTree } = await import('../../../src/parser/parse.ts');
// Returns null when the text does not parse — the old engine can emit forms this grammar rejects
// (the documented `leading-ws-bug` family), so "unanalysable" is a real bucket, not a crash.
// Two projections of the same tree, measured separately because they answer different questions:
//   ttoks — the literal token TEXT (identifiers, numbers, punctuation). "same code, respelled?"
//   ttypes— the AST node TYPES. "same tree?"
// They come apart precisely when whitespace is load-bearing to the grammar, which the
// `leading-ws-bug` (grammar-deviations.md item 4) says it is for `List <T>` / `List<T>`.
const proj = async (
    t: string,
): Promise<{ ttoks: string; ttypes: string } | null> => {
    try {
        const { root } = await parseTree(t);
        const ttoks: string[] = [],
            ttypes: string[] = [];
        (function w(n: any) {
            if (n.nodeType === 'Token')
                ttoks.push(n.text); // the literal spelling: `;`, `abc`, `+`
            else if (n.nodeType === 'Branch') ttypes.push(n.type);
            for (const c of n.children ?? []) if (c.nodeType !== 'Text') w(c);
        })(root);
        return {
            ttoks: ttoks.sort().join(' '),
            ttypes: ttypes.sort().join(' '),
        };
    } catch {
        return null;
    }
};
const despace = (t: string) => t.replace(/\s+/g, '');

const cell: Record<string, string[]> = {
    'layout-only': [],
    'respell-changes-parse': [],
    'token-content-only': [],
    'tokens-differ': [],
    unanalysable: [],
};
let identical = 0,
    comparable = 0;
const semiOnly: string[] = [];
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
    comparable++;
    if (a === b) {
        identical++;
        continue;
    }
    const pa = await proj(a),
        pb = await proj(b);
    if (pa === null || pb === null) {
        cell['unanalysable'].push(f);
        continue;
    }
    const sameToks = pa.ttoks === pb.ttoks,
        sameTree = pa.ttypes === pb.ttypes;
    if (sameToks && sameTree) cell['layout-only'].push(f);
    else if (sameToks && !sameTree) cell['respell-changes-parse'].push(f);
    else if (!sameToks && sameTree) cell['token-content-only'].push(f);
    else cell['tokens-differ'].push(f);
    if (!sameToks) {
        const sa = await proj(a.replace(/;/g, '')),
            sb = await proj(b.replace(/;/g, ''));
        if (sa && sb && sa.ttoks === sb.ttoks && sa.ttypes === sb.ttypes)
            semiOnly.push(f);
    }
}

const name = (p: string) => p.replace(repoRoot + '/', '').replace('../', '');
const out = [
    '# orthogonal decomposition of the churn',
    '',
    `${comparable} files both engines formatted; ${identical} byte-identical; ${comparable - identical} differ.`,
    '',
    '| cell | files | meaning |',
    '| --- | ---: | --- |',
    `| layout-only | ${cell['layout-only'].length} | token text and node types both equal |`,
    `| respell-changes-parse | ${cell['respell-changes-parse'].length} | token text equal, node types differ — spacing moved the parse |`,
    `| token-content-only | ${cell['token-content-only'].length} | token text differs, node types equal |`,
    `| tokens-differ | ${cell['tokens-differ'].length} | both differ |`,
    `| unanalysable | ${cell['unanalysable'].length} | one engine's output fails the grammar |`,
    '',
    `## narrowest content difference: deleting every \`;\` from both equalises the multiset`,
    '',
    `${semiOnly.length} differing files. The remainder: ${comparable - identical - semiOnly.length}.`,
    '',
    '## samples',
    '',
    ...[
        'layout-only',
        'respell-changes-parse',
        'token-content-only',
        'tokens-differ',
        'unanalysable',
    ].flatMap((k) => [
        `### ${k}`,
        '',
        ...cell[k].slice(0, 12).map((f) => `- ${name(f)}`),
        '',
    ]),
];
writeFileSync(join(repoRoot, '.probe', 'explain.md'), out.join('\n'));
console.log(out.join('\n'));
