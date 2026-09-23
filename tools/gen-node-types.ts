#!/usr/bin/env node
/**
 * Regenerates src/parser/nodes.generated.ts from the pinned grammar's node-types.json.
 *
 * The plan's rule: "Generated node types plus exhaustive `switch` in the printer. A grammar bump
 * that adds or renames a node fails `tsc`, not a user's format run." This is the generator behind
 * that rule.
 *
 * Usage:
 *   node tools/gen-node-types.ts [--grammar <path-to-node-types.json>] [--check]
 *
 * Without --grammar it reads the grammar out of the package the plugin has pinned as a
 * devDependency, so the generated file and the pinned grammar can never drift apart by accident.
 * --check regenerates in memory and exits non-zero if the file on disk differs; CI runs it that
 * way, so a grammar bump without a regeneration is caught.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

/**
 * How many head-mode symbols the pinned grammar has. Checked, not assumed — see `headSymbolIds`.
 * Redundant with the length check below, and deliberately so: it is the assertion that would have
 * caught the six hidden `_exp_*_head` rules and the unreachable `parenthetical_exp_head` being
 * folded in, both of which happened while this generator was written.
 */
const EXPECTED_HEAD_SYMBOL_COUNT = 20;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const outFile = join(repoRoot, 'src', 'parser', 'nodes.generated.ts');

/** Resolve the pinned grammar's node-types.json from wherever the tail of the path lands. */
function defaultNodeTypesPath(): { path: string; grammarVersion: string } {
    const require = createRequire(join(repoRoot, 'package.json'));
    // The grammar package ships node-types.json under src/ but does not export it, so resolve the
    // package root via package.json and walk to the file rather than require()ing it directly.
    const pkgJson = require.resolve('tree-sitter-motoko/package.json');
    const pkgRoot = dirname(pkgJson);
    return {
        path: join(pkgRoot, 'src', 'node-types.json'),
        grammarVersion: require(pkgJson).version as string,
    };
}

/** The pinned grammar's package root, for the files that live beside node-types.json. */
function defaultGrammarRoot(): string {
    const require = createRequire(join(repoRoot, 'package.json'));
    return dirname(require.resolve('tree-sitter-motoko/package.json'));
}

/**
 * The head-mode symbol ids, read out of the grammar's generated `src/parser.c`.
 *
 * `docs/normalize.md` §4.3 explains why this set exists and why it cannot be derived from a node's
 * visible type: head mode is registered as `<name>_head` and then **aliased**, either back to the
 * bare `<name>` or onto `<name>_block`, so an aliased head node reports a name it shares with a
 * non-head node. The grammar symbol id — what tree-sitter exposes as `grammarId` — still
 * distinguishes them, and these are those ids.
 *
 * Read from `parser.c` rather than hardcoded because a literal list of 20 integers would go stale
 * silently on a grammar bump: regenerating the types would keep compiling while `mode` quietly went
 * wrong on some nodes. Reading the compiled table means a bump either updates this set or changes
 * what it contains, and either way it is visible in the regenerated file's diff.
 *
 * The extraction is deliberately narrow: a symbol counts only when its C designator ends in
 * `_head` **or** it is the tight-apply rule (`_par_exp_tight`, the glued `(` that head mode allows
 * and object mode does not — `docs/normalize.md` §4.1). `parenthetical_exp` also has a `_head`
 * rule in `grammar.js`, but it is unreachable: it appears nowhere in the 1828-file corpus
 * (`.probe/_head-census.mjs`), and `docs/normalize.md` §4.3's set of 20 excludes it. Filtering it
 * out is therefore not a guess, it is the difference between the two.
 */
