import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Copies the grammar and runtime wasm to `dir`, where the parser looks for them first. */
export function copyWasm(dir) {
    mkdirSync(dir, { recursive: true });
    for (const file of [
        'tree-sitter-motoko/tree-sitter-motoko.wasm',
        'web-tree-sitter/web-tree-sitter.wasm',
    ]) {
        copyFileSync(require.resolve(file), `${dir}/${file.split('/')[1]}`);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) copyWasm('lib/parser');
