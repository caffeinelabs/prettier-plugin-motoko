/**
 * The M2 `preserve` printer's contract, and the guard that enforces it.
 *
 * Two halves, and they are different kinds of test.
 *
 * The first half is **behavioural**: a table of sources and their exact printed output. Every
 * expected value here was *measured* from the built printer rather than written from intuition —
 * which sounds like it makes the test a tautology, and would if the assertions were the only thing
 * checking them. They are not: the guard runs inside `format` and re-parses every output, so each
 * case is simultaneously an assertion about layout and a proof that the layout means what the input
 * meant. A wrong expectation fails, and so does a printer that emits the expected bytes *by changing
 * the program*. Which of the two happened is what the failure message has to tell apart, so the
 * cases are grouped by the rule they pin rather than by syntax.
 *
 * The second half is **adversarial**: it feeds the guard differences it must reject, including a
 * planted bug of the kind `docs/formatter-rework.md` describes. A guard with an empty tolerance list
 * that never fires is indistinguishable from a guard that cannot fire, and the corpus run — where
 * `guardFail` must be zero — is exactly the situation in which that would go unnoticed.
 *
 * ## Why the options are written out
 *
 * `printWidth: 80` and `tabWidth: 2` are passed explicitly even though they are Prettier's defaults.
 * A formatter's output is a function of its options, so a test that relies on defaults is really
 * asserting "Prettier's defaults are still what they were" — and this repo's own `.prettierrc` sets
 * `tabWidth: 4` for its *TypeScript*, which is a fine way for the two to get crossed. `trailingComma`
 * is passed for the same reason plus one more: it is a Prettier core option, not one this plugin
 * declares, and `preserve` must ignore it. `trailingComma: 'all'` is asserted to change nothing.
 */

import { describe, expect, test } from 'vitest';
import prettier from 'prettier';

import plugin from '../src/index.ts';
import { parse } from '../src/parser/parse.ts';
import { shapeOf } from '../src/parser/normalize.ts';
import type { NormalChild, NormalNode } from '../src/parser/normalize.ts';
import { compareShapes } from '../src/verify.ts';

/** The options every case below runs under, spelled once so no case can quietly use defaults. */
const OPTIONS = {
    parser: 'motoko',
    plugins: [plugin],
    printWidth: 80,
    tabWidth: 2,
    trailingComma: 'none',
} as const;

/** Format with the case options, letting any guard failure propagate as a test failure. */
function format(
    source: string,
    overrides: Record<string, unknown> = {},
): Promise<string> {
    return prettier.format(source, { ...OPTIONS, ...overrides });
}

/**
 * One case: a source, what `preserve` prints, and the rule the case is there to pin.
 *
 * The `why` is part of the test names, so a failure reads as "the rule broke" rather than "some
 * string differs", and a case cannot be deleted without deleting its stated reason.
 */
interface Case {
    readonly source: string;
    readonly printed: string;
    readonly why: string;
}

/**
 * Layout: a list that fits goes on one line, and the source's own separators are kept.
 *
 * This is the group that would fail against the `moc2` table in `docs/style.md`, by design — see
 * that document's "Read this table as the `moc2` target". `preserve` may not add or remove a
 * separator, so `(1,)` keeps its comma and `{ a = 1 }` keeps the absence of a semicolon.
 */
