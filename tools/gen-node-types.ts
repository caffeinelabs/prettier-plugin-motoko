#!/usr/bin/env node
/**
 * Regenerates src/parser/nodes.generated.ts from the pinned grammar's node-types.json and parser.c.
 *
 * Usage: node tools/gen-node-types.ts [--grammar <path-to-node-types.json>] [--check]
 *
 * Without --grammar it reads the grammar pinned as a devDependency, so the generated file cannot drift from it.
 * --check exits non-zero if the file on disk differs from a fresh generation.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

/** Asserted in `headSymbolIds` to catch extraction mistakes. */
const EXPECTED_HEAD_SYMBOL_COUNT = 20;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const outFile = join(repoRoot, 'src', 'parser', 'nodes.generated.ts');

function defaultNodeTypesPath(): { path: string; grammarVersion: string } {
    const require = createRequire(join(repoRoot, 'package.json'));
    const pkgJson = require.resolve('tree-sitter-motoko/package.json');
    const pkgRoot = dirname(pkgJson);
    return {
        path: join(pkgRoot, 'src', 'node-types.json'),
        grammarVersion: require(pkgJson).version as string,
    };
}

function defaultGrammarRoot(): string {
    const require = createRequire(join(repoRoot, 'package.json'));
    return dirname(require.resolve('tree-sitter-motoko/package.json'));
}

/**
 * Head-mode symbol ids, read from the grammar's generated src/parser.c.
 *
 * Head rules (`<name>_head`) are aliased onto `<name>` or `<name>_block`, names shared with non-head nodes,
 * so only the grammar symbol id (`grammarId`) tells them apart.
 * Read rather than hardcoded, because a literal list of ids would go stale silently on a grammar bump.
 * Counts `*_head` rules plus `_par_exp_tight`, the glued `(` that head mode allows and object mode does not.
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

    // The parser resolves every glued paren in head position to `_par_exp_tight`, so this rule never occurs.
    const UNREACHABLE = new Set(['parenthetical_exp_head']);

    const out: number[] = [];
    for (const [designator, name] of names) {
        // Hidden rules (leading underscore) never surface as a node's `grammarId`, but sit among the head rules.
        if (name.startsWith('_')) continue;
        const bare = designator.replace(/^sym_/, '');
        const isHeadRule = /_head$/.test(bare) || bare === '_par_exp_tight';
        if (!isHeadRule || UNREACHABLE.has(bare)) continue;
        const id = ids.get(designator);
        if (id === undefined) continue;
        out.push(id);
    }
    if (out.length !== EXPECTED_HEAD_SYMBOL_COUNT) {
        throw new Error(
            `headSymbolIds: expected ${EXPECTED_HEAD_SYMBOL_COUNT} head symbols for the pinned ` +
                `grammar, found ${out.length} [${out.sort((a, b) => a - b).join(', ')}]. ` +
                'If the grammar legitimately changed, update EXPECTED_HEAD_SYMBOL_COUNT.',
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
 * Suffixes of the grammar's per-mode aliases (`call_exp_object`, `call_exp_block`), collapsed into one kind plus a `mode`.
 * `_block` is head mode (`head_alias` maps `<name>_head` to `<name>_block`); `_object` is ordinary expression mode.
 */
const MODE_SUFFIXES = ['_block', '_object'];

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

function tsKey(s: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) ? s : tsString(s);
}

function generate(
    nodeTypes: NodeTypeEntry[],
    grammarVersion: string,
    headIds: number[],
): string {
    const named = nodeTypes.filter((n) => n.named);

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
    lines.push(
        '// GENERATED FILE — do not edit by hand. Regenerate with `npm run gen:node-types`.',
    );
    lines.push(
        `// Source: tree-sitter-motoko@${grammarVersion} (src/node-types.json).`,
    );
    lines.push('');
    lines.push('/**');
    lines.push(
        ' * Expression mode. `block` is head mode (an unparenthesised control head, where `{` always opens the body); `object` is ordinary expression mode.',
    );
    lines.push(
        ' * `modes` below lists alias suffixes only: a head node aliased to a bare name has none, and is found by `HEAD_SYMBOL_IDS`.',
    );
    lines.push(' */');
    lines.push("export type NodeMode = 'block' | 'object';");
    lines.push('');
    lines.push(
        '/** Every named node kind the pinned grammar can produce, with its aliases, suffix modes and fields. */',
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
    lines.push('export type NodeKind = keyof typeof NODE_KINDS;');
    lines.push('');
    lines.push(
        'export const ALL_NODE_KINDS: readonly NodeKind[] = Object.keys(NODE_KINDS) as NodeKind[];',
    );
    lines.push('');
    lines.push(`export const GRAMMAR_VERSION = ${tsString(grammarVersion)};`);
    lines.push('');
    lines.push(
        '/** Symbol ids of head-mode nodes: the alias makes `node.type` ambiguous, so test `node.grammarId` against this set. */',
    );
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
        // `--grammar` points into the grammar's `src/`, next to `parser.c`.
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
    // Format with the repo's Prettier config so `gen:node-types:check` and `format:check` agree.
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
            // A missing file fails the check.
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

// Print just the message, not Node's unhandled-rejection stack trace.
main().catch((error) => {
    console.error(
        `gen-node-types: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
});
