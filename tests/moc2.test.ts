import prettier from 'prettier';
import { describe, expect, test } from 'vitest';

import plugin from '../src/index.ts';

const MOC2: prettier.Options = {
    parser: 'motoko',
    plugins: [plugin],
    motokoSyntax: 'moc2',
} as prettier.Options;

const PRESERVE: prettier.Options = { parser: 'motoko', plugins: [plugin] };

const format = (source: string) => prettier.format(source, MOC2);

const REWRITES: [string, string, string][] = [
    ['if branches are braced', 'if (c) x else y;', 'if c { x } else { y };'],
    [
        'an else-if chain stays a chain',
        'let a = if (c) 1 else if (d) 2 else { 3 };',
        'let a = if c { 1 } else if d { 2 } else { 3 };',
    ],
    ['while', 'while (c) f();', 'while c { f() };'],
    ['for', 'for (x in xs.values()) f(x);', 'for x in xs.values() { f(x) };'],
    [
        'loop keeps its trailing condition',
        'loop f() while (c);',
        'loop { f() } while (c);',
    ],
    ['catch', 'try f() catch e g();', 'try f() catch e { g() };'],
    [
        'case arms, separators and patterns',
        'switch (x) { case (null) 0; case (?y) { y }; case (#t z) z; case (#u) 1 };',
        'switch x { case null { 0 } case ?y { y } case #t(z) { z } case #u { 1 } };',
    ],
];

const KEPT: [string, string][] = [
    ['a tuple head', 'switch (a, b) { case (_, _) {} };'],
    ['a record in the head', 'if ({ a = 1 }.a == 1) { 1 } else { 2 };'],
    ['a juxtaposed application in the head', 'if (f x) { 1 } else { 2 };'],
    ['a spaced call in the head', 'if (f (x)) { 1 } else { 2 };'],
    ['a prefix-shaped operator in the head', 'if (a -1) { 1 } else { 2 };'],
    ['an await in the head', 'if (await f()) { 1 } else { 2 };'],
    ['an or-pattern', 'switch x { case (#a or #b) { 1 } };'],
    ['a function body `= e`', 'func f() : Nat = 1;'],
];

describe('moc2', () => {
    test.each(REWRITES)('%s', async (_name, input, output) => {
        expect(await format(`${input}\n`)).toBe(`${output}\n`);
    });

    test.each(KEPT)('keeps %s as written', async (_name, input) => {
        expect(await format(`${input}\n`)).toBe(`${input}\n`);
    });

    test.each(REWRITES)(
        '%s: idempotent, and a fixed point of preserve',
        async (_name, input) => {
            const once = await format(`${input}\n`);
            expect(await format(once)).toBe(once);
            expect(await prettier.format(once, PRESERVE)).toBe(once);
        },
    );

    test('preserve leaves legacy syntax alone', async () => {
        const source = 'if (c) x else y;\n';
        expect(await prettier.format(source, PRESERVE)).toBe(source);
    });
});
