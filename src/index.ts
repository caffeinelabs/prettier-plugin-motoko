import type { Parser, Plugin, SupportLanguage } from 'prettier';

import { parse as parseMotoko } from './parser/parse.ts';
import type { NormalBranch, NormalChild } from './parser/normalize.ts';

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

async function parse(text: string): Promise<NormalBranch> {
    return (await parseMotoko(text)).root;
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

const plugin: Plugin = { languages, parsers };

export { languages, parsers };

export default plugin;