function headSymbolIds(grammarRoot: string): number[] {
    const parserC = readFileSync(join(grammarRoot, 'src', 'parser.c'), 'utf8');

    // The `enum ts_symbol_identifiers` block maps symbolic name -> numeric id.
    const ids = new Map<string, number>();
    const enumBody = parserC.match(
        /enum ts_symbol_identifiers \{([\s\S]*?)\n\};/,
    );
    if (!enumBody) {
        throw new Error(
            'headSymbolIds: could not find `enum ts_symbol_identifiers` in parser.c; ' +
                'the grammar was regenerated with a different tree-sitter layout',
        );
    }
    for (const m of enumBody[1].matchAll(/^\s*(\w+) = (\d+),$/gm)) {
        ids.set(m[1], Number(m[2]));
    }

    // The `ts_symbol_names` table maps the same symbolic name -> the name the CST reports.
    const names = new Map<string, string>();
    const tableStart = parserC.indexOf(
        'static const char * const ts_symbol_names[] = {',
    );
    if (tableStart < 0) {
        throw new Error(
            'headSymbolIds: could not find `ts_symbol_names` in parser.c',
        );
    }
    const table = parserC.slice(tableStart);
    for (const m of table
        .slice(0, table.indexOf('\n};'))
        .matchAll(/\[(\w+)\] = "((?:[^"\\]|\\.)*)"/g)) {
        names.set(m[1], m[2]);
    }

    // `parenthetical_exp_head` declares a `_head` rule that nothing ever reports: it is the
    // glued-paren-*then-call* rule, and the parser resolves every glued paren in head position to
    // `_par_exp_tight` (191) instead. It occurs zero times in the 1828-file corpus
    // (`.probe/_head-census.mjs`: `par_exp=11 … parenthetical_exp=0`), and `docs/normalize.md`
    // §4.3's validated set of 20 excludes it. Dropping an id that never occurs changes no
    // classification; it only keeps the set honest about which rules are live.
    const UNREACHABLE = new Set(['parenthetical_exp_head']);

    const out: number[] = [];
    for (const [designator, name] of names) {
        // A hidden rule (`_exp_nullary_head`, …) cannot be a `Node`: tree-sitter marks a symbol
        // hidden by a leading underscore, and `grammarId` on a visible node never lands on one.
        // They sit numerically adjacent to the real head rules (185–190), which is why they must be
        // filtered rather than merely tolerated.
        if (name.startsWith('_')) continue;
        // The designator carries a `sym_` prefix; the exported name above does not.
        const bare = designator.replace(/^sym_/, '');
        const isHeadRule = /_head$/.test(bare) || bare === '_par_exp_tight';
        if (!isHeadRule || UNREACHABLE.has(bare)) continue;
        const id = ids.get(designator);
        if (id === undefined) continue;
        out.push(id);
    }
    // The count is the one externally-checked fact about this set (`docs/normalize.md` §8.2
    // reports 20, with 0 unexplained nodes over 437k). A grammar bump that changes it is a real
    // event worth stopping for, so this fails rather than emitting a quietly different set.
    if (out.length !== EXPECTED_HEAD_SYMBOL_COUNT) {
        throw new Error(
            `headSymbolIds: expected ${EXPECTED_HEAD_SYMBOL_COUNT} head symbols for the pinned ` +
                `grammar, found ${out.length} [${out.sort((a, b) => a - b).join(', ')}]. ` +
                'If the grammar legitimately changed, update EXPECTED_HEAD_SYMBOL_COUNT, ' +
                'docs/normalize.md §4.3 and the census in §8.2 together.',
        );
    }
    return out.sort((a, b) => a - b);
}

function parseArgs(argv: string[]): {
    grammarPath: string | null;
    check: boolean;
} {
    let grammarPath: string | null = null;
    let check = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--grammar') grammarPath = argv[++i];
        else if (argv[i] === '--check') check = true;
        else throw new Error(`unknown argument: ${argv[i]}`);
    }
    return { grammarPath, check };
}

/**
 * Node kinds in the grammar come in per-mode families: the same construct is declared once per
 * expression mode and aliased with a suffix (`call_exp_object`, `call_exp_block`, plus the
 * unaliased `call_exp`). The normaliser collapses the suffix into a `mode` field, so the generated
 * union should carry the un-suffixed kind plus the set of modes that kind appears in — that way a
 * printer `switch` is exhaustive over kinds and each case can consult `node.mode`.
 *
 * `_block` is the head-mode alias (grammar.js: `head_alias` maps `<name>_head` to `<name>_block`).
 * `_object` is the ordinary expression mode. The bare kind is what a node is called when neither
 * suffix applies — e.g. `bin_op`, `identifier`, or a node the grammar declares outside a mode family.
 */
const MODE_SUFFIXES = ['_block', '_object'];

