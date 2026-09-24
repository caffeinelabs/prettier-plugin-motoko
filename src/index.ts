import type {
    Parser,
    ParserOptions,
    Plugin,
    Printer,
    SupportLanguage,
    SupportOptions,
} from 'prettier';

import { organizeImportSection } from './organize/imports.ts';

import { parse as parseMotoko } from './parser/parse.ts';
import type { ParseResult } from './parser/parse.ts';
import type { NormalBranch, NormalChild } from './parser/normalize.ts';
import { createPrinter, rememberRoot } from './printer/walk.ts';

export const AST_FORMAT = 'motoko-ast';

export const PARSER_MOTOKO = 'motoko';
/** An alias of `motoko`: mops passes this name explicitly. */
export const PARSER_MOTOKO_TT_PARSE = 'motoko-tt-parse';

const languages: SupportLanguage[] = [
    {
        name: 'Motoko',
        extensions: ['.mo'],
        // Markdown fences may be tagged `mo` as well as `motoko`.
        aliases: ['mo'],
        parsers: [PARSER_MOTOKO, PARSER_MOTOKO_TT_PARSE],
        tmScope: 'source.mo',
        aceMode: 'text',
        linguistLanguageId: 202937027,
        vscodeLanguageIds: ['motoko'],
    },
];

const options: SupportOptions = {
    motokoOrganizeImports: {
        category: 'Motoko',
        type: 'boolean',
        default: false,
        description: 'Sort, group and combine the import section.',
    },
};

async function parse(
    text: string,
    options: ParserOptions,
): Promise<NormalBranch> {
    const original = await parseMotoko(text);
    const result = options.motokoOrganizeImports
        ? ((await organized(original)) ?? original)
        : original;
    // The printer's runtime guard compares its output against this tree, so it needs the source too.
    rememberRoot(result);
    return result.root;
}

/**
 * The organized source, re-parsed, or `null` when there is nothing to change.
 * The guard then compares the printer's output with the organized tree, so reordering imports is not a guard failure.
 */
async function organized(original: ParseResult): Promise<ParseResult | null> {
    const rewritten = await organizeImportSection(
        original.source,
        original.root,
    );
    return rewritten === null ? null : parseMotoko(rewritten);
}

const parser: Parser<NormalChild> = {
    parse,
    astFormat: AST_FORMAT,
    locStart: (node) => node.startIndex,
    locEnd: (node) => node.endIndex,
};

const parsers: Record<string, Parser> = {
    [PARSER_MOTOKO]: parser,
    [PARSER_MOTOKO_TT_PARSE]: parser,
};

const printers: Record<string, Printer> = {
    [AST_FORMAT]: createPrinter() as Printer,
};

const plugin: Plugin = { languages, options, parsers, printers };

export { languages, options, parsers, printers };

export default plugin;