const LAYOUT: Case[] = [
    {
        source: 'let t = (1,2)',
        printed: 'let t = (1, 2)\n',
        why: 'a comma-separated list is re-spaced but neither separator nor paren is touched',
    },
    {
        source: 'let t = (1,)',
        printed: 'let t = (1,)\n',
        why: 'a trailing comma is meaning-bearing and so is reproduced, not normalised away',
    },
    {
        source: 'let t = (1)',
        printed: 'let t = (1)\n',
        why: 'a redundant paren is left alone — `preserve` does not unwrap, that is a moc2 edit',
    },
    {
        source: 'let a = [1,2,3]',
        printed: 'let a = [1, 2, 3]\n',
        why: 'an array literal is a comma-separated list like a tuple',
    },
    {
        source: 'let a = [1,]',
        printed: 'let a = [1,]\n',
        why: 'the array family honours a trailing comma too',
    },
    {
        source: 'let r = {\n  a = 1;\n  b = 2;\n}',
        printed: 'let r = { a = 1; b = 2; }\n',
        why: 'a record that fits is collapsed, and the source’s trailing `;` comes with it',
    },
    {
        source: 'let r = {\n  a = 1\n}',
        printed: 'let r = { a = 1 }\n',
        why: 'a record without a trailing `;` collapses and stays without one',
    },
    {
        source: 'func f() : Nat { let x = 1; x }',
        printed: 'func f() : Nat { let x = 1; x }\n',
        why: 'a block’s inter-declaration `;` is the source’s, and its absence after `x` too',
    },
    {
        source: 'func f() : Nat { let x = 1; x; }',
        printed: 'func f() : Nat { let x = 1; x; }\n',
        why: 'a block that ends in `;` keeps it — the one place `semi` would differ',
    },
    {
        source: 'import {\n  a;\n  b\n} = "mo:x"',
        printed: 'import { a; b } = "mo:x"\n',
        why: 'an import’s braced pattern is a list, and `a; b` are two names, not a path',
    },
    {
        source: 'switch (x) { case (1) { 1 }; case (2) { 2 } }',
        printed: 'switch (x) { case (1) { 1 }; case (2) { 2 } }\n',
        why: 'the `;` between switch arms is a real token in the tree, so preserve keeps it',
    },
    {
        source: 'type T2<X, Y> = (X, Y)',
        printed: 'type T2<X, Y> = (X, Y)\n',
        why: 'angle brackets are a list family with their own separator character',
    },
    {
        source: 'type List<A> = ?(A, List<A>)',
        printed: 'type List<A> = ?(A, List<A>)\n',
        why: 'a self-referential type alias nests a tuple inside angle brackets',
    },
    {
        source: 'let x = do ? { 1 }',
        printed: 'let x = do ? { 1 }\n',
        why: 'a block-headed construct does not flatten into its head',
    },
    {
        source: 'actor Palindrome { }',
        printed: 'actor Palindrome {}\n',
        why: 'an empty object body is `{}` with no interior space',
    },
];

/**
 * Breaking: a list that does not fit breaks one item per line, and the trailing separator follows
 * the source rather than the layout.
 *
 * The last two cases are the same list at the same width, differing only in whether the source wrote
 * a trailing `;`, and they produce *different* output. That pair is the sharpest statement of what
 * `preserve` is: an option that keyed the trailing separator off the layout would print them
 * identically, and the guard would reject one of the two.
 */
const BREAKING: Case[] = [
    {
        source: 'let r = { alpha = 1; beta = 2; gamma = 3; delta = 4; epsilon = 5; zeta = 6; eta = 7 }',
        printed:
            'let r = {\n  alpha = 1;\n  beta = 2;\n  gamma = 3;\n  delta = 4;\n  epsilon = 5;\n  zeta = 6;\n  eta = 7\n}\n',
        why: 'a record past the print width breaks one field per line, indented one level',
    },
    {
        source: 'let r = { alpha = 1; beta = 2; gamma = 3; delta = 4; epsilon = 5; zeta = 6; eta = 7; }',
        printed:
            'let r = {\n  alpha = 1;\n  beta = 2;\n  gamma = 3;\n  delta = 4;\n  epsilon = 5;\n  zeta = 6;\n  eta = 7;\n}\n',
        why: 'the same list broken, with the source’s trailing `;` now at the end of the last line',
    },
    {
        source: 'let a = [1111111, 2222222, 3333333, 4444444, 5555555, 6666666, 7777777, 8888888, 9999999]',
        printed:
            'let a = [\n  1111111,\n  2222222,\n  3333333,\n  4444444,\n  5555555,\n  6666666,\n  7777777,\n  8888888,\n  9999999\n]\n',
        why: 'the array family breaks the same way, closing bracket on its own line',
    },
    {
        source: 'func f(alpha : Nat, beta : Nat, gamma : Nat, delta : Nat, epsilon : Nat, zeta : Nat) : Nat { alpha }',
        printed:
            'func f(\n  alpha : Nat,\n  beta : Nat,\n  gamma : Nat,\n  delta : Nat,\n  epsilon : Nat,\n  zeta : Nat\n) : Nat { alpha }\n',
        why: 'a parameter list breaks while the body beside it stays flat — lists break independently',
    },
    {
        source: 'import { performanceCounter; debugPrint; other; more; evenMore; yetAnother } = "mo:x"',
        printed:
            'import {\n  performanceCounter;\n  debugPrint;\n  other;\n  more;\n  evenMore;\n  yetAnother\n} = "mo:x"\n',
        why: 'a long import pattern breaks with `;` separators inside the braces',
    },
];

