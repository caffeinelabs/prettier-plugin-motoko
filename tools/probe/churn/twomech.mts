import { createRequire } from 'node:module';
const oldRequire = createRequire('/tmp/churn013/package.json');
const oldP = oldRequire('prettier'),
    oldPl = oldRequire('prettier-plugin-motoko');
const prettier = (await import('prettier')).default;
const plugin = (await import('../../../src/index.ts')).default;
const O = { printWidth: 80, tabWidth: 2, trailingComma: 'none' } as const;
const cases: [string, string][] = [
    [
        'block fits, should stay on one line',
        `func f() { while (c) { i += 1; j += 1; }; };`,
    ],
    [
        'block does not fit, should break',
        `func f() { while (c) { someVeryLongPropertyName := someOtherVeryLongFunctionName(argument1, argument2); }; };`,
    ],
    ['blank right after opening brace', `actor A {\n\n  let x = 1;\n};`],
    [
        'blank between decls (preserved)',
        `actor A {\n  let x = 1;\n\n  let y = 2;\n};`,
    ],
    [
        'two blanks between decls ---> one',
        `actor A {\n  let x = 1;\n\n\n  let y = 2;\n};`,
    ],
];
for (const [name, src] of cases) {
    const a = oldP.format(src + '\n', {
        ...O,
        filepath: 'T.mo',
        plugins: [oldPl],
    });
    const b = await prettier.format(src + '\n', {
        ...O,
        parser: 'motoko-tt-parse',
        plugins: [plugin],
    });
    const one = (t: string) => t.trimEnd().split('\n').join(' ⏎ ');
    console.log(`\n${name}\n  old: ${one(a)}\n  new: ${one(b)}`);
}
