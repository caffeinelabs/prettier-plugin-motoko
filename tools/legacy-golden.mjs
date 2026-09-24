// Replay the extracted legacy cases through the **real 0.13 engine** and record its output.
//
// `tools/legacy-extract.mjs` gives the inputs (323 `format()` calls). This gives their goldens, by
// loading `prettier-plugin-motoko@0.13.0` from a scratch install and formatting each input exactly
// as the legacy suite would have.
//
// Why not read the goldens out of the legacy `.ts` files: they sit inside `expect(...)` chains, and
// nested matchers (`toStrictEqual` on a value built by a helper) are not text-extractable. Replaying
// is also self-checking — the version is pinned and printed, so a golden can always be traced to the
// engine that produced it.
//
// Usage:
//   node tools/legacy-golden.mjs --engine /tmp/legacy-engine --cases .probe/legacy-cases.json \
//       --out .probe/legacy-golden.json

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
};

const engineDir = flag('--engine', '/tmp/legacy-engine');
const casesPath = flag('--cases', '.probe/legacy-cases.json');
const outPath = flag('--out', '.probe/legacy-golden.json');

const require = createRequire(resolve(engineDir, 'package.json'));
const prettier = require('prettier');
const plugin = require('prettier-plugin-motoko');
const engineVersion = require('prettier-plugin-motoko/package.json').version;
const prettierVersion = require('prettier/package.json').version;

const cases = JSON.parse(readFileSync(resolve(ROOT, casesPath), 'utf8'));

const results = [];
let ok = 0;
let threw = 0;

for (const [i, c] of cases.entries()) {
    // 0.13 registers `motoko-tt-parse` and infers the parser from `.mo` / `.did`; the new plugin's
    // `motoko` parser name does not exist there. Named explicitly rather than via `filepath`, so the
    // replay does not depend on extension inference.
    const options = {
        ...c.options,
        parser: 'motoko-tt-parse',
        plugins: [plugin],
    };
    if (c.suite === 'organizeImports') options.motokoOrganizeImports = true;
    delete options.filepath;
    const record = { ...c, engine: engineVersion };
    try {
        record.golden = await prettier.format(c.input, options);
        ok += 1;
    } catch (error) {
        record.golden = null;
        record.error = String(error && error.message ? error.message : error)
            .split('\n')
            .slice(0, 4)
            .join(' ');
        threw += 1;
    }
    results.push(record);
    if ((i + 1) % 50 === 0) {
        process.stderr.write(`  ${i + 1}/${cases.length}\n`);
    }
}

writeFileSync(
    resolve(ROOT, outPath),
    JSON.stringify(
        {
            engine: engineVersion,
            prettier: prettierVersion,
            cases: results,
        },
        null,
        2,
    ) + '\n',
);

console.error(
    `${results.length} cases replayed on ${engineVersion}: ${ok} formatted, ${threw} threw -> ${outPath}`,
);