/**
 * Comments: a comment forces its group open, because a `//` that flattens swallows what follows.
 *
 * These are the cases where the printer's layout choice is a *meaning* choice, which is why the rule
 * is stated as required in `docs/style.md` rather than as a preference. Each one would be a guard
 * failure rather than a cosmetic difference if the break were not forced.
 */
const COMMENTS: Case[] = [
    {
        source: 'let x = 1; // hi\nlet y = 2',
        printed: 'let x = 1; // hi\nlet y = 2\n',
        why: 'a comment that ends a line stays on it, and the next declaration starts a fresh line',
    },
    {
        source: '/* hi */ let x = 1',
        printed: '/* hi */\nlet x = 1\n',
        why: 'a block comment on a declaration’s line is pushed off it rather than absorbed',
    },
    {
        source: '/// doc\nlet x = 1',
        printed: '/// doc\nlet x = 1\n',
        why: 'a doc comment is a comment kind of its own and keeps its own line',
    },
    {
        source: '{ a = 1; // c\n b = 2 }',
        printed: '{\n  a = 1; // c\n  b = 2\n}\n',
        why: 'a comment inside a record forces the record open, and keeps the line the author gave it',
    },
];

/**
 * Blank lines: the source's, kept and capped at one.
 *
 * `at most one` is `docs/style.md`'s rule and the only line count the printer has an opinion about;
 * the zero case matters as much as the capped one, because inventing a blank line would be a layout
 * change the source did not ask for.
 */
const BLANK_LINES: Case[] = [
    {
        source: 'let a = 1;\n\n\n\nlet b = 2;',
        printed: 'let a = 1;\n\nlet b = 2;\n',
        why: 'three blank lines between declarations collapse to one',
    },
    {
        source: 'let x = 1;\n\nlet y = 2',
        printed: 'let x = 1;\n\nlet y = 2\n',
        why: 'one blank line is preserved as one',
    },
    {
        source: 'let x = 1; let y = 2;',
        printed: 'let x = 1;\nlet y = 2;\n',
        why: 'declarations on one line are split, and no blank line is invented between them',
    },
    {
        source: 'func f() : Nat {\n\n let x = 1;\n\n\n x\n}',
        printed: 'func f() : Nat {\n  let x = 1;\n\n  x\n}\n',
        why: 'a blank line *inside* a broken block is kept, while a leading one is dropped',
    },
];

/**
 * Orthogonal constructs that reach the printer tail-first and would be easy to break by accident.
 *
 * These are not about lists or breaks; they are the cases that pin "the printer does not touch what
 * it does not understand". `1.toText()` is here because the number-dot seam is the one place the
 * *lexer* is ambiguous (`docs/adjacency.md`'s `NUMBER_DOT_GLUED`), and a printer that spaced it
 * would change the token stream.
 */
