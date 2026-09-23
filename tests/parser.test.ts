/**
 * The M1 contract: `parse()` either returns a normalised tree that reproduces its input byte for
 * byte, or throws a located `MotokoSyntaxError`. Nothing in between.
 *
 * The round-trip assertion is the load-bearing one. Everything downstream — the printer, the
 * rewrite, the runtime guard — assumes the normalised tree is a lossless view of the source, and
 * this suite is where that assumption is checked on inputs small enough to read.
 */

import { describe, expect, test } from 'vitest';

import { MotokoSyntaxError, parse } from '../src/parser/parse.ts';
import { checkRoundTrip, shapeOf } from '../src/parser/normalize.ts';
import type { NormalBranch } from '../src/parser/normalize.ts';
import { HEAD_SYMBOL_IDS } from '../src/parser/nodes.generated.ts';

/** Parse and assert the round-trip, returning the root. Every good case goes through here. */
async function parseAndCheck(source: string) {
    const { root } = await parse(source);
    expect(checkRoundTrip(root, source)).toBeNull();
    // The root must cover the whole file, or `locStart`/`locEnd` cannot address every character.
    expect(root.text).toBe(source);
    expect(root.startIndex).toBe(0);
    expect(root.endIndex).toBe(source.length);
    return root;
}

describe('parse: accepted input', () => {
    // Each case is `[name, source]`. The names are the failure message, so they say what the input
    // exercises rather than restating the source.
    const good: [string, string][] = [
        ['empty file', ''],
        ['a single declaration', 'let x = 1;\n'],
        ['leading blank lines are kept', '\n\n\nactor {};\n'],
        ['a final newline is kept', 'let x = 1;\n'],
        ['no final newline', 'let x = 1;'],
        ['head-mode if', 'let x = if c { 1 } else { 2 };\n'],
        ['call in object position', 'let a = f(x);\n'],
        ['a line comment', 'let x = 1; // hi\nlet y = 2;\n'],
        ['a block comment', '/* hi */ let x = 1;\n'],
        ['a nested block comment', '/* a /* b */ c */ let x = 1;\n'],
        ['a comment between callee and args', 'let z = f /*c*/ (x);\n'],
        ['an object literal', 'let o = { a = 1; b = 2; };\n'],
        ['an actor', 'actor { public func f() : async () {} };\n'],
        ['a switch', 'switch (x) { case (1) 2; case (_) 3 };\n'],
        ['a module', 'module { public let x = 1; };\n'],
        ['a nested function', 'func f() { func g() { 1 } };\n'],
        // Non-ASCII is where the UTF-16 offset convention would break if it were wrong, so these
        // matter more than their size suggests. Motoko identifiers are ASCII, hence strings.
        ['multi-byte characters in a string', 'let x = "é你好"; // é你\n'],
        ['characters outside the BMP', 'let s = "😀🎉";\n'],
        ['a backslash escape', 'let s = "a\\nb\\t\\"c";\n'],
        // Trailing semicolons are the subject of `docs/semicolons.md` §1: a trailing `;` at the end
        // of any `seplist` is inert, but the round-trip must preserve it regardless of what the
        // printer later decides to emit. (`;;` is *not* in this set — see the rejected cases.)
        ['an inert trailing semicolon in a block', 'actor { a(); };\n'],
        [
            'an inert trailing semicolon in a record',
            'let r = { a = 1; b = 2; };\n',
        ],
        [
            'an inert trailing semicolon in a module',
            'module { public let x = 1; };\n',
        ],
    ];

    test.each(good)('%s', async (_name, source) => {
        await parseAndCheck(source);
    });

    test('the root of an empty file is still a source_file', async () => {
        const root = await parseAndCheck('');
        expect(root.kind).toBe('source_file');
        expect(root.children).toStrictEqual([]);
    });

    test('the root of a whitespace-only file holds just the gap', async () => {
        const root = await parseAndCheck('\n\n  \n');
        expect(root.children.map((c) => c.nodeType)).toStrictEqual(['Text']);
    });
});

