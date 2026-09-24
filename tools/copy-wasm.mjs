// Copies the two wasm files the parser loads next to the compiled `lib/parser/` module.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
mkdirSync('lib/parser', { recursive: true });
for (const file of [
    'tree-sitter-motoko/tree-sitter-motoko.wasm',
    'web-tree-sitter/web-tree-sitter.wasm',
]) {
    copyFileSync(require.resolve(file), `lib/parser/${file.split('/')[1]}`);
}
