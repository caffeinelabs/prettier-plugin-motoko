import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Language, Parser } from 'web-tree-sitter';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function firstReadable(candidates: (() => string)[]): Promise<string> {
    const failures: string[] = [];
    for (const candidate of candidates) {
        try {
            const path = candidate();
            await readFile(path);
            return path;
        } catch (e) {
            failures.push((e as Error).message);
        }
    }
    throw new Error(
        `prettier-plugin-motoko: wasm not found:\n${failures.join('\n')}`,
    );
}

async function loadLanguage(): Promise<Language> {
    const runtime = await firstReadable([
        () => join(here, 'web-tree-sitter.wasm'),
        () => require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    ]);
    const grammar = await firstReadable([
        () => join(here, 'tree-sitter-motoko.wasm'),
        () => require.resolve('tree-sitter-motoko/tree-sitter-motoko.wasm'),
    ]);

    await Parser.init({
        locateFile: (name: string) => (name.endsWith('.wasm') ? runtime : name),
    });
    // Load from bytes: the runtime's own fetch is not available inside a SEA binary.
    return Language.load(await readFile(grammar));
}

let languagePromise: Promise<Language> | null = null;

export function getLanguage(): Promise<Language> {
    if (!languagePromise) {
        languagePromise = loadLanguage();
        languagePromise.catch(() => {
            languagePromise = null;
        });
    }
    return languagePromise;
}

export async function createParser(): Promise<Parser> {
    const language = await getLanguage();
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
}
