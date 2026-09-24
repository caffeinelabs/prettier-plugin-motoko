// The `motokoOrganizeImports` fixed-point regression probe.
//
// `organizeImportSection` must be **idempotent**: its output is re-parsed and re-printed by
// `src/index.ts`, so `format(format(x)) == format(x)` is the property that keeps a file from changing
// under a second run. The 323-case legacy corpus is the broad check (`tools/legacy-port.mjs` reports a
// `not idempotent` count), and this probe is the narrow one that names the mechanism when it fails.
//
// It exists because it caught a real bug. Measured on the missing-semicolon shape:
//
//   import Array "mo:base/Array"      <- no `;`
//   import Text "mo:base/Text";
//
//     format #1 -> "...Array\";\n\nimport Text..."   (blank line between the imports)
//     format #2 -> "...Array\";\nimport Text..."     (no blank line)
//
// The cause was not the printer. `readSection` walked root children and `break`ed at the first
// non-import, non-comment node; the grammar parses a `;`-less `import` as a **call expression** over
// the identifier `import`, so the walk ended one import early. The remaining import fell into `tail`,
// which `organizeImportSection` re-spaces — a partial rewrite, and therefore not a fixed point.
// `readSection` now refuses the file instead, and this probe asserts the class, not just that case.
//
// Usage: node --experimental-strip-types tools/probe/semi-shape.mts

import { parse } from '../../src/parser/parse.ts';
import { organizeImportSection } from '../../src/organize/imports.ts';

const prettier = (await import('prettier')).default;
const plugin = (await import('../../src/index.ts')).default;

/** The legacy suite's case, which is where the bug surfaced. Named for the ledger it appears in. */
const CORPUS =
    'import Array "mo:base/Array"\nimport Text "mo:base/Text";\n\nactor {}';

const OPTIONS = {
    parser: 'motoko',
    plugins: [plugin],
    printWidth: 80,
    tabWidth: 2,
    trailingComma: 'none',
    motokoOrganizeImports: true,
} as never;

/**
 * Shapes the pass must be a fixed point on. The first is the measured regression; the rest are the
 * neighbours a change to `readSection` could plausibly break while the first still passes — a
 * semicolon-less import that is *last* in its section, and the legal section with a comment inside.
 */
const SHAPES: Array<[string, string]> = [
    ['missing `;` before another import', CORPUS],
    ['missing `;`, then actor', 'import Array "mo:base/Array"\n\nactor {}\n'],
    ['missing `;`, nothing after', 'import Array "mo:base/Array"\n'],
    [
        'two imports, both terminated',
        'import A "mo:a";\nimport B "mo:b";\n\nactor {}\n',
    ],
    [
        'plain section still organizes',
        'import Text "mo:base/Text";\nimport Array "mo:base/Array";\n\nactor {}\n',
    ],
    [
        'comment between imports',
        'import A "mo:a";\n\n// c\nimport B "mo:b";\n\nactor {}\n',
    ],
    [
        'header comment before the section',
        '// header\nimport A "mo:a";\n\nactor {}\n',
    ],
    ['`=` spelling', 'import A = "mo:a";\nimport B = "mo:b";\n\nactor {}\n'],
];

/** Dump the root children so separators are visible rather than inferred. */
async function children(label: string, source: string) {
    const { root } = await parse(source);
    console.log(`--- ${label} ---`);
    root.children.forEach((c, i) => {
        const kind =
            c.nodeType === 'Branch'
                ? `Branch(${c.kind})`
                : `Token(${JSON.stringify(c.text)})`;
        console.log(
            `  [${i}] ${kind.padEnd(22)} ${JSON.stringify(source.slice(c.startIndex, c.endIndex))}`,
        );
    });
}

let failures = 0;

console.log('=== fixed point per shape (the assertion) ===');
for (const [label, source] of SHAPES) {
    const once = await prettier.format(source, OPTIONS);
    const twice = await prettier.format(once, OPTIONS);
    const thrice = await prettier.format(twice, OPTIONS);
    const stable = once === twice && twice === thrice;
    if (!stable) failures += 1;
    console.log(`  ${stable ? 'ok  ' : 'FAIL'} ${label}`);
    if (!stable) {
        console.log(`       #1 ${JSON.stringify(once)}`);
        console.log(`       #2 ${JSON.stringify(twice)}`);
        console.log(`       #3 ${JSON.stringify(thrice)}`);
    }
}

// The pass's own decision on each generation, for the regression shape. `pass(#2)` declining is the
// expected end state: a fixed point has nothing left to organize, so it returns `null`.
console.log(
    '\n=== the pass alone, on each generation of the regression shape ===',
);
let generation = CORPUS;
for (let i = 1; i <= 3; i += 1) {
    const { root } = await parse(generation);
    const out = await organizeImportSection(generation, root, 'preserve');
    console.log(
        `  #${i - 1} -> ${out === null ? 'null (declined)' : JSON.stringify(out)}`,
    );
    if (out === null) break;
    generation = out;
}

console.log('\n=== root children ===');
await children('the regression shape (parsed as call_exp)', CORPUS);
await children('its formatted output', await prettier.format(CORPUS, OPTIONS));

console.log(
    `\n${failures === 0 ? 'ALL SHAPES STABLE' : `${failures} SHAPE(S) NOT A FIXED POINT`}`,
);
process.exitCode = failures === 0 ? 0 : 1;
