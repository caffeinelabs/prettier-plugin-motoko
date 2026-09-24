/** Are all 15 'unanalysable' files the OLD engine's failing output, or does the new engine contribute? */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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
const files = [
    'test/fail/enhanced-migration/enh-mig-test3/m1.mo',
    'test/fail/null-coalesce.mo',
    'test/run-drun-non-ci/test-cost/test-cost-http.mo',
    'test/run-drun/gc-random-test/buffer.mo',
    'test/run-drun/migration-paths/new-installer.mo',
    'test/run-drun/stabilize-service/version1.mo',
    'test/run-drun/unsupported-more.mo',
    'test/run-drun/upgrade-recursive-type/version1.mo',
    'test/run-drun/upgrade-service/version1.mo',
    'test/run/array-iter-max.mo',
    'test/run/case-ergonomics.mo',
    'test/run/null-coalesce.mo',
    'test/run-drun/do-async-nested.mo',
    'test/run-drun/do-async-rec.mo',
    'test/perf/qr/trie.mo',
];
let oldBad = 0,
    newBad = 0;
for (const rel of files) {
    const f = join(repoRoot, '..', 'motoko', rel);
    let src;
    try {
        src = readFileSync(f, 'utf8');
    } catch {
        console.log(`(missing) ${rel}`);
        continue;
    }
    let a: string | null = null,
        b: string | null = null;
    try {
        a = oldP.format(src, { ...O, filepath: f, plugins: [oldPl] });
    } catch {}
    try {
        b = await prettier.format(src, {
            ...O,
            parser: 'motoko-tt-parse',
            plugins: [plugin],
        });
    } catch {}
    const okOld =
        a === null
            ? false
            : await parseTree(a).then(
                  () => true,
                  () => false,
              );
    const okNew =
        b === null
            ? false
            : await parseTree(b).then(
                  () => true,
                  () => false,
              );
    if (!okOld) oldBad++;
    if (!okNew) newBad++;
    console.log(
        `${!okOld ? 'OLD-FAILS' : 'old ok   '} ${!okNew ? 'NEW-FAILS' : 'new ok   '}  ${rel}`,
    );
}
console.log(
    `\nold engine output fails the grammar: ${oldBad}   new engine: ${newBad}`,
);