/**
 * The shape of one entry in the grammar's `node-types.json`.
 *
 * Typed here rather than left to `JSON.parse`'s `any` so the walk below is checked: this file is the
 * only place that reads the grammar's data layout, and a grammar that renames a key should fail
 * `tsc` here rather than silently generate an empty field list.
 */
interface NodeTypeEntry {
    type: string;
    named: boolean;
    fields?: Record<
        string,
        { multiple?: boolean; required?: boolean; types?: { type: string }[] }
    >;
    children?: {
        multiple?: boolean;
        required?: boolean;
        types?: { type: string }[];
    };
}

function stripMode(type: string): { base: string; mode: string | null } {
    for (const suffix of MODE_SUFFIXES) {
        if (type.endsWith(suffix)) {
            return {
                base: type.slice(0, -suffix.length),
                mode: suffix.slice(1),
            };
        }
    }
    return { base: type, mode: null };
}

function tsString(s: string): string {
    return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * A property key as Prettier would print it: bare when the name is a plain identifier, quoted
 * otherwise.
 *
 * This exists so `gen:node-types:check` and `format:check` cannot fight. Every node kind the grammar
 * declares happens to be a bare identifier today, so quoting them all would mean the generator's
 * output never matches what `prettier --write` produces — one CI job or the other would fail on a
 * freshly generated file. Emitting the unquoted form keeps both green, and the helper still does the
 * right thing if a future grammar ships a kind like `class-exp`.
 */
function tsKey(s: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) ? s : tsString(s);
}

function generate(
    nodeTypes: NodeTypeEntry[],
    grammarVersion: string,
    headIds: number[],
): string {
    const named = nodeTypes.filter((n) => n.named);

    /** base kind -> { modes: Set, fields: Map<field, type[]> } */
    const kinds = new Map<
        string,
        {
            modes: Set<string>;
            fields: Map<string, Set<string>>;
            aliases: Set<string>;
        }
    >();
    for (const node of named) {
        const { base, mode } = stripMode(node.type);
        if (!kinds.has(base)) {
            kinds.set(base, {
                modes: new Set(),
                fields: new Map(),
                aliases: new Set(),
            });
        }
        const kind = kinds.get(base)!;
        kind.aliases.add(node.type);
        if (mode) kind.modes.add(mode);
        for (const [field, def] of Object.entries(node.fields ?? {})) {
            if (!kind.fields.has(field)) kind.fields.set(field, new Set());
            for (const t of def.types ?? [])
                kind.fields.get(field)!.add(t.type);
        }
    }

    const baseKinds = [...kinds.keys()].sort();

    const lines: string[] = [];
    lines.push('// GENERATED FILE — do not edit by hand.');
    lines.push('//');
    lines.push(
        `// Generated by tools/gen-node-types.ts from tree-sitter-motoko@${grammarVersion}`,
    );
    lines.push(
        '// (src/node-types.json). Regenerate with `npm run gen:node-types`.',
    );
    lines.push('//');
    lines.push(
        '// A grammar bump that adds, removes or renames a node kind changes this file, which',
    );
    lines.push(
        "// fails `tsc` at the printer's exhaustive switch rather than at a user's format run.",
    );
    lines.push('');
    lines.push('/**');
    lines.push(
        ' * Expression mode. The grammar declares the same construct once per mode; the normaliser',
    );
    lines.push(
        ' * strips the alias suffix into this flag. `block` is head mode (an unparenthesised',
    );
    lines.push(
        ' * control head, where `{` always opens the body); `object` is ordinary expression',
    );
    lines.push(
        ' * position. A kind only ever appears in the modes listed for it below.',
    );
    lines.push(' */');
    lines.push("export type NodeMode = 'block' | 'object';");
    lines.push('');
    lines.push(
        '/** Every node kind the pinned grammar can produce, with the modes it appears in. */',
    );
    lines.push('export const NODE_KINDS = {');
    for (const base of baseKinds) {
        const kind = kinds.get(base)!;
        const modes = [...kind.modes].sort();
        const fields = [...kind.fields.keys()].sort();
        lines.push(`    ${tsKey(base)}: {`);
        lines.push(
            `        aliases: [${[...kind.aliases].sort().map(tsString).join(', ')}],`,
        );
        lines.push(`        modes: [${modes.map(tsString).join(', ')}],`);
        lines.push(`        fields: [${fields.map(tsString).join(', ')}],`);
        lines.push('    },');
    }
    lines.push('} as const;');
    lines.push('');
    lines.push('/** A node kind, discriminated at the type level. */');
    lines.push('export type NodeKind = keyof typeof NODE_KINDS;');
    lines.push('');
    lines.push(
        '/** All node kinds as a runtime list, e.g. for exhaustiveness tests. */',
    );
    lines.push(
        'export const ALL_NODE_KINDS: readonly NodeKind[] = Object.keys(NODE_KINDS) as NodeKind[];',
    );
    lines.push('');
    lines.push(`/** The grammar version these types were generated from. */`);
    lines.push(`export const GRAMMAR_VERSION = ${tsString(grammarVersion)};`);
    lines.push('');
    lines.push('/**');
    lines.push(
        ' * Grammar symbol ids that mean **head mode**. `node.grammarId` is a member of this set',
    );
    lines.push(
        ' * exactly when the node was produced by a `<name>_head` rule. This is the only reliable',
    );
    lines.push(
        ' * test: the alias makes `node.type` ambiguous, which is the whole reason head mode needs',
    );
    lines.push(
        ' * its own flag. See `docs/normalize.md` §4.3 for why the visible suffix is not enough.',
    );
    lines.push(' */');
    lines.push(
        `export const HEAD_SYMBOL_IDS: ReadonlySet<number> = new Set([${headIds.join(', ')}]);`,
    );
    lines.push('');
    return lines.join('\n');
}

