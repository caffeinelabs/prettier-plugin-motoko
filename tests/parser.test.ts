/** `parse()` either returns a tree that reproduces its input exactly, or throws a located `MotokoSyntaxError`. */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { MotokoSyntaxError, parse } from '../src/parser/parse.ts';
import { checkRoundTrip, shapeOf } from '../src/parser/normalize.ts';
import type { NormalBranch } from '../src/parser/normalize.ts';
import { HEAD_SYMBOL_IDS } from '../src/parser/nodes.generated.ts';

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
        // Non-ASCII is where a wrong offset convention would show.
        ['multi-byte characters in a string', 'let x = "é你好"; // é你\n'],
        ['characters outside the BMP', 'let s = "😀🎉";\n'],
        ['a backslash escape', 'let s = "a\\nb\\t\\"c";\n'],
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

    const fixtures = join(import.meta.dirname, 'fixtures');
    test.each(readdirSync(fixtures).filter((f) => f.endsWith('.mo')))(
        'fixture %s',
        async (name) => {
            await parseAndCheck(readFileSync(join(fixtures, name), 'utf8'));
        },
    );

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
    test('a call in object position reports mode "object"', async () => {
        const { root } = await parse('let a = f(x);\n');
        const shape = shapeOf(root);
        expect(hasKind(shape, 'call_exp_object')).toBe(false);
        expect(hasKind(shape, 'call_exp')).toBe(true);
        expect(modeOf(shape, 'call_exp')).toBe('object');
    });

    test('the same construct in head position is distinguished by mode', async () => {
        const { root } = await parse('let a = if f(x) { 1 } else { 2 };\n');
        const shape = shapeOf(root);
        expect(hasKind(shape, 'call_exp')).toBe(true);
        expect(modeOf(shape, 'call_exp')).toBe('block');
    });

    test('a head-mode node aliased to a bare name still reports mode "block"', async () => {
        // `not_exp` carries no suffix in head position, so only `grammarId` shows it is a head.
        const { root } = await parse('let a = if not x { 1 } else { 2 };\n');
        const shape = shapeOf(root);
        expect(hasKind(shape, 'not_exp')).toBe(true);
        expect(modeOf(shape, 'not_exp')).toBe('block');
    });

    test('every head-mode node the grammar produces reports mode "block"', async () => {
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
        expect(headNodesSeen).toBeGreaterThan(0);
    });

    test('a bare-aliased kind in object position is not misread as head mode', async () => {
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
        // moc rejects a doubled separator too.
        ['a doubled semicolon', 'let x = 1;;\n', /Unexpected input/],
        // moc rejects it too. The grammar recovers with a zero-width node and no `isError` anywhere.
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
        const error = await parse('import I "x";\ninclude I;\n').catch(
            (e: unknown) => e,
        );
        const syntaxError = error as MotokoSyntaxError;
        expect(syntaxError.message).not.toMatch(
            /bug in prettier-plugin-motoko/,
        );
        expect(syntaxError.loc.start.line).toBe(2);
    });

    test('the error carries a 1-based line and a code frame on the offending line', async () => {
        const error = await parse('let x = @@@ ;\n').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(MotokoSyntaxError);
        const syntaxError = error as MotokoSyntaxError;
        expect(syntaxError.loc.start.line).toBe(1);
        // On the `@`, not on the `=` the outer ERROR node starts at.
        expect(syntaxError.loc.start.column).toBe(9);
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

/** `shapeOf` collapses branches to `[kind, mode?, children]`. */
function hasKind(node: unknown, kind: string): boolean {
    if (!Array.isArray(node)) return false;
    if (node[0] === kind) return true;
    const kids = node[node.length - 1];
    return Array.isArray(kids) && kids.some((c) => hasKind(c, kind));
}

/** The mode of the first node of `kind` that has one, or `undefined`. */
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