describe('parse: mode aliases', () => {
    // The grammar aliases the same construct per expression mode. The normaliser strips the suffix
    // into `kind` + `mode`, which is what lets the printer switch exhaustively over kinds.
    test('a call in object position reports mode "object"', async () => {
        const { root } = await parse('let a = f(x);\n');
        const shape = shapeOf(root);
        // `shapeOf` reports the stripped kinds, so the alias must not leak through.
        expect(hasKind(shape, 'call_exp_object')).toBe(false);
        expect(hasKind(shape, 'call_exp')).toBe(true);
        expect(modeOf(shape, 'call_exp')).toBe('object');
    });

    test('the same construct in head position is distinguished by mode', async () => {
        // `f(x)` as a control head: the grammar parses this in head mode, so the alias differs.
        const { root } = await parse('let a = if f(x) { 1 } else { 2 };\n');
        const shape = shapeOf(root);
        expect(hasKind(shape, 'call_exp')).toBe(true);
        expect(modeOf(shape, 'call_exp')).toBe('block');
    });

    test('a head-mode node aliased to a bare name still reports mode "block"', async () => {
        // The load-bearing case, and the reason `modeOf` consults `grammarId` rather than the
        // visible suffix. Head mode is registered as `<name>_head` and then aliased *either* onto
        // `<name>_block` (`call_exp` above, where the suffix happens to agree) *or* back onto the
        // bare `<name>`. `not_exp` is the second kind: its `type` contains no mode suffix at all,
        // so suffix-stripping alone reports `mode: null` and a printer would read the `{` after it
        // as opening a record rather than a body. `HEAD_SYMBOL_IDS.has(grammarId)` is the only
        // test that sees it. See `docs/normalize.md` §4.2–4.3.
        const { root } = await parse('let a = if not x { 1 } else { 2 };\n');
        const shape = shapeOf(root);
        expect(hasKind(shape, 'not_exp')).toBe(true);
        expect(modeOf(shape, 'not_exp')).toBe('block');
    });

    test('every head-mode node the grammar produces reports mode "block"', async () => {
        // The general form of the two cases above: whatever the alias, a node whose `grammarId` is
        // in the spec's set of 20 must classify as head. Written as a sweep so a future addition to
        // `HEAD_SYMBOL_IDS` is covered here without a new case per construct.
        const sources = [
            'let a = if not x { 1 } else { 2 };\n',
            'let a = if f(x) { 1 } else { 2 };\n',
            'let a = if x.y { 1 } else { 2 };\n',
            'let a = if x[0] { 1 } else { 2 };\n',
            'let a = if x and y { 1 } else { 2 };\n',
            'let a = if x + y { 1 } else { 2 };\n',
        ];
        let headNodesSeen = 0;
        for (const source of sources) {
            const root = await parseAndCheck(source);
            const headModes: (string | null)[] = [];
            const walk = (node: NormalBranch): void => {
                if (HEAD_SYMBOL_IDS.has(node.grammarId)) {
                    headModes.push(node.mode);
                }
                for (const child of node.children) {
                    if (child.nodeType === 'Branch') walk(child);
                }
            };
            walk(root);
            headNodesSeen += headModes.length;
            expect(headModes.every((m) => m === 'block')).toBe(true);
        }
        // Without this the sweep would pass vacuously if the node walk stopped finding heads — the
        // one failure mode a "for all" assertion cannot catch on its own.
        expect(headNodesSeen).toBeGreaterThan(0);
    });

    test('a bare-aliased kind in object position is not misread as head mode', async () => {
        // The other direction: `not x` outside a control head is an ordinary object-mode
        // expression, and its `type` is the *same* `not_exp`. Only the `grammarId` differs, so this
        // is what keeps the fix from being "call everything named `not_exp` a head".
        const { root } = await parse('let a = not x;\n');
        const shape = shapeOf(root);
        expect(hasKind(shape, 'not_exp')).toBe(true);
        expect(modeOf(shape, 'not_exp')).toBe(undefined);
    });
});

