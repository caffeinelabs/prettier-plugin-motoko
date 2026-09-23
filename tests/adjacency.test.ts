/**
 * The adjacency checklist, walked.
 *
 * `src/printer/adjacency.ts` carries the whole policy as a value, and its `CHECKLIST` docstring
 * makes a promise: *"`docs/adjacency.md` §7 ends with a nine-item list; the test that guards this
 * module walks it and asserts one case per item, so an item cannot be dropped from the checklist
 * without a test going red."* This is that test. The completeness assertions at the bottom are the
 * part that keeps the promise — a table of cases on its own would drift out of step with the
 * checklist without anything noticing.
 *
 * ## What a case can and cannot assert under `preserve`
 *
 * The checklist is the whole adjacency policy, but M2 ships only the `preserve` printer, and the
 * policy spans two modes. Writing that split down is most of what these cases document:
 *
 * - Items **1 and 2** — paren-wrap a compound head; space before a bare branch opener — are `moc2`
 *   **rewrites**: they edit the program's spelling. `docs/style.md` is explicit that a bare-branch
 *   `if` "must come from `moc2`", and the rewrites are not implemented: `headNeedsParens` takes a
 *   `HeadShape` that nothing produces (there is not even a value mapping `HeadKeyword` to a shape),
 *   and `bareBranchSpace` is called by no one. Under `preserve` these items are satisfied *by
 *   reproducing the source's own spacing*, which is what the cases below assert. A case here that
 *   expected parens would be asserting M3's work inside M2's test.
 * - Item **3** is live in `preserve` — and is the only item whose output is *not* verbatim, because
 *   the list printer regenerates the delimiters of `typ_params`/`inst` instead of copying them. That
 *   is why `L8` (glue the close) is a `preserve` obligation even though every other seam is copied.
 * - Items **4–8** are satisfied in `preserve` by verbatim reproduction plus the module's pure
 *   helpers. Their cases assert both halves: the printed output is unchanged, and the helper that
 *   item 7/8 delegates to answers correctly.
 * - Item **9** is a meta-rule — "do not delegate these to tree-sitter" — so its cases prove the
 *   *reason* rather than a printer behaviour: for the `S5` seams the runtime guard genuinely cannot
 *   tell the two spellings apart, which is why the rule has to live in the printer's own adjacency
 *   logic and not behind the guard.
 *
 * ## Why the expected values are exact strings
 *
 * Every `printed` below was measured from the built printer rather than reasoned out, and every
 * `source` was checked with `moc --check` under 1.16.0 and 2.0.0-beta.1. That does not make the
 * test a tautology, for the same reason `printer.test.ts` gives: the guard runs inside `format` and
 * re-parses every output, so each case asserts both the layout and that the layout means what the
 * input meant. Where a source is rejected by one generation — item 1's bare head, item 2's glued
 * unary — the case says so in its `why`, because that rejection is the whole reason the rule exists.
 */

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

/** The options every case runs under, spelled once, as in `printer.test.ts`. */
const OPTIONS = {
    parser: 'motoko',
    plugins: [plugin],
    printWidth: 80,
    tabWidth: 2,
    trailingComma: 'none',
} as const;

/** Format with the case options, letting a guard failure propagate as a test failure. */
function format(
    source: string,
    overrides: Record<string, unknown> = {},
): Promise<string> {
    return prettier.format(source, { ...OPTIONS, ...overrides });
}

/**
 * One case: a source, what `preserve` prints, the width it is printed at, and why it is here.
 *
 * `width` is explicit because three of these rules only bite when a construct would otherwise
 * break — `L1` and §2.7 are "force-glue" and "never split", and at the default width an
 * implementation that split them would still pass. The `why` is part of the test name.
 */
interface Case {
    readonly source: string;
    readonly printed: string;
    readonly width: number;
    readonly why: string;
}

const WIDE = 80;

/**
 * The cases, keyed by checklist item number.
 *
 * A `Map` rather than nine constants, because the numbers here are the ones in `docs/adjacency.md`
 * §7 and the test below indexes by them; a separate name per item would let the two drift.
 */
