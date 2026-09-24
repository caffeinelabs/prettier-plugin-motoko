/** Decisive: which engine emits the trailing separator before a close? Counts, on minimal inputs. */
import { createRequire } from 'node:module';
import { join } from 'node:path';
const oldRequire = createRequire(
    join(process.env.CHURN_OLD_HOME ?? '/tmp/churn013', 'package.json'),
);
const oldP = oldRequire('prettier'),
    oldPl = oldRequire('prettier-plugin-motoko');
const prettier = (await import('prettier')).default;
const plugin = (await import('../../../src/index.ts')).default;
const O = { printWidth: 80, tabWidth: 2, trailingComma: 'none' } as const;
const n = (t: string) => (t.match(/;/g) ?? []).length;
const cases = [
    'let o = { a = 1 };',
    'let o = { a = 1 ; };',
    'let o = { a = 1; };',
    'let f = func() { 1 };',
    'let f = func() { 1; };',
    'actor { public func g() : async () { 1 } };',
    'let a = [1, 2, 3];',
    'let t = (1, 2);',
    'if (x) { 1 } else { 2 };',
    'let r = { a = 1; b = 2 };',
];
for (const src of cases) {
    let a: string, b: string;
    try {
        a = oldP.format(src + '\n', {
            ...O,
            filepath: 'x.mo',
            plugins: [oldPl],
        });
    } catch (e) {
        a = `THREW: ${(e as Error).message.slice(0, 60)}`;
    }
    try {
        b = await prettier.format(src + '\n', {
            ...O,
            parser: 'motoko-tt-parse',
            plugins: [plugin],
        });
    } catch (e) {
        b = `THREW: ${(e as Error).message.slice(0, 60)}`;
    }
    const same = a === b;
    const mark = same ? 'same' : `old=${n(a)} new=${n(b)}`;
    console.log(
        `\nIN   ${src}\nOLD  ${JSON.stringify(a)}\nNEW  ${JSON.stringify(b)}\n  -> ${mark}`,
    );
}
