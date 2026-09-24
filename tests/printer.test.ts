import { describe, expect, test } from 'vitest';
import prettier from 'prettier';

import plugin from '../src/index.ts';
import { parse } from '../src/parser/parse.ts';
import { shapeOf } from '../src/parser/normalize.ts';
import type { NormalChild, NormalNode } from '../src/parser/normalize.ts';
import { compareShapes } from '../src/verify.ts';

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
        printed: 'let r = {\n  a = 1;\n  b = 2;\n}\n',
        why: 'a broken record stays broken, with the source’s trailing `;`',
    },
    {
        source: 'let r = {\n  a = 1\n}',
        printed: 'let r = {\n  a = 1\n}\n',
        why: 'a broken record without a trailing `;` stays without one',
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
        printed: 'import {\n  a;\n  b\n} = "mo:x"\n',
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
        printed: 'func f() : Nat {\n\n  let x = 1;\n\n  x\n}\n',
        why: 'blank lines inside a broken block are kept, a run collapses to one',
    },
];

const IMPORT_SECTION: Case[] = [
    {
        source: 'import A "A";\n\nactor {};\n',
        printed: 'import A "A";\n\nactor {};\n',
        why: 'a blank line after the imports is kept',
    },
    {
        source: 'import A "A";\n// note\nactor {};\n',
        printed: 'import A "A";\n// note\nactor {};\n',
        why: 'no blank line is invented after the imports',
    },
    {
        source: '\n\nimport A "A";\nactor {}',
        printed: 'import A "A";\nactor {}\n',
        why: 'a leading blank before the first import is dropped',
    },
];

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

const ALL: Case[] = [...LAYOUT, ...COMMENTS, ...BLANK_LINES, ...UNTOUCHED];

describe('preserve: layout', () => {
    test.each(LAYOUT.map((c) => [c.why, c] as const))('%s', async (_why, c) => {
        expect(await format(c.source)).toBe(c.printed);
    });

    test('every layout case is accepted by the guard', async () => {
        for (const c of LAYOUT) {
            await expect(
                format(c.source),
                `guard rejected a hand-checked case: ${JSON.stringify(c.source)}`,
            ).resolves.toBe(c.printed);
        }
    });
});

describe('preserve: comments', () => {
    test.each(COMMENTS.map((c) => [c.why, c] as const))(
        '%s',
        async (_why, c) => {
            expect(await format(c.source)).toBe(c.printed);
        },
    );

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

describe('preserve: the import section', () => {
    test.each(IMPORT_SECTION.map((c) => [c.why, c] as const))(
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
    test.each(ALL.map((c) => [c.why, c] as const))(
        'stable: %s',
        async (_why, c) => {
            const once = await format(c.source);
            expect(await format(once)).toBe(once);
        },
    );

    test('trailingComma is inert under preserve', async () => {
        for (const c of ALL) {
            expect(
                await format(c.source, { trailingComma: 'all' }),
                `trailingComma:'all' changed ${JSON.stringify(c.source)}`,
            ).toBe(c.printed);
        }
    });

    test('semi is inert under preserve', async () => {
        for (const c of ALL) {
            expect(
                await format(c.source, { semi: false }),
                `semi:false changed ${JSON.stringify(c.source)}`,
            ).toBe(c.printed);
        }
    });

    test('printWidth never breaks a list', async () => {
        const source =
            'let r = { alpha = 1; beta = 2; gamma = 3; delta = 4; epsilon = 5; zeta = 6; eta = 7 }';
        for (const printWidth of [80, 20]) {
            expect(await format(source, { printWidth })).toBe(`${source}\n`);
        }
    });
});

// moc lexes a spaced `>` as greater-than, and `shapeOf` drops gaps, so only output assertions catch a detached close.
describe('preserve: the angle close', () => {
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

    test('a broken angle list glues the close to the last item', async () => {
        const source = 'type F<\n  Alpha,\n  Beta,\n  Gamma> = Alpha;';
        expect(await format(source)).toBe(`${source}\n`);
    });

    test('an instantiation list glues its close too', async () => {
        const printed = await format(
            'type L = List<List<Nat>>;\nlet x = L.make<\n  Alpha,\n  Beta>();',
        );
        expect(printed).toMatch(/Beta>\(\)/);
        expect(printed).not.toMatch(/\n\s*>/);
    });

    test('a nested close is a contiguous `>>`', async () => {
        const source =
            'func f<\n  Alpha,\n  Beta <: List<Nat>>(\n  a : Alpha\n) : Beta = a;';
        expect(await format(source)).toBe(`${source}\n`);
    });

    test('no printed angle list anywhere ends a line before its `>`', async () => {
        const sources = [
            'type F<\n  Alpha,\n  Beta,\n  Gamma> = Alpha;',
            'func f<\n  Alpha,\n  Beta,\n  Gamma <: List<Nat>>(a : Alpha) : Beta = a;',
            'class C<\n  Alpha,\n  Beta>(a : Alpha) { public let b : Beta; };',
            'let x = f<\n  Alpha,\n  Beta,\n  Gamma>();',
        ];
        for (const source of sources) {
            let reached = 0;
            const printed = await format(source);
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
                `detached close: ${JSON.stringify(source)}\n${printed}`,
            ).toEqual([]);
            expect(
                reached,
                `no angle list was reached, so this source proves nothing: ${JSON.stringify(source)}`,
            ).toBeGreaterThan(0);
        }
    });

    test('the runtime guard cannot see the difference — the reason these are output assertions', async () => {
        const glued = shapeOf((await parse('type F<A, B> = A;\n')).root);
        const broken = shapeOf(
            (await parse('type F<\n  A,\n  B\n> = A;\n')).root,
        );
        expect(compareShapes(glued, broken)).toBeNull();
    });
});

describe('the runtime guard', () => {
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
        expect(difference!.path).toMatch(/^(\$|\.?\d)/);
        expect(difference!.path.length).toBeGreaterThan(0);
    });

    test('it rejects an unwrapped parenthesised argument', async () => {
        const input = await shape('let f = func (x : Nat) { }; f (1);\n');
        const output = await shape('let f = func (x : Nat) { }; f 1;\n');
        expect(compareShapes(input, output)).not.toBeNull();
    });

    test('it rejects an added block', async () => {
        const input = await shape('func f() : Nat = 1;\n');
        const output = await shape('func f() : Nat { 1 };\n');
        expect(compareShapes(input, output)).not.toBeNull();
    });

    test('a trailing separator is a structural difference', async () => {
        const without = await shape('let r = { a = 1 }\n');
        const with_ = await shape('let r = { a = 1; }\n');
        expect(compareShapes(without, with_)).not.toBeNull();
    });

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