describe('parse: rejected input', () => {
    test.each<[string, string, RegExp]>([
        [
            'an unclosed brace',
            'let x = { a = 1;\n',
            /closing brace|Unexpected input/,
        ],
        ['stray garbage', 'let x = @@@ ;\n', /Unexpected input/],
        [
            'a missing brace at end of file',
            'actor { let x = 1; ',
            /closing brace|Unexpected input/,
        ],
        [
            'an unterminated block comment',
            '/* never closed\n',
            /Missing `\*\/`/,
        ],
        // A doubled separator is not a trailing one, and moc rejects it too (`docs/semicolons.md`
        // records this as EDGE-double-semi-block, DIFFERS-ERROR).
        ['a doubled semicolon', 'let x = 1;;\n', /Unexpected input/],
        // `include` takes an expression, not a bare name — real moc rejects `include I;` with
        // "unexpected token ';', expected ... <exp(ob)>". The grammar recovers by inserting a
        // zero-width literal and setting `hasError` on it without setting `isError`/`isMissing`
        // anywhere, which is the one shape that used to fall through `findProblem` and surface as
        // "report a normaliser bug". Kept as a case so that shape stays covered.
        [
            'include with no expression',
            'import I "x";\ninclude I;\n',
            /Unexpected input/,
        ],
    ])('%s', async (_name, source, message) => {
        await expect(parse(source)).rejects.toThrow(MotokoSyntaxError);
        await expect(parse(source)).rejects.toThrow(message);
    });

    test('a zero-width recovery node is reported, not blamed on the normaliser', async () => {
        // The guard's own message must never be what a user with a plain typo sees.
        const error = await parse('import I "x";\ninclude I;\n').catch(
            (e: unknown) => e,
        );
        const syntaxError = error as MotokoSyntaxError;
        expect(syntaxError.message).not.toMatch(/bug in the normaliser/);
        // The caret lands on the offending line rather than on the file's first line.
        expect(syntaxError.loc.start.line).toBe(2);
    });

    test('the error carries a 1-based line and a code frame on the offending line', async () => {
        const error = await parse('let x = @@@ ;\n').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(MotokoSyntaxError);
        const syntaxError = error as MotokoSyntaxError;
        expect(syntaxError.loc.start.line).toBe(1);
        // The caret is on the `@`, not on the `=` before it: an outer ERROR node spans the whole
        // failed construct and `findProblem` descends into the most specific one.
        expect(syntaxError.loc.start.column).toBe(8);
        expect(syntaxError.codeFrame).toContain('let x = @@@ ;');
        expect(syntaxError.codeFrame).toContain('^');
    });

    test('the reported line is correct on a multi-line file', async () => {
        const error = await parse(
            'let a = 1;\nlet b = 2;\nlet c = @@@ ;\n',
        ).catch((e: unknown) => e);
        expect((error as MotokoSyntaxError).loc.start.line).toBe(3);
    });

    test('a thrown error is a real SyntaxError, for Prettier to recognise', async () => {
        const error = await parse('let x = @@@ ;\n').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SyntaxError);
    });
});

/** `shapeOf` collapses branches to `[kind, mode?, children]`; walk it looking for a kind. */
function hasKind(node: unknown, kind: string): boolean {
    if (!Array.isArray(node)) return false;
    if (node[0] === kind) return true;
    const kids = node[node.length - 1];
    return Array.isArray(kids) && kids.some((c) => hasKind(c, kind));
}

/** The `mode` of the first node of `kind`, or `undefined` if there is none. */
function modeOf(node: unknown, kind: string): string | undefined {
    if (!Array.isArray(node)) return undefined;
    if (node[0] === kind)
        return typeof node[1] === 'string' ? node[1] : undefined;
    const kids = node[node.length - 1];
    if (!Array.isArray(kids)) return undefined;
    for (const c of kids) {
        const found = modeOf(c, kind);
        if (found !== undefined) return found;
    }
    return undefined;
}