async function main() {
    const { grammarPath, check } = parseArgs(process.argv.slice(2));

    let path = grammarPath;
    let grammarVersion: string;
    let grammarRoot: string;
    if (!path) {
        const resolved = defaultNodeTypesPath();
        path = resolved.path;
        grammarVersion = resolved.grammarVersion;
        grammarRoot = defaultGrammarRoot();
    } else {
        // An explicit --grammar path: take the version from the nearest package.json if there is one,
        // otherwise say so, rather than inventing a version string. The grammar root is the parent of
        // the directory holding node-types.json, which is where src/parser.c lives.
        grammarRoot = dirname(dirname(path));
        try {
            grammarVersion = JSON.parse(
                readFileSync(join(dirname(path), '..', 'package.json'), 'utf8'),
            ).version;
        } catch {
            grammarVersion = 'unknown';
        }
    }

    const nodeTypes: NodeTypeEntry[] = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(nodeTypes)) {
        throw new Error(`${path} did not parse as a node-types array`);
    }
    // Run the generator's output through Prettier with the repo's own config before comparing or
    // writing it. Without this, `gen:node-types:check` and `format:check` disagree the moment a kind
    // has enough aliases or fields to exceed `printWidth` — the generator would emit one long line
    // and Prettier would want it wrapped, so one of the two CI jobs fails on a fresh file. Formatting
    // here makes them agree by construction instead of by hand-tuned column widths.
    const generated = await prettier.format(
        generate(nodeTypes, grammarVersion, headSymbolIds(grammarRoot)),
        {
            ...(await prettier.resolveConfig(outFile)),
            filepath: outFile,
        },
    );

    if (check) {
        let current = null;
        try {
            current = readFileSync(outFile, 'utf8');
        } catch {
            // Missing file is a failure in check mode: it means it was never generated.
        }
        if (current !== generated) {
            console.error(
                `gen-node-types: ${relative(repoRoot, outFile)} is out of date.`,
            );
            console.error(
                `  generated from: ${path} (tree-sitter-motoko@${grammarVersion})`,
            );
            console.error('  run: npm run gen:node-types');
            process.exit(1);
        }
        console.log(
            `gen-node-types: ${relative(repoRoot, outFile)} is up to date.`,
        );
        return;
    }

    writeFileSync(outFile, generated);
    console.log(`gen-node-types: wrote ${relative(repoRoot, outFile)}`);
    console.log(`  from ${path} (tree-sitter-motoko@${grammarVersion})`);
    console.log(
        `  ${nodeTypes.filter((n) => n.named).length} named entries, ${new Set(nodeTypes.map((n) => n.type)).size} distinct types`,
    );
}

// `main` is async now that it formats through Prettier; surface a rejection as a non-zero exit
// rather than an unhandled rejection, which older Node prints but exits 0 on.
main().catch((error) => {
    console.error(
        `gen-node-types: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
});