const UNTOUCHED: Case[] = [
    {
        source: 'let r = 1.toText()',
        printed: 'let r = 1.toText()\n',
        why: 'the number-dot seam is lexical, so no space may appear before the dot',
    },
    {
        source: 'f x',
        printed: 'f x\n',
        why: 'a juxtaposed application is preserved — `tight-apply` is a moc2 edit, not this one',
    },
    {
        source: 'let s = "a\nb"',
        printed: 'let s = "a\nb"\n',
        why: 'a multi-line string literal is opaque source text and is not re-indented',
    },
    {
        source: 'let o = object { public func f() : Nat { 1 } }',
        printed: 'let o = object { public func f() : Nat { 1 } }\n',
        why: 'an anonymous object with a member is a nested list inside an expression',
    },
    {
        source: 'func f() : Nat { (1) }',
        printed: 'func f() : Nat { (1) }\n',
        why: 'a parenthesised expression in a body keeps its parens',
    },
    {
        source: 'let x = if c { 1 } else { 2 }',
        printed: 'let x = if c { 1 } else { 2 }\n',
        why: 'an if/else chain is not merged or split across lines when it fits',
    },
];

const ALL: Case[] = [
    ...LAYOUT,
    ...BREAKING,
    ...COMMENTS,
    ...BLANK_LINES,
    ...UNTOUCHED,
];

describe('preserve: layout', () => {
    test.each(LAYOUT.map((c) => [c.why, c] as const))('%s', async (_why, c) => {
        expect(await format(c.source)).toBe(c.printed);
    });

    // The guard is the reason a wrong expectation cannot pass silently: `format` re-parses its own
    // output and throws if the tree changed. Stating it as a test of its own makes the coupling
    // explicit rather than incidental, and keeps a future refactor from dropping it.
    test('every layout case is accepted by the guard', async () => {
        for (const c of LAYOUT) {
            await expect(
                format(c.source),
                `guard rejected a hand-checked case: ${JSON.stringify(c.source)}`,
            ).resolves.toBe(c.printed);
        }
    });
});

describe('preserve: breaking', () => {
    test.each(BREAKING.map((c) => [c.why, c] as const))(
        '%s',
        async (_why, c) => {
            expect(await format(c.source)).toBe(c.printed);
        },
    );

    // The load-bearing pair. Both sources are the same eight fields and both exceed the width, so a
    // layout-keyed trailing separator prints them identically; the assertion is that they differ, in
    // exactly the one character the source differs by.
    test('a trailing separator follows the source, not the layout', async () => {
        const without = await format(
            'let r = { alpha = 1; beta = 2; gamma = 3; delta = 4; epsilon = 5; zeta = 6; eta = 7 }',
        );
        const with_ = await format(
            'let r = { alpha = 1; beta = 2; gamma = 3; delta = 4; epsilon = 5; zeta = 6; eta = 7; }',
        );
        expect(without).not.toBe(with_);
        expect(without).toMatch(/eta = 7\n}\n$/);
        expect(with_).toMatch(/eta = 7;\n}\n$/);
    });
});

describe('preserve: comments', () => {
    test.each(COMMENTS.map((c) => [c.why, c] as const))(
        '%s',
        async (_why, c) => {
            expect(await format(c.source)).toBe(c.printed);
        },
    );

    // A `//` comment inside a list is the case the forced break exists for. Asserting the *lines*
    // rather than the exact text keeps the case honest if the surrounding layout changes, while
    // still failing if the comment swallows the next item.
    test('a line comment never absorbs the item after it', async () => {
        const printed = await format(
            'let r = {\n  aaaaaaaaaaaaaaaaaaaa = 1; // a long enough comment to matter\n  b = 2\n}',
        );
        const lines = printed.split('\n');
        const commentAt = lines.findIndex((l) => l.includes('//'));
        expect(commentAt).toBeGreaterThan(-1);
        expect(lines[commentAt + 1]).toContain('b = 2');
    });
});

describe('preserve: blank lines', () => {
    test.each(BLANK_LINES.map((c) => [c.why, c] as const))(
        '%s',
        async (_why, c) => {
            expect(await format(c.source)).toBe(c.printed);
        },
    );
});

describe('preserve: untouched constructs', () => {
    test.each(UNTOUCHED.map((c) => [c.why, c] as const))(
        '%s',
        async (_why, c) => {
            expect(await format(c.source)).toBe(c.printed);
        },
    );
});

