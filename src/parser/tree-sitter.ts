/**
 * Lazy, memoised initialisation of web-tree-sitter and the Motoko grammar.
 *
 * The build copies both wasm files next to the compiled module (`lib/parser/`), so an installed plugin never resolves the grammar package,
 * whose install script builds native bindings. From source (tests, tools) they are resolved from the pinned devDependencies instead.
 */

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

/** The compiled grammar. A failed load is not cached, so the next call retries. */
export function getLanguage(): Promise<Language> {
    if (!languagePromise) {
        languagePromise = loadLanguage();
        languagePromise.catch(() => {
            languagePromise = null;
        });
    }
    return languagePromise;
}

/** A new parser bound to the Motoko grammar. The caller must `delete()` it. */
export async function createParser(): Promise<Parser> {
    // `Parser.init()` must finish before the constructor runs.
    const language = await getLanguage();
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
}
