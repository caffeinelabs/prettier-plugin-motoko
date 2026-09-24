/**
 * The Prettier plugin entry point.
 *
 * M2 SCOPE: the parser and the `preserve` printer are both live, and `motokoOrganizeImports` is
 * implemented (see `parse` below). `motokoSyntax: "moc2"` is accepted but its rewrite passes are
 * still M3 — the one thing it changes today is the spelling `organize` emits (`=` on every import
 * statement), which is why `organizeSource` reads it. `preserve` is the default and is the mode this
 * build is correct in.
 *
 * The parse path is `src/parser/parse.ts` (text -> CST -> normalised tree, `ERROR`/`MISSING` ->
 * `MotokoSyntaxError` with a location), and the print path is `src/printer/walk.ts`, whose runtime
 * guard (`src/verify.ts`) re-parses every output before it is allowed to be written. Nothing in this
 * file imports the old engine, the Rust crate, or the grammar package.
 */

import type {
    Parser,
    ParserOptions,
    Plugin,
    Printer,
    SupportLanguage,
    SupportOptions,
} from 'prettier';

import { parse as parseMotoko } from './parser/parse.ts';
import type { ParseResult } from './parser/parse.ts';
import type { NormalBranch, NormalChild } from './parser/normalize.ts';
import { organizeImportSection } from './organize/imports.ts';
import { createPrinter, rememberRoot } from './printer/walk.ts';

/**
 * The parser's AST format. One name, so the printer and the parser cannot disagree about it.
 */
export const AST_FORMAT = 'motoko-ast';

/**
 * Parser names this plugin registers.
 *
 * `motoko` is the parser; `motoko-tt-parse` is an alias kept for one major so the current mops
 * call (`parser: "motoko-tt-parse"`) keeps resolving. It will be removed in the Next major.
 */
export const PARSER_MOTOKO = 'motoko';
export const PARSER_MOTOKO_TT_PARSE = 'motoko-tt-parse';

const languages: SupportLanguage[] = [
    {
        name: 'Motoko',
        // Candid (`.did`) is deliberately absent: this plugin does not parse Candid at all.
        extensions: ['.mo'],
        // Lets Prettier format fenced ```motoko blocks in Markdown without extra configuration.
        aliases: ['mo'],
        parsers: [PARSER_MOTOKO, PARSER_MOTOKO_TT_PARSE],
        tmScope: 'source.mo',
        aceMode: 'text',
        linguistLanguageId: 202937027,
        vscodeLanguageIds: ['motoko'],
        interpreters: [],
    },
];

const options: SupportOptions = {
    motokoSyntax: {
        category: 'Motoko',
        type: 'choice',
        default: 'preserve',
        description:
            'Which Motoko syntax to print. `moc2` rewrites legacy forms to the 2.0 forms.',
        choices: [
            {
                value: 'preserve',
                description:
                    'Print the input as written, normalising whitespace only.',
            },
            {
                value: 'moc2',
                description:
                    'Rewrite to the Motoko 2.0 forms. May change between minors while moc 2.0 is in beta.',
            },
        ],
    },
    motokoOrganizeImports: {
        category: 'Motoko',
        type: 'boolean',
        default: false,
        description: 'Organize and sort import statements.',
    },
    motokoRemoveLinesAroundCodeBlocks: {
        category: 'Motoko',
        type: 'boolean',
        default: false,
        description: 'Remove extra lines around code blocks.',
    },
};

/** The printer, keyed by `AST_FORMAT` so the parser's `astFormat` resolves to it. */
export const printers: Record<string, Printer> = {
    [AST_FORMAT]: createPrinter() as Printer,
};

/**
 * Parse entry point.
 *
 * Returns the **root node itself**, not the `ParseResult` that wraps it. That is not a style choice:
 * Prettier passes whatever this returns straight to the printer as `path.node` (it is not cloned —
 * `parse5` returns `{ text, ast }` and `coreFormat` hands `ast` on), and the printer's guard looks up
 * the `ParseResult` by that exact object identity to get at `source`. Returning the wrapper would put
 * a non-node object at the root, and `getVisitorKeys`/`locStart` would then be asked about a
 * `ParseResult` rather than a branch. So the result is registered under its root instead, and the
 * root is what travels.
 *
 * ## Organize imports happens here, before `rememberRoot`
 *
 * `motokoOrganizeImports` rewrites the source's import section to *text* and re-parses it; the tree
 * registered below is the one built from the **rewritten** text, so both the printer and the runtime
 * guard see the rewritten program. That is the `moc2` pattern `src/verify.ts` documents, and it is
 * what lets the printer combine and drop import statements without weakening the guard by a single
 * comparison. `src/organize/imports.ts` has the reasoning, including why the rewrite is text rather
 * than a rearrangement of nodes.
 *
 * The ordering is load-bearing. Registering the *original* tree and then printing the rewritten one
 * is precisely the mismatch the guard exists to catch — it would throw
 * `the printer changed the meaning of this file` at the first reordered import. So the rewrite
 * happens first, and only its own result is ever registered.
 *
 * The re-parse is also the pass's own guard: `organizeImportSection` returning text is not enough,
 * because the text must parse. If it does not, that is a bug in this file rather than in the user's
 * source, so the failure is allowed to propagate as a `MotokoSyntaxError` — reporting it as a
 * formatter internal error would hide where it came from.
 */
async function parse(
    text: string,
    options: ParserOptions,
): Promise<NormalBranch> {
    const organized = options.motokoOrganizeImports
        ? await organizeSource(text, options)
        : null;
    const result = organized ?? (await parseMotoko(text));
    rememberRoot(result);
    return result.root;
}

/**
 * Run the organize pass and re-parse its output, or `null` when there is nothing to do.
 *
 * Split out so the main path reads as one decision ("organized or not"), and so the option's two
 * reads — whether to run, and which spelling to emit — sit next to each other.
 */
async function organizeSource(
    text: string,
    options: ParserOptions,
): Promise<ParseResult | null> {
    const original = await parseMotoko(text);
    const mode = options.motokoSyntax === 'moc2' ? 'moc2' : 'preserve';
    const rewritten = await organizeImportSection(text, original.root, mode);
    if (rewritten === null) return null;
    return parseMotoko(rewritten);
}

/**
 * Byte offsets for Prettier's own traversals: cursor location, range formatting, and the comment
 * attachment pass (inert here — see `printer/walk.ts`'s header).
 *
 * `startIndex`/`endIndex` are the offsets the normaliser recorded from the wasm nodes, so slicing
 * `originalText` by them is exact. The `Text` gap nodes carry spans too, which is what makes them
 * addressable by `locStart`; `getVisitorKeys` keeps them out of the traversal anyway.
 */
const locStart = (node: NormalChild): number => node.startIndex;
const locEnd = (node: NormalChild): number => node.endIndex;

const parsers: Record<string, Parser> = {
    [PARSER_MOTOKO]: {
        parse,
        astFormat: AST_FORMAT,
        locStart,
        locEnd,
    },
};

// `motoko-tt-parse` is an alias of the same parser object, not a second implementation.
parsers[PARSER_MOTOKO_TT_PARSE] = parsers[PARSER_MOTOKO];

const plugin: Plugin = {
    languages,
    parsers,
    printers,
    options,
};

export { languages, options, parsers };

export default plugin;