describe('preserve: idempotence and options', () => {
    // `docs/formatter-rework.md`'s M2 exit criterion is "corpus idempotent", and this is the cheap
    // version of it: formatting a second time must be a no-op on every case above. The corpus run is
    // the expensive version, and it checks the same property on real code.
    test.each(ALL.map((c) => [c.why, c] as const))(
        'stable: %s',
        async (_why, c) => {
            const once = await format(c.source);
            expect(await format(once)).toBe(once);
        },
    );

    // `trailingComma` is Prettier's own option, not one this plugin declares, so a config naming it
    // must resolve without error — and `preserve` must ignore it. The separator question is settled
    // per item from the source (see `printer/parts.ts`), so the option has nothing to act on.
    test('trailingComma is inert under preserve', async () => {
        for (const c of ALL) {
            expect(
                await format(c.source, { trailingComma: 'all' }),
                `trailingComma:'all' changed ${JSON.stringify(c.source)}`,
            ).toBe(c.printed);
        }
    });

    // Same for `semi`, which is the option most likely to be wired up by accident while porting the
    // legacy fixtures: it is an instruction to add or remove a token, which `preserve` may not obey.
    test('semi is inert under preserve', async () => {
        for (const c of ALL) {
            expect(
                await format(c.source, { semi: false }),
                `semi:false changed ${JSON.stringify(c.source)}`,
            ).toBe(c.printed);
        }
    });

    // The width option does have an effect, and this pins which one: a list that fits at 80 breaks
    // at 20. Without this, a printer that ignored `printWidth` entirely would pass every case above.
    test('printWidth decides whether a list breaks', async () => {
        const source = 'let r = { aaaa = 1; bbbb = 2 }';
        expect(await format(source, { printWidth: 80 })).toBe(
            'let r = { aaaa = 1; bbbb = 2 }\n',
        );
        expect(await format(source, { printWidth: 20 })).toBe(
            'let r = {\n  aaaa = 1;\n  bbbb = 2\n}\n',
        );
    });
});

/**
 * The angle close, which is the one seam in the whole printer that no gate watches.
 *
 * `typ_params` and `inst` are comma-separated lists like any other, so the obvious spelling is the
 * one every other family uses: break after the `<`, indent, and break before the `>`. moc's lexer
 * does not accept that:
 *
 *     | Parser.GT when leading_ws () && trailing_ws () -> Parser.GTOP
 *
 * A `>` with whitespace on **both** sides lexes as the greater-than *operator*, so a close-angle
 * pushed onto its own line stops being a close-angle:
 *
 *     type F<
 *       A,
 *       B
 *     > = A;          syntax error [M0001], unexpected token '>'
 *
 * That is a syntax error on every moc from 0.16.3 through 2.0.0-beta.1, and it is the reason
 * `ListDescriptor.closeGlued` exists. What makes the flag load-bearing rather than defensive is the
 * next paragraph: **no test here can catch the regression it prevents.** `shapeOf` projects
 * `typ_params` and `inst` by node text, so the glued and broken spellings project to the same shape
 * and `compareShapes` returns `null` — the runtime guard, which is the printer's only automatic
 * correctness check, is blind to this. The corpus run is blind for the same reason, and idempotence
 * is satisfied trivially on the broken output, because formatting it again reproduces it. The
 * assertions below therefore do not check a *rule*; they check the *output*, because output is the
 * only place this defect is visible.
 *
 * The seam is one-sided, which is why the flag is a flag and not a `glue()` around the whole list:
 * breaking after the opening `<` is accepted by every compiler tested, so only the close is glued.
 */
