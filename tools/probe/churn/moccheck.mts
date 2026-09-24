/** Re-measure the fixture's cases against moc: which spellings are *syntax* errors? */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import prettier from 'prettier';
import plugin from '../../../src/index.ts';

const MOC = '/tmp/moctar/moc';
mkdirSync('/tmp/mocfixture', { recursive: true });

const CASES: [string, string][] = [
    ['parExp', 'let parExp = f(\n    a // c\n    ,\n    b\n);\n'],
    ['arrayExp', 'let arrayExp = [\n    a // c\n    ,\n    b\n];\n'],
    ['trailingComma', 'let trailingComma = f(\n    a\n    // c\n    ,\n);\n'],
    ['fileSeam', 'let fileSeam = 1 // c\n;\n'],
    ['angleSeam', 'let angleSeam = L.make<\n    A // c\n    ,\n    B\n>();\n'],
    ['attachedComment', 'let attachedComment = f(a, b // trailing\n);\n'],
    ['angleCloseAttached', 'type F<Alpha, Beta /*c*/> = Alpha;\n'],
    ['angleCloseOwnLine', 'type F<Alpha, Beta\n  /*c*/> = Alpha;\n'],
    // The wrong spelling the fix replaced, as a control: it must NOT be a syntax error,
    // which is why the guard rather than moc is what caught the original bug.
    [
        'control: attached separator (the old output)',
        'let parExp = f(\n    a // c,\n    b\n);\n',
    ],
    ['control: real syntax error', 'let x = ;\n'],
];

for (const [name, src] of CASES) {
    const path = `/tmp/mocfixture/${name.replace(/[^a-z]/gi, '_')}.mo`;
    // Confirm the printer accepts it first, then hand its *output* to moc.
    let printed: string;
    try {
        printed = await prettier.format(src, {
            parser: 'motoko-tt-parse',
            plugins: [plugin],
            printWidth: 80,
        });
    } catch (e: any) {
        console.log(
            `${name.padEnd(42)} PRINTER THREW: ${e.message.split('\n')[0]}`,
        );
        continue;
    }
    writeFileSync(path, printed);
    const r = spawnSync(MOC, ['-dp', path], { encoding: 'utf8' });
    const errs = (r.stderr + r.stdout)
        .split('\n')
        .filter((l) => l.includes('syntax error')).length;
    console.log(
        `${name.padEnd(42)} exit=${r.status} syntax-errors=${errs}  ${JSON.stringify(printed)}`,
    );
}
