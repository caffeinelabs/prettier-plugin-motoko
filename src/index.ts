/**
 * The Prettier plugin entry point.
 *
 * M1 SCOPE: this milestone delivers parsing and normalisation only. There is NO PRINTER yet, and
 * the `motoko` parser deliberately throws rather than returning something the rest of Prettier
 * would mis-render. Anything that formats Motoko today must use the old engine on
 * `release/0.13`; this branch does not format at all until the printer lands.
 *
 * The real parse path is a sibling PR: it fills the marked seam below with
 * `src/parser/parse.ts` (text -> CST -> normalised tree, ERROR/MISSING -> SyntaxError with a
 * location). Nothing in this file imports the old engine, the Rust crate, or the grammar package.
 */

import type {
    Parser,
    ParserOptions,
    Plugin,
    Printer,
    SupportLanguage,
    SupportOptions,
} from 'prettier';

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

/**
 * M1 has no printer, so this is empty rather than a stub that would claim `AST_FORMAT` is printable.
 * A format call fails at the parser (below) before a printer would be consulted. M2 fills this with
 * the real printer keyed by `AST_FORMAT`.
 */
export const printers: Record<string, Printer> = {};

/**
 * Parse entry point: unimplemented in M1.
 *
 * TODO(M2): replace this body with the real parse path
 * (`src/parser/tree-sitter.ts` -> `src/parser/parse.ts` -> `src/parser/normalize.ts`). The parse
 * function must be async and must reject with a `SyntaxError` carrying a location whenever the CST
 * contains `ERROR` or `MISSING` nodes — never return a partial tree.
 */
function parse(_text: string, _options: ParserOptions): Promise<never> {
    return Promise.reject(
        new Error(
            [
                'prettier-plugin-motoko: no printer in this build.',
                '',
                'This version is the M1 foundation: it delivers the tree-sitter parser and the',
                'normaliser only. Formatting lands in M2.',
                '',
                'Sandboxed installs and editors cannot work around this. Use the 0.13 line',
                '(release/0.13) for a plugin that formats.',
            ].join('\n'),
        ),
    );
}

const parsers: Record<string, Parser> = {
    [PARSER_MOTOKO]: {
        parse,
        astFormat: AST_FORMAT,
        // The normalised tree carries byte offsets, so the printer can slice source text. Until
        // the parser lands these are defined but never reached: `parse` rejects first.
        locStart: () => 0,
        locEnd: () => 0,
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