describe('preserve: the angle close', () => {
    /** Every `typ_params`/`inst` node printed as the last thing on its line, i.e. a detached `>`. */
    function detachedCloses(root: NormalChild): string[] {
        const bad: string[] = [];
        const visit = (node: NormalChild): void => {
            if (node.nodeType !== 'Branch') return;
            if (
                (node.kind === 'typ_params' || node.kind === 'inst') &&
                /\s>$/.test(node.text)
            )
                bad.push(node.text);
            for (const child of node.children) visit(child);
        };
        visit(root);
        return bad;
    }

    // The measured defect, at the narrowest width that produces it. The `>` sits on the last
    // parameter's line — `Gamma>`, not a line of its own.
    test('a broken angle list glues the close to the last item', async () => {
        const printed = await format('type F<Alpha, Beta, Gamma> = Alpha;', {
            printWidth: 20,
        });
        expect(printed).toBe('type F<\n  Alpha,\n  Beta,\n  Gamma> = Alpha;\n');
    });

    // The same rule in `inst`, reached through an expression rather than a type alias. `inst` also
    // carries the close, so a fix attached to `typ_params` alone would leave this one broken.
    test('an instantiation list glues its close too', async () => {
        const printed = await format(
            'type L = List<List<Nat>>;\nlet x = L.make<Alpha, Beta>();',
            { printWidth: 20 },
        );
        expect(printed).toMatch(/Beta>\(\)/);
        expect(printed).not.toMatch(/\n\s*>/);
    });

    // The nested seam, L5 in `docs/adjacency.md`: when the last parameter ends in `>`, the close
    // makes a contiguous `>>`, and the glued close is what keeps it contiguous. A single-item nested
    // list is not a case for this — an angle list of one item never breaks — so the discriminator has
    // to be a *bound*, which is the only way an inner `>` reaches the end of a multi-item angle list.
    // Without the glue this prints `B <: List<Nat>\n>()`: the pair splits and the outer close lands on
    // its own line, so the case fails for two reasons at once rather than by a whitespace whisker.
    test('a nested close is a contiguous `>>`', async () => {
        const printed = await format(
            'func f<Alpha, Beta <: List<Nat>>(a : Alpha) : Beta = a;',
            { printWidth: 20 },
        );
        expect(printed).toBe(
            'func f<\n  Alpha,\n  Beta <: List<Nat>>(\n  a : Alpha\n) : Beta = a;\n',
        );
    });

    // The general form, over real code rather than the strings above: nothing the printer emits may
    // end a line inside a `typ_params` or `inst`. This is the assertion that would have caught the
    // defect on the corpus, where it was found, and it is written against the CST so it cannot be
    // satisfied by a stray `>` in a comparison expression — those are preserved verbatim from the
    // source and are not list closes.
    //
    // The sources are drawn from the constructs that actually carry the two kinds, which is narrower
    // than it looks: a type *application* like `Map<Text, List<Nat>>` is a `path_typ` and is copied
    // verbatim, so it can never detach a close and would make this test look broader than it is. The
    // coverage assertion below is what keeps a source that reaches nothing from passing quietly.
    test('no printed angle list anywhere ends a line before its `>`', async () => {
        const sources = [
            'type F<Alpha, Beta, Gamma> = Alpha;',
            'func f<Alpha, Beta, Gamma <: List<Nat>>(a : Alpha) : Beta = a;',
            'class C<Alpha, Beta>(a : Alpha) { public let b : Beta; };',
            'let x = f<Alpha, Beta, Gamma>();',
        ];
        for (const source of sources) {
            let reached = 0;
            for (const printWidth of [80, 40, 20, 10]) {
                const printed = await format(source, { printWidth });
                const { root } = await parse(printed);
                const visit = (node: NormalChild): void => {
                    if (node.nodeType !== 'Branch') return;
                    if (node.kind === 'typ_params' || node.kind === 'inst')
                        reached += 1;
                    for (const child of node.children) visit(child);
                };
                visit(root);
                expect(
                    detachedCloses(root),
                    `detached close at printWidth ${printWidth}: ${JSON.stringify(source)}\n${printed}`,
                ).toEqual([]);
            }
            expect(
                reached,
                `no angle list was reached, so this source proves nothing: ${JSON.stringify(source)}`,
            ).toBeGreaterThan(0);
        }
    });

    // The blindness above, asserted rather than asserted-about. It is written as a test because it is
    // the premise the whole group rests on: if `shapeOf` ever starts distinguishing these, the guard
    // gains a real check here and this test fails *loudly* — which is the correct outcome, since the
    // group would then be belt-and-braces rather than the only cover.
    test('the runtime guard cannot see the difference — the reason these are output assertions', async () => {
        const glued = shapeOf((await parse('type F<A, B> = A;\n')).root);
        const broken = shapeOf(
            (await parse('type F<\n  A,\n  B\n> = A;\n')).root,
        );
        expect(compareShapes(glued, broken)).toBeNull();
    });
});

