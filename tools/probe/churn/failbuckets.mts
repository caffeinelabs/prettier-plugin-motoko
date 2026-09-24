/**
 * The failure buckets the churn report counts but does not name: files where the new printer THROWS
 * while the old one did not ("new-error"), and files where the new printer's output does not
 * re-parse. Both are potential regressions, unlike the layout churn. This names them.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../../../src/parser/parse.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const oldRequire = createRequire(
    join(process.env.CHURN_OLD_HOME ?? '/tmp/churn013', 'package.json'),
);
const oldPrettier = oldRequire('prettier');
const oldPlugin = oldRequire('prettier-plugin-motoko');
const prettier = (await import('prettier')).default;
const plugin = (await import('../../../src/index.ts')).default;
const OPT = { printWidth: 80, tabWidth: 2, trailingComma: 'none' } as const;

const files: string[] = [];
function walkDir(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) {
            if (!/node_modules|\.git|\.mops|target|dist/.test(e.name))
                walkDir(p);
        } else if (e.name.endsWith('.mo')) files.push(p);
    }
}
for (const r of process.argv.slice(2)) walkDir(resolve(r));
files.sort();

const newError: string[] = [],
    noReparse: string[] = [],
    bothError: string[] = [];
for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(repoRoot, f);
    let oldOk = true,
        newOk = true,
        out = '';
    try {
        oldPrettier.format(src, { ...OPT, filepath: f, plugins: [oldPlugin] });
    } catch {
        oldOk = false;
    }
    try {
        out = await prettier.format(src, {
            ...OPT,
            parser: 'motoko-tt-parse',
            plugins: [plugin],
        });
    } catch (e: any) {
        newOk = false;
        newError.push(
            `${rel}  <<${String(e.message).split('\n')[0].slice(0, 70)}>>`,
        );
    }
    if (!oldOk && !newOk) {
        bothError.push(rel);
        continue;
    }
    if (oldOk && newOk) {
        try {
            await parse(out);
        } catch (e: any) {
            noReparse.push(
                `${rel}  <<${String(e.message).split('\n')[0].slice(0, 70)}>>`,
            );
        }
    }
}

const out = [
    '# failure buckets',
    '',
    `scanned ${files.length} files`,
    '',
    `## new-error (old formatted, new THREW) — ${newError.length}`,
    '',
    ...newError.slice(0, 40).map((f) => '  ' + f),
    '',
    `## new output does not re-parse — ${noReparse.length}`,
    '',
    ...noReparse.slice(0, 40).map((f) => '  ' + f),
    '',
    `## both threw (not a regression) — ${bothError.length}`,
    '',
    ...bothError.slice(0, 20).map((f) => '  ' + f),
];
writeFileSync(join(repoRoot, '.probe', 'failbuckets.md'), out.join('\n'));
console.log(out.join('\n'));
