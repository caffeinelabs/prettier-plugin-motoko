// The grammar side of the harness: load web-tree-sitter + the vendored Motoko wasm, and parse text.
//
// This deliberately mirrors `.probe/lib.mjs` and `src/parser/tree-sitter.ts` rather than importing
// them. `src/parser/parse.ts` is a TypeScript module whose job is to throw on ERROR/MISSING and to
// hand back a *normalised* tree; the harness wants the opposite of both — it wants the raw raw tree,
// errors included, so the residue scan can see the shapes even in files that don't fully parse, and
// so `hasError` is inspectable. Importing the source through Node's type-stripping would also make
// the harness depend on the src tree's import spelling (`.ts` specifiers), which the tools tsconfig
// does not allow. Keeping the loader local keeps the harness self-contained and offline.
//
// The wasm is read from `web-tree-sitter`'s CJS entry (not its ESM one) because the CJS build does
// not spawn a worker and resolves its runtime wasm from disk, which is what a plain Node process
// wants; there is no bundler here to rewrite the ESM asset URLs.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Repo root, from this file's location (`tools/validate-moc2/lib/`). */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The vendored grammar wasm, next to the parser source. */
const GRAMMAR_WASM = fileURLToPath(
    new URL('../../../src/parser/tree-sitter-motoko.wasm', import.meta.url),
);

let languagePromise = null;

/** Load web-tree-sitter and compile the grammar once per process. */
export async function getLanguage() {
    if (!languagePromise) {
        languagePromise = (async () => {
            const { Parser, Language } = require(
                `${REPO_ROOT}node_modules/web-tree-sitter/web-tree-sitter.cjs`,
            );
            await Parser.init();
            const bytes = readFileSync(GRAMMAR_WASM);
            const language = await Language.load(bytes);
            return { Parser, Language, language };
        })();
        // A failed init must not be cached forever; a retry should be possible.
        languagePromise.catch(() => {
            languagePromise = null;
        });
    }
    return languagePromise;
}

/** A fresh parser bound to the grammar. The caller must `delete()` it when done. */
export async function createParser() {
    const { Parser, language } = await getLanguage();
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
}

/**
 * Parse once, synchronously, using a caller-owned parser. Returns the tree; the caller frees both.
 * `parse` never returns null in web-tree-sitter for a string input — a failed parse is a tree with
 * `rootNode.hasError` — so there is no null branch to fake.
 */
export function parseWith(parser, source) {
    return parser.parse(source);
}

/** Convenience for one-off parses: creates a parser, parses, frees the parser, returns the tree. */
export async function parseOnce(source) {
    const parser = await createParser();
    try {
        return parser.parse(source);
    } finally {
        parser.delete();
    }
}

/** The grammar's ABI + version, for the run header. Best-effort; never throws. */
export async function grammarInfo() {
    try {
        const { language } = await getLanguage();
        const md = language.metadata;
        return {
            abiVersion: language.abiVersion,
            name: language.name,
            version: md
                ? `${md.major_version}.${md.minor_version}.${md.patch_version}`
                : null,
            nodeTypeCount: language.nodeTypeCount,
        };
    } catch (e) {
        return { error: String(e && e.message ? e.message : e) };
    }
}

/**
 * A canonical, position-free shape of a tree, as a nested array.
 *
 * The plan compares "node by node" with layout normalised away, so the shape keeps `type` and the
 * token text but drops offsets and positions. Whitespace/comment text is excluded by construction:
 * the grammar's `comment` extras are leaves whose text we drop (keeping only the marker), because
 * whether a comment sits before or after an edit is a formatting concern, and the plan's oracle is
 * the moc AST, which has no comments. Two trees that differ only in comments or spacing hash equal.
 */
export function shapeOf(node) {
    const t = node.type;
    if (node.childCount === 0) {
        if (t === 'comment' || t === 'line_comment' || t === 'block_comment')
            return ['<comment>'];
        return [t, node.text];
    }
    const kids = [];
    for (let i = 0; i < node.childCount; i += 1)
        kids.push(shapeOf(node.child(i)));
    return [t, kids];
}

/** A stable string key for a shape, for hashing/diffing. */
export function shapeKey(shape) {
    return JSON.stringify(shape);
}
