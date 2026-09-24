// Extract the (input, options) call log from a jest-style legacy suite, without running jest.
//
// The two suites we care about (`tests/legacy/formatter.test.ts`,
// `tests/legacy/organizeImports.test.ts`) are tables: each `test()` calls `format(...)` a handful of
// times and asserts on the result. The assertions are the old engine's expectations and are what we
// are replacing; the *inputs* are the durable artifact.
//
// So instead of porting the file, we run it with a recording stub in place of `prettier`:
//
//   - `prettier.format` records `(input, options)` in call order and returns an opaque sentinel.
//   - `expect` is a no-op chainable, because every assertion in these suites is about a value we
//     deliberately did not compute.
//   - `describe` / `test` register, then the bodies are awaited in registration order.
//
// The `await` is not incidental. Every test body is `async` and its `format` calls sit after an
// `await`, so a recorder that runs the body and returns records **one call per test** — the other
// calls land in microtasks that have not run. Draining the queue is what makes this a faithful
// extraction rather than a plausible-looking one: 323 calls, not 102.
//
// The result is the exact, complete input set of the legacy suite — including the cases inside a
// `for` loop, which no text-level extraction would find — with the old expectations dropped.
//
// Usage: node tools/legacy-extract.mjs [--suite formatter|organizeImports|all] [--out <path>]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Scratch for the generated modules. Gitignored, like the rest of `.probe/`. */
const SCRATCH = resolve(ROOT, '.probe/legacy-extract');

const SUITES = {
    formatter: 'tests/legacy/formatter.test.ts',
    organizeImports: 'tests/legacy/organizeImports.test.ts',
};

/**
 * A value that survives any assertion chain: property access and calls both return it. `then` is
 * deliberately absent so an accidental `await` on it does not turn it into a never-settling
 * thenable.
 */
function anything() {
    const chain = new Proxy(function () {}, {
        get: (_target, key) =>
            typeof key === 'symbol' || key === 'then' ? undefined : chain,
        apply: () => chain,
    });
    return chain;
}

/**
 * Rewrite a suite's source into an evaluable module body: the file's own `import` statements dropped,
 * `prettier` and the jest globals supplied from the outside.
 *
 * The subtlety, and the reason this is not a filter over every line: **the suite's inputs are template
 * literals that themselves contain `import` statements**, and in `organizeImports.test.ts` they are
 * flush left inside the literal:
 *
 *     const input = `import Array "mo:base/Array";
 *     import { map "mo:base/Array";
 *
 *     actor {}`;
 *
 * A naive "drop every line starting with `import`" filter therefore deletes 67 lines from *inside*
 * test inputs — silently replacing most of the organize-imports corpus with unrelated text. So the
 * strip is bounded: only the leading run of import statements, and it stops at the first line that is
 * neither an import, nor blank, nor a comment.
 */
function transform(source) {
    const lines = source.split('\n');
    const out = [];
    let inPrologue = true;
    for (const line of lines) {
        if (inPrologue) {
            if (
                /^\s*import\s/.test(line) ||
                /^\s*$/.test(line) ||
                /^\s*\/\//.test(line)
            ) {
                continue;
            }
            inPrologue = false;
        }
        out.push(line);
    }
    return out.join('\n');
}

async function extractSuite(name) {
    const path = resolve(ROOT, SUITES[name]);
    const source = readFileSync(path, 'utf8');

    const calls = [];
    const cases = [];
    const depth = [];
    /**
     * `test()` registers; the body runs later, in registration order.
     *
     * It has to be this way: every test body is `async`, and its `format` calls sit *after* an
     * `await`, so they land in microtasks that have not run yet when `test` returns. Recording
     * synchronously would drop every case but the first — which is exactly what the first version
     * of this script did (68 calls for 68 tests, when `extra whitespace` alone makes three).
     */
    const queue = [];

    const prettier = {
        format: (input, options) => {
            calls.push({ input, options: options ?? {} });
            return `__sentinel_${calls.length}__`;
        },
    };

    const describe = (title, fn) => {
        depth.push(title);
        fn();
        depth.pop();
    };

    const test = (title, fn) => {
        queue.push({ group: depth.join(' > '), name: title, fn });
    };

    const expect = () => anything();

    // The transformed body is a real ES module, so the stubs reach it as globals. Nothing in these
    // suites shadows those four names.
    globalThis.prettier = prettier;
    globalThis.describe = describe;
    globalThis.test = test;
    globalThis.it = test;
    globalThis.expect = expect;
    // The suites put the old engine in `prettierOptions.plugins`; the stub ignores it, but the name
    // still has to resolve.
    globalThis.motokoPlugin = {};

    // `.ts`, not `.mjs`: the suites carry a handful of type annotations (`prettier.Options`) and
    // Node strips types from `.ts` by default, which it does not do for `.mjs`.
    mkdirSync(SCRATCH, { recursive: true });
    const outPath = resolve(SCRATCH, `${name}.ts`);
    writeFileSync(outPath, `"use strict";\n${transform(source)}\n`);

    // Cache-busted so a second suite (or a re-run in the same process) re-evaluates rather than
    // returning the first evaluation's module.
    await import(`${pathToFileURL(outPath).href}?v=${Date.now()}`);

    for (const entry of queue) {
        const before = calls.length;
        await entry.fn();
        calls.slice(before).forEach((call, i) => {
            cases.push({
                suite: name,
                group: entry.group,
                name: entry.name,
                index: i,
                input: call.input,
                options: call.options,
            });
        });
    }
    return cases;
}

const args = process.argv.slice(2);
const suiteArg = args.includes('--suite')
    ? args[args.indexOf('--suite') + 1]
    : 'all';
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

const names = suiteArg === 'all' ? Object.keys(SUITES) : [suiteArg];
const all = [];
for (const name of names) {
    if (!(name in SUITES)) {
        console.error(
            `unknown suite ${name}; expected one of ${Object.keys(SUITES).join(', ')}`,
        );
        process.exit(2);
    }
    all.push(...(await extractSuite(name)));
}

const payload = JSON.stringify(all, null, 2);
if (outArg) {
    writeFileSync(resolve(ROOT, outArg), payload + '\n');
    console.log(`${all.length} cases -> ${outArg}`);
} else {
    console.log(payload);
}

const perSuite = {};
for (const c of all) perSuite[c.suite] = (perSuite[c.suite] ?? 0) + 1;
console.error(
    `extracted ${all.length} format() calls: ` +
        Object.entries(perSuite)
            .map(([k, v]) => `${k}=${v}`)
            .join(' '),
);