const CASES = new Map<number, readonly Case[]>([
    [
        1,
        [
            {
                source: 'func f(c : Bool) : Nat { if c { 1 } else { 2 } }',
                printed: 'func f(c : Bool) : Nat { if c { 1 } else { 2 } }\n',
                width: WIDE,
                why: 'an atomic head stays bare — `H5`–`H7` say wrapping `if c` would be a gratuitous change',
            },
            {
                source: 'func g(x : Nat) : Nat { 1 };\nfunc f(x : Nat) : Nat { if (g(x)) { 1 } else { 2 } }',
                printed:
                    'func g(x : Nat) : Nat { 1 };\nfunc f(x : Nat) : Nat { if (g(x)) { 1 } else { 2 } }\n',
                width: WIDE,
                why: 'an already-parenthesised compound head is reproduced, not double-wrapped (`preserve` does not unwrap either)',
            },
            {
                source: 'func f(xs : [Nat]) : Nat { if xs[0] { 1 } else { 2 } }',
                printed:
                    'func f(xs : [Nat]) : Nat { if xs[0] { 1 } else { 2 } }\n',
                width: WIDE,
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
                width: WIDE,
                why: 'the `B1` case: a glued unary branch is the exact spelling moc 2.0 rejects, and `preserve` keeps it verbatim — only `moc2` may add the space',
            },
            {
                source: 'func f(c : Bool) : Nat { if (c) -1 else 2 }',
                printed: 'func f(c : Bool) : Nat { if (c) -1 else 2 }\n',
                width: WIDE,
                why: 'the sharpest row in §2.2: the spaced unary is the one spelling all three parsers accept, and it is what `moc2` must emit',
            },
            {
                source: 'func f(c : Bool) : any { if (c) #less else #greater }',
                printed:
                    'func f(c : Bool) : any { if (c) #less else #greater }\n',
                width: WIDE,
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
                width: WIDE,
                why: '`L3`: a comparison is spaced, so the `>` cannot re-lex as a close-angle',
            },
            {
                source: 'let x = f<Nat>(1)',
                printed: 'let x = f<Nat>(1)\n',
                width: WIDE,
                why: '`L1`: an instantiation `<` is glued to the callee — `f <Nat>(1)` is the `S3` spelling tree-sitter misreads as a comparison',
            },
            {
                source: 'let x = f<Nat>(1)',
                printed: 'let x = f<\n  Nat>(1)\n',
                width: 12,
                why: '`L1` again, at a width that forces the list to break: the `<` stays glued to `f` and the `>` to `Nat`',
            },
            {
                source: 'type T = List<List<Nat>>',
                printed: 'type T = List<List<Nat>>\n',
                width: WIDE,
                why: '`L4`: a nested close is one contiguous `>>` — `> >` would end the outer list early',
            },
            {
                source: 'type F<Alpha, Beta, Gamma> = Alpha;',
                printed: 'type F<\n  Alpha,\n  Beta,\n  Gamma> = Alpha;\n',
                width: 20,
                why: '`L8`: a *broken* angle list glues its close to the last item — `Gamma` then `>` on a new line is `L8`',
            },
            {
                source: 'func f<Alpha, Beta <: List<Nat>>(a : Alpha) : Beta = a;',
                printed:
                    'func f<\n  Alpha,\n  Beta <: List<Nat>>(\n  a : Alpha\n) : Beta = a;\n',
                width: 20,
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
                width: WIDE,
                why: '`C1`/`C6`: `??` is spaced and never broken, so its leading `?` cannot become a second option type',
            },
            {
                source: 'let x : ? ?Nat = null',
                printed: 'let x : ? ?Nat = null\n',
                width: WIDE,
                why: '`C7`: the space between the two `?` is meaning-bearing and is reproduced',
            },
            {
                source: 'let x : ??Nat = null',
                printed: 'let x : ??Nat = null\n',
                width: WIDE,
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
                width: WIDE,
                why: '`D1`/`S1`: the number-dot is glued — tree-sitter is too permissive here, so the guard cannot be the thing that catches it',
            },
            {
                source: 'let s = 5.toText()',
                printed: 'let s = 5.toText()\n',
                width: 8,
                why: '`D2`: a narrow width must not introduce a space after the dot, which would re-lex as Float access',
            },
        ],
    ],
    [
        6,
        [
            {
                source: 'let v = #ok(1)',
                printed: 'let v = #ok(1)\n',
                width: WIDE,
                why: '`P1`: `#` is glued to its tag',
            },
            {
                source: 'let s = "a" # "b"',
                printed: 'let s = "a" # "b"\n',
                width: WIDE,
                why: '`P2`/`P3`: a concat `#` is spaced on both sides — the opposite treatment to a variant tag, which is why the seam needs a role, not a character',
            },
            {
                source: 'let s = "a" # "b"',
                printed: 'let s = "a" # "b"\n',
                width: 8,
                why: 'and the spacing survives a width too narrow to fit the line',
            },
        ],
    ],
    [
        7,
        [
            {
                source: 'func f() { a := b }',
                printed: 'func f() { a := b }\n',
                width: WIDE,
                why: '`:=` is one token — `a : = b` is a syntax error',
            },
            {
                source: 'func f() { let x = a ** b }',
                printed: 'func f() { let x = a ** b }\n',
                width: WIDE,
                why: '`**` is one token',
            },
            {
                source: 'func f() { let x = a +% b }',
                printed: 'func f() { let x = a +% b }\n',
                width: WIDE,
                why: 'a wrapping operator is one token',
            },
            {
                // The operands are long on purpose: at this width the block must break, so the case
                // exercises §2.7 rather than a line that fits. With short operands the same source
                // would pass at any implementation, including one that split the operator.
                source: 'func f() { let x = aaaaaaaa >> bbbbbbbb }',
                printed: 'func f() {\n  let x = aaaaaaaa >> bbbbbbbb\n}\n',
                width: 12,
                why: '§2.7: the shift `>>` must never be split across a line — the two `>` come from one token',
            },
        ],
    ],
    [
        8,
        [
            {
                source: 'type F<Alpha, Beta /*c*/> = Alpha;',
                printed: 'type F<\n  Alpha,\n  Beta\n  /*c*/> = Alpha;\n',
                width: 20,
                why: '§4: a comment in the glued angle seam is a conflict — `/*c*/>` is the only spelling both generations accept (a whitespace gap before `>` is rejected even with the comment present), so the comment may not be moved onto its own line; it doubles as an `L8` case, and fails if the close is not glued',
            },
        ],
    ],
    [
        9,
        [
            {
                source: 'let x : ??Nat = null',
                printed: 'let x : ??Nat = null\n',
                width: WIDE,
                why: '`S5`: tree-sitter is blind to the `??`-versus-two-options seam, so `preserve` reproduces it rather than normalising it',
            },
            {
                source: 'let v = #ok(1)',
                printed: 'let v = #ok(1)\n',
                width: WIDE,
                why: '`S5`: same for the tight `#` variant seam',
            },
        ],
    ],
]);

