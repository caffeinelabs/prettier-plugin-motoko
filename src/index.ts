import type {
    Parser,
    ParserOptions,
    Plugin,
    Printer,
    SupportLanguage,
    SupportOptions,
} from 'prettier';

import { parse as parseMotoko } from './parser/parse.ts';
import type { NormalBranch, NormalChild } from './parser/normalize.ts';
import { createPrinter, rememberRoot } from './printer/walk.ts';
import { rewriteMoc2 } from './rewrite/moc2.ts';

export const AST_FORMAT = 'motoko-ast';

export const PARSER_MOTOKO = 'motoko';
export const PARSER_MOTOKO_TT_PARSE = 'motoko-tt-parse';

const languages: SupportLanguage[] = [
    {
        name: 'Motoko',
        extensions: ['.mo'],
        aliases: ['mo'],
        parsers: [PARSER_MOTOKO, PARSER_MOTOKO_TT_PARSE],
        tmScope: 'source.mo',
        aceMode: 'text',
        linguistLanguageId: 202937027,
        vscodeLanguageIds: ['motoko'],
    },
];

const options: SupportOptions = {
    motokoSyntax: {
        category: 'Motoko',
        type: 'choice',
        default: 'preserve',
        description: 'Which Motoko syntax to print.',
        choices: [
            { value: 'preserve', description: 'Keep the syntax as written.' },
            {
                value: 'moc2',
                description:
                    'Rewrite legacy syntax to the moc 2.0 forms. May change between minors while moc 2.0 is in beta.',
            },
        ],
    },
};

async function parse(
    text: string,
    options: ParserOptions,
): Promise<NormalBranch> {
    const source =
        options.motokoSyntax === 'moc2' ? await rewriteMoc2(text) : text;
    const result = await parseMotoko(source);
    rememberRoot(result);
    return result.root;
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