/**
 * The guard itself, driven directly.
 *
 * The corpus run reports `guardFail: 0`, which is the property that matters — but a guard that never
 * fires reports zero too. These tests make it fire on purpose, including on a planted bug, so that
 * "zero guard failures" is known to mean "nothing differed" rather than "nothing was compared".
 */
describe('the runtime guard', () => {
    /** Parse a source and project it, the same way `verifyOutput` does on the way in. */
    async function shape(source: string) {
        const { root } = await parse(source);
        return shapeOf(root);
    }

    test('it accepts a tree against itself', async () => {
        const s = await shape('let a = 1;\nlet b = 2;\n');
        expect(compareShapes(s, s)).toBeNull();
    });

    test('it rejects a dropped token', async () => {
        const input = await shape('let a = 1;\nlet b = 2;\n');
        const output = await shape('let a = 1;\nlet b = 3;\n');
        const difference = compareShapes(input, output);
        expect(difference).not.toBeNull();
        // The report has to *locate* the difference, not merely notice it — a guard failure with no
        // path would be unusable on a real file. The path is a dotted chain of child indices, so it
        // starts at the root and descends; asserting the shape rather than a literal index keeps the
        // case from breaking every time the normaliser's root layout changes.
        expect(difference!.path).toMatch(/^(\$|\.?\d)/);
        expect(difference!.path.length).toBeGreaterThan(0);
    });

    // The planted bug from `docs/formatter-rework.md`: dropping a juxtaposed application's head
    // parens turns `f (x)` into `f x`, which parses as a *different* tree (an application rather
    // than a parenthesised argument) rather than failing outright. That is exactly the class of
    // change the guard exists to catch, since the input still parses.
    test('it rejects an unwrapped parenthesised argument', async () => {
        const input = await shape('let f = func (x : Nat) { }; f (1);\n');
        const output = await shape('let f = func (x : Nat) { }; f 1;\n');
        expect(compareShapes(input, output)).not.toBeNull();
    });

    // The other planted bug: bracing a `func … = e` body adds a `BlockE` node. Both sides parse, so
    // only a structural comparison can see it.
    test('it rejects an added block', async () => {
        const input = await shape('func f() : Nat = 1;\n');
        const output = await shape('func f() : Nat { 1 };\n');
        expect(compareShapes(input, output)).not.toBeNull();
    });

    // A separator is a token, which is the single fact the whole `preserve` separator rule rests on.
    // If this ever stops holding, the printer could happily normalise `;` and the guard would not
    // notice — so the test that the guard *does* notice is the test that the rule is real.
    test('a trailing separator is a structural difference', async () => {
        const without = await shape('let r = { a = 1 }\n');
        const with_ = await shape('let r = { a = 1; }\n');
        expect(compareShapes(without, with_)).not.toBeNull();
    });

    // The one difference the comparator forgives, and it forgives it for a reason: Prettier's line
    // writer strips trailing whitespace, so a line comment's trailing spaces cannot survive a round
    // trip. Asserted here so the tolerance is documented by a test rather than only by a comment.
    test('it forgives a line comment’s trimmed trailing space', async () => {
        const withSpace = await shape('/// doc \nlet x = 1\n');
        const trimmed = await shape('/// doc\nlet x = 1\n');
        expect(compareShapes(withSpace, trimmed)).toBeNull();
    });

    test('it does not forgive the same difference in code', async () => {
        const input = await shape('let x = 1;\n');
        const output = await shape('let x = 11;\n');
        expect(compareShapes(input, output)).not.toBeNull();
    });
});
