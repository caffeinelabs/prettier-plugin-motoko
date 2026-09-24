import { describe, expect, test } from 'vitest';
import prettier from 'prettier';

import plugin from '../src/index.ts';
import { parse } from '../src/parser/parse.ts';
import { shapeOf } from '../src/parser/normalize.ts';
import { compareShapes } from '../src/verify.ts';
import { CHECKLIST } from '../src/printer/adjacency.ts';
import {
    commentSplitsSeam,
    glue,
    isIndivisible,
} from '../src/printer/adjacency.ts';

const OPTIONS: prettier.Options = {
    parser: 'motoko',
    plugins: [plugin],
    printWidth: 80,
    tabWidth: 2,
    trailingComma: 'none',
};

function format(
    source: string,
    overrides: Record<string, unknown> = {},
): Promise<string> {
    return prettier.format(source, { ...OPTIONS, ...overrides });
}

interface Case {
    readonly source: string;
    readonly printed: string;
    readonly why: string;
}

const CASES = new Map<number, readonly Case[]>([
    [
        1,
        [
            {
                source: 'func f(c : Bool) : Nat { if c { 1 } else { 2 } }',
                printed: 'func f(c : Bool) : Nat { if c { 1 } else { 2 } }\n',
                why: 'an atomic head stays bare — `H5`–`H7` say wrapping `if c` would be a gratuitous change',
            },
            {
                source: 'func g(x : Nat) : Nat { 1 };\nfunc f(x : Nat) : Nat { if (g(x)) { 1 } else { 2 } }',
                printed:
                    'func g(x : Nat) : Nat { 1 };\nfunc f(x : Nat) : Nat { if (g(x)) { 1 } else { 2 } }\n',
                why: 'an already-parenthesised compound head is reproduced, not double-wrapped (`preserve` does not unwrap either)',
            },
            {
                source: 'func f(xs : [Nat]) : Nat { if xs[0] { 1 } else { 2 } }',
                printed:
                    'func f(xs : [Nat]) : Nat { if xs[0] { 1 } else { 2 } }\n',
                why: 'the `H1` case: a bare indexed head is `preserve`d even though moc 1.16.0 rejects it — tidying it is `moc2`',
            },
        ],
    ],
    [
        2,
        [
            {
                source: 'func f(c : Bool) : Nat { if (c)-1 else 2 }',
                printed: 'func f(c : Bool) : Nat { if (c)-1 else 2 }\n',
                why: 'the `B1` case: a glued unary branch is the exact spelling moc 2.0 rejects, and `preserve` keeps it verbatim — only `moc2` may add the space',
            },
            {
                source: 'func f(c : Bool) : Nat { if (c) -1 else 2 }',
                printed: 'func f(c : Bool) : Nat { if (c) -1 else 2 }\n',
                why: 'the sharpest row in §2.2: the spaced unary is the one spelling all three parsers accept, and it is what `moc2` must emit',
            },
            {
                source: 'func f(c : Bool) : any { if (c) #less else #greater }',
                printed:
                    'func f(c : Bool) : any { if (c) #less else #greater }\n',
                why: 'a spaced variant branch (`B5`) is reproduced verbatim; the space is load-bearing',
            },
        ],
    ],
    [
        3,
        [
            {
                source: 'let b = x < y',
                printed: 'let b = x < y\n',
                why: '`L3`: a comparison is spaced, so the `>` cannot re-lex as a close-angle',
            },
            {
                source: 'let x = f<Nat>(1)',
                printed: 'let x = f<Nat>(1)\n',
                why: '`L1`: an instantiation `<` is glued to the callee — `f <Nat>(1)` is the `S3` spelling tree-sitter misreads as a comparison',
            },
            {
                source: 'let x = f<\n  Nat>(1)',
                printed: 'let x = f<\n  Nat>(1)\n',
                why: '`L1` again, in a broken list: the `<` stays glued to `f` and the `>` to `Nat`',
            },
            {
                source: 'type T = List<List<Nat>>',
                printed: 'type T = List<List<Nat>>\n',
                why: '`L4`: a nested close is one contiguous `>>` — `> >` would end the outer list early',
            },
            {
                source: 'type F<\n  Alpha,\n  Beta,\n  Gamma> = Alpha;',
                printed: 'type F<\n  Alpha,\n  Beta,\n  Gamma> = Alpha;\n',
                why: '`L8`: a *broken* angle list glues its close to the last item — `Gamma` then `>` on a new line is `L8`',
            },
            {
                source: 'func f<\n  Alpha,\n  Beta <: List<Nat>>(\n  a : Alpha\n) : Beta = a;',
                printed:
                    'func f<\n  Alpha,\n  Beta <: List<Nat>>(\n  a : Alpha\n) : Beta = a;\n',
                why: '`L8` and `L4` together: an item that itself ends a nested angle list still leaves the outer `>>` contiguous',
            },
        ],
    ],
    [
        4,
        [
            {
                source: 'let x = a ?? b',
                printed: 'let x = a ?? b\n',
                why: '`C1`/`C6`: `??` is spaced and never broken, so its leading `?` cannot become a second option type',
            },
            {
                source: 'let x : ? ?Nat = null',
                printed: 'let x : ? ?Nat = null\n',
                why: '`C7`: the space between the two `?` is meaning-bearing and is reproduced',
            },
            {
                source: 'let x : ??Nat = null',
                printed: 'let x : ??Nat = null\n',
                why: '`C7` in the other direction: a tight `??` type stays tight — `preserve` may not re-space it into an operator',
            },
        ],
    ],
    [
        5,
        [
            {
                source: 'let s = 5.toText()',
                printed: 'let s = 5.toText()\n',
                why: '`D1`/`S1`: the number-dot is glued — tree-sitter is too permissive here, so the guard cannot be the thing that catches it',
            },
        ],
    ],
    [
        6,
        [
            {
                source: 'let v = #ok(1)',
                printed: 'let v = #ok(1)\n',
                why: '`P1`: `#` is glued to its tag',
            },
            {
                source: 'let s = "a" # "b"',
                printed: 'let s = "a" # "b"\n',
                why: '`P2`/`P3`: a concat `#` is spaced on both sides — the opposite treatment to a variant tag, which is why the seam needs a role, not a character',
            },
        ],
    ],
    [
        7,
        [
            {
                source: 'func f() { a := b }',
                printed: 'func f() { a := b }\n',
                why: '`:=` is one token — `a : = b` is a syntax error',
            },
            {
                source: 'func f() { let x = a ** b }',
                printed: 'func f() { let x = a ** b }\n',
                why: '`**` is one token',
            },
            {
                source: 'func f() { let x = a +% b }',
                printed: 'func f() { let x = a +% b }\n',
                why: 'a wrapping operator is one token',
            },
            {
                source: 'func f() {\n  let x = aaaaaaaa >>\n    bbbbbbbb\n}',
                printed: 'func f() {\n  let x = aaaaaaaa >>\n    bbbbbbbb\n}\n',
                why: '§2.7: a chain broken at a shift keeps `>>` whole — the two `>` come from one token',
            },
        ],
    ],
    [
        8,
        [
            {
                source: 'type F<\n  Alpha,\n  Beta /*c*/> = Alpha;',
                printed: 'type F<\n  Alpha,\n  Beta /*c*/> = Alpha;\n',
                why: '§4.1: a comment in the glued angle seam is the glue itself — a whitespace gap before `>` is rejected by moc even with the comment present, so the comment may not be moved onto its own line; it doubles as an `L8` case, and fails if the close is not glued',
            },
            {
                source: 'type F<Alpha, Beta\n  /*c*/> = Alpha;',
                printed: 'type F<\n  Alpha,\n  Beta\n  /*c*/> = Alpha;\n',
                why: '§4.1 pair: an own-line comment stays on its own line, so the case above is asserting attachment and not merely the comment existing',
            },
        ],
    ],
    [
        9,
        [
            {
                source: 'let x : ??Nat = null',
                printed: 'let x : ??Nat = null\n',
                why: '`S5`: tree-sitter is blind to the `??`-versus-two-options seam, so `preserve` reproduces it rather than normalising it',
            },
            {
                source: 'let v = #ok(1)',
                printed: 'let v = #ok(1)\n',
                why: '`S5`: same for the tight `#` variant seam',
            },
        ],
    ],
]);