/** The items the document numbers, so a gap or a duplicate in `CHECKLIST` fails here. */
const DOCUMENTED_ITEMS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

describe('the adjacency checklist', () => {
    for (const item of CHECKLIST) {
        describe(`item ${item.n}: ${item.rule}`, () => {
            for (const c of CASES.get(item.n) ?? []) {
                test(`${c.why} — ${JSON.stringify(c.source)}`, async () => {
                    await expect(
                        format(c.source, { printWidth: c.width }),
                    ).resolves.toBe(c.printed);
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
        // The two directions the promise in `CHECKLIST`'s docstring needs. The first is what makes a
        // dropped item fail; the second is what makes a case for an item that no longer exists fail,
        // which is how a stale entry is found rather than silently ignored.
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
        // Each of these is one token; the split spelling is not merely ugly, it does not parse.
        const splits = [':=', '**', '+%', '<<', '>>', '|>', '->'];
        for (const op of splits) {
            expect(
                isIndivisible(op),
                `${op} is missing from INDIVISIBLE_OPERATORS`,
            ).toBe(true);
        }
    });

    test('the predicate is false for anything that is not a seam operator', () => {
        // `false` is the safe answer: a non-seam operator is free to have its own layout.
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
        // A free-spaced seam is ordinary layout: every area printer handles a comment there.
        expect(commentSplitsSeam('/*c*/', false)).toBe(false);
        // Whitespace is not a comment, so it can never conflict.
        expect(commentSplitsSeam('   ', true)).toBe(false);
    });
});

describe('item 9: the guard cannot decide these seams, so the printer must', () => {
    /**
     * The `S5` claim, made falsifiable: `compareShapes` reports no difference between the two
     * spellings, so `verifyOutput` — which runs inside every `format` call — would accept an output
     * that means something else. The rule therefore cannot be delegated to the guard, to
     * tree-sitter, or to a round-trip test; it has to be in the printer's own adjacency pass.
     */
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
        // Parenthesising a compound head *is* visible: it introduces a real node. This is the one
        // half of the first two items the guard backs up, and it is why `H1`/`H2` are the rules a
        // future printer can rely on the guard to police, while the branch spacing of `B1`/`B5`
        // (blind, above) cannot be.
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
        // The contract every force-glued seam depends on. A `glue` that added a space would break
        // `L1`, `L4`, `D1`, `P1` and `L8` at once, and this is the cheapest place to catch that.
        expect(glue()).toBe('');
        expect(glue('a')).toBe('a');
        expect(glue('a', 'b')).toEqual(['a', 'b']);
        expect(glue('a', 'b', 'c')).toEqual(['a', 'b', 'c']);
    });
});