const DOCUMENTED_ITEMS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

describe('the adjacency checklist', () => {
    for (const item of CHECKLIST) {
        describe(`item ${item.n}: ${item.rule}`, () => {
            for (const c of CASES.get(item.n) ?? []) {
                test(`${c.why} — ${JSON.stringify(c.source)}`, async () => {
                    await expect(format(c.source)).resolves.toBe(c.printed);
                });
            }
        });
    }
});

describe('the checklist is complete and has no orphan cases', () => {
    test('every documented item is present, in order, with no gaps', () => {
        expect(CHECKLIST.map((item) => item.n)).toEqual([...DOCUMENTED_ITEMS]);
    });

    test('every item names the rows it implements and states its rule', () => {
        for (const item of CHECKLIST) {
            expect(
                item.rows.length,
                `item ${item.n} lists no rows`,
            ).toBeGreaterThan(0);
            expect(item.rule.trim(), `item ${item.n} states no rule`).not.toBe(
                '',
            );
        }
    });

    test('every item has at least one case, and every case has an item', () => {
        for (const item of CHECKLIST) {
            expect(
                CASES.get(item.n)?.length ?? 0,
                `item ${item.n} (${item.rule}) has no case in this test`,
            ).toBeGreaterThan(0);
        }
        const documented = new Set<number>(DOCUMENTED_ITEMS);
        for (const n of CASES.keys()) {
            expect(documented.has(n), `case for undeclared item ${n}`).toBe(
                true,
            );
        }
    });
});

describe('item 7: the indivisible operators are a value, not a chain of ifs', () => {
    test('a split operator is rejected by the parser, which is why the set exists', async () => {
        const splits = [':=', '**', '+%', '<<', '>>', '|>', '->'];
        for (const op of splits) {
            expect(
                isIndivisible(op),
                `${op} is missing from INDIVISIBLE_OPERATORS`,
            ).toBe(true);
        }
    });

    test('the predicate is false for anything that is not a seam operator', () => {
        for (const text of ['>=', '(', '', 'Nat']) {
            expect(
                isIndivisible(text),
                `${JSON.stringify(text)} should not be indivisible`,
            ).toBe(false);
        }
    });
});

describe('item 8: a comment in a glued seam is a conflict', () => {
    test('only a non-blank comment in a glued seam conflicts', () => {
        expect(commentSplitsSeam('/*c*/', true)).toBe(true);
        expect(commentSplitsSeam('/*c*/', false)).toBe(false);
        expect(commentSplitsSeam('   ', true)).toBe(false);
    });
});

describe('item 9: the guard cannot decide these seams, so the printer must', () => {
    const blind = async (a: string, b: string): Promise<boolean> =>
        compareShapes(
            shapeOf((await parse(a)).root),
            shapeOf((await parse(b)).root),
        ) === null;

    test('the double-option seam is invisible to the guard', async () => {
        expect(
            await blind('let x : ??Nat = null', 'let x : ? ?Nat = null'),
        ).toBe(true);
    });

    test('the tight variant seam is invisible to the guard', async () => {
        expect(await blind('let v = #ok(1)', 'let v = # ok(1)')).toBe(true);
    });

    test('the coalesce seam is invisible to the guard', async () => {
        expect(await blind('let x = a ?? b', 'let x = a ??  b')).toBe(true);
    });

    test('but a structural change is not — which is why items 1 and 2 differ', async () => {
        expect(
            await blind(
                'func g(x : Nat) : Nat { 1 };\nfunc f(x : Nat) : Nat { if g(x) { 1 } else { 2 } }',
                'func g(x : Nat) : Nat { 1 };\nfunc f(x : Nat) : Nat { if (g(x)) { 1 } else { 2 } }',
            ),
        ).toBe(false);
    });
});

describe('the module is a library of seams, and the ones it exports agree with the output', () => {
    test('`glue` is zero-width: it concatenates and adds nothing', () => {
        expect(glue()).toBe('');
        expect(glue('a')).toBe('a');
        expect(glue('a', 'b')).toEqual(['a', 'b']);
        expect(glue('a', 'b', 'c')).toEqual(['a', 'b', 'c']);
    });
});
