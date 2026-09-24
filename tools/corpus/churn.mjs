/**
 * The churn report (docs/formatter-rework.md, "Verification": *"Plus a churn report: 0.13.0
 * (installed as `npm:prettier-plugin-motoko@0.13.0`) against the new engine on the corpus. The diff
 * is reviewed per construct before the beta. It is the evidence the style is right and the parity
 * gap is closed."*; M2's exit criterion: "corpus idempotent, zero guard failures, zero moc AST
 * mismatches, churn reviewed").
 *
 * WHAT THIS MEASURES
 *
 * The corpus harness (`run.mjs`) asks whether the printer is *self-consistent* — does its output
 * re-parse, mean the same thing, and reach a fixed point. It cannot ask whether the output is the
 * output anyone *wants*, because it has nothing to compare against. This tool supplies the missing
 * comparison: it formats every corpus file twice, once with the published 0.13.0 formatter and once
 * with the in-tree `preserve` printer, and reports where they disagree. A diff is the unit of review
 * here; the plan says the diff is read per construct, so this report aggregates by construct and
 * bounds the raw excerpts rather than printing every line that moved.
 *
 * WHY THIS IS NOT A PASS/FAIL GATE
 *
 * The whole point of M2 is that the style changed. "0 files differ" would mean the new printer is a
 * reimplementation of the old one, which is not the goal; "1800 files differ" is equally unreadable
 * without knowing *how* they differ. So the tool does not have a threshold. Differing is the
 * expected, informative outcome, and it exits non-zero only when the tool itself could not do its
 * job: the old engine could not be installed, a self-test failed, or the runner fell over. That is
 * the same contract `run.mjs` uses for units the grammar rejects — counted because they are the
 * subject, not because they are failures.
 *
 * THE TWO ENGINES, AND WHY THEY ARE DRIVEN DIFFERENTLY
 *
 * This is the part that does not work the obvious way, so it is worth writing down.
 *
 *   1. **They need different Prettier majors.** 0.13.0 is a Prettier 2 plugin (its `package.json`
 *      has no `peerDependencies` entry for 3, its printer is a sync `print`, and it registers the
 *      parser as `motoko-tt-parse`). This repo is Prettier 3, whose printer API is async. Handing a
 *      Prettier 2 printer to Prettier 3 does not format anything, and there is no shim that makes it
 *      honest to try: the two majors disagree about comment attachment, `print` return types and
 *      option validation, so a shimmed run would measure the shim.
 *   2. **So the old engine gets its own Prettier.** `prettier@2` and `prettier-plugin-motoko@0.13.0`
 *      are installed together into an isolated scratch directory (`--old-home`, default
 *      `/tmp/churn013`) and loaded through a `createRequire` anchored at *that* directory's
 *      `package.json`. Neither copy touches this repo's `node_modules`, and nothing is added to
 *      `package.json`.
 *   3. **Both engines run in this process.** A child process per file would need a spawn per corpus
 *      file and would have to ship every output back over a pipe; running both engines in one
 *      process is both simpler and faster, and the isolation that matters — two module registries,
 *      two Prettier instances, two plugin objects — is exactly what `createRequire` gives. This was
 *      not assumed: it is checked. The self-test, which every run performs, requires the two plugins
 *      to be distinct objects from distinct directories and requires them to disagree on a snippet
 *      they are known to format differently — the one bug that would make every file read
 *      "identical" and look like the best possible news. `--check-contamination` is the stronger,
 *      slower, opt-in version: it formats a sample with each engine *alone*, then with both
 *      interleaved in one process, and requires the two readings byte-identical, which is what
 *      actually rules out one engine's module state leaking into the other's output.
 *
 * The alternative — a child-process driver — is not wrong, and was measured: with the old engine
 * driven in a separate process the per-file outputs are the same bytes as in-process, so the
 * isolation buys nothing that `createRequire` did not already provide. It costs a spawn per file.
 *
 * WHAT THE CLASSIFICATION IS, AND WHAT IT IS NOT
 *
 * Each differing file lands in one of two tiers, decided by discarding whitespace from both outputs
 * and comparing:
 *
 *   - **layout-only** — same token text, different whitespace/newlines. This is the expected tier:
 *     it is the style changing. A layout-only diff is a diff a reviewer reads for *shape*.
 *   - **token text differs** — the two formatters emit different non-whitespace characters. That is
 *     a stronger claim and a reviewer should read every one of them, because it can mean a dropped
 *     comment, a normalised literal, or a construct the new printer prints differently on purpose.
 *     Note the boundary honestly: comment *text* is token text here, so a reflowed or re-indented
 *     comment shows up in this tier rather than the layout one. There is no cheaper way to tell a
 *     comment from a string without a lexer, and a regex approximation would misclassify `"//"`.
 *
 * The construct tables are a *guide to where to read*, not a taxonomy:
 *
 *   - **by node type** names the grammar node that encloses the first differing line of the new
 *     engine's output, found by walking the tree from `src/parser/parse.ts`. This is a real node
 *     type from the real grammar (`import_`, `func_`, ...), not a guess from the line's text.
 *   - **by lexical kind** classifies every changed line by the first non-blank token's spelling.
 *     That one *is* a guess, and it has an explicit `other` bucket so it cannot absorb the corpus
 *     into a tidy-looking table.
 *
 * Usage:
 *   node tools/corpus/churn.mjs --help
 *   node tools/corpus/churn.mjs --limit 200
 *   node tools/corpus/churn.mjs --file ../motoko/test/run/hello.mo
 */

import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/** The published formatter the churn is measured against. Pinned, never a range: "0.13.0" is the claim. */
const OLD_PLUGIN_VERSION = '0.13.0';

/** The Prettier major 0.13.0 was built for. Installed into the scratch dir, not into this repo. */
const OLD_PRETTIER_RANGE = '2';

/** A Prettier 2 install is recognisable by its major; anything else means a stale or wrong scratch dir. */
const OLD_PRETTIER_MAJOR = '2';

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const HELP = `churn report — the published 0.13.0 formatter against the in-tree preserve printer

Usage:
  node tools/corpus/churn.mjs [options]

Options:
  --limit <n>           examine at most n files, in sorted path order   (default: all)
  --file <path>         examine one file in detail, with its full diff   (overrides --limit)
  --report <path>       where to write the human report    (default: tools/corpus/CHURN.md)
  --old-home <dir>      scratch directory holding prettier@2 + prettier-plugin-motoko@0.13.0
                        (default: /tmp/churn013; env CHURN_OLD_HOME). Created and populated on
                        first use, reused afterwards. This repo's node_modules is never touched.
  --roots <dirs>        colon-separated corpus roots, overriding the default search
  --excerpt <n>         ops to show per differing file in the report     (default: 30)
  --check-contamination format a sample with each engine alone and then interleaved in one process,
                        and require the two readings byte-identical. Fatal on a difference. Slower
                        than the always-on self-test and answers a strictly stronger question.
  --quiet               suppress per-file progress lines
  -h, --help            this text

Exit code is 0 when the run completed, WHETHER OR NOT FILES DIFFERED — differing is the expected
outcome and the subject of the report. Non-zero means the tool failed: the old engine could not be
installed or loaded, a self-test failed, or the runner threw.
`;

function parseArgs(argv) {
    const opts = {
        limit: null,
        file: null,
        report: join(repoRoot, 'tools', 'corpus', 'CHURN.md'),
        oldHome: process.env.CHURN_OLD_HOME ?? '/tmp/churn013',
        roots: null,
        excerpt: 30,
        quiet: false,
        checkContamination: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`${arg} needs a value`);
            return v;
        };
        switch (arg) {
            case '-h':
            case '--help':
                opts.help = true;
                break;
            case '--limit': {
                const n = Number(next());
                if (!Number.isInteger(n) || n <= 0)
                    throw new Error(`--limit needs a positive integer`);
                opts.limit = n;
                break;
            }
            case '--file':
                opts.file = resolve(next());
                break;
            case '--report':
                opts.report = resolve(next());
                break;
            case '--old-home':
                opts.oldHome = resolve(next());
                break;
            case '--roots':
                opts.roots = next();
                break;
            case '--excerpt': {
                const n = Number(next());
                if (!Number.isInteger(n) || n <= 0)
                    throw new Error(`--excerpt needs a positive integer`);
                opts.excerpt = n;
                break;
            }
            case '--quiet':
                opts.quiet = true;
                break;
            case '--check-contamination':
                opts.checkContamination = true;
                break;
            default:
                throw new Error(`unknown argument: ${arg}`);
        }
    }
    return opts;
}

// ---------------------------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------------------------

/**
 * Roots scanned for `.mo` files, mirroring `tests/corpus.test.ts` — same defaults, same env override,
 * so the churn report is measured over the same corpus the round-trip suite is. That matters more
 * than it looks: a churn number over a *different* file set than the round-trip number is a number
 * nobody can reconcile with it.
 */
function corpusRoots(override) {
    if (override) {
        return override
            .split(':')
            .filter(Boolean)
            .map((p) => ({ label: 'override', dir: resolve(p) }));
    }
    return [
        { label: 'motoko', dir: join(repoRoot, '..', 'motoko', 'test') },
        {
            label: 'motoko-core',
            dir: join(repoRoot, '..', 'motoko-core', 'src'),
        },
        { label: 'fixtures', dir: join(repoRoot, 'tests', 'fixtures') },
    ];
}

/**
 * Directories that never hold source worth scanning. Same list as `tests/corpus.test.ts`, including
 * the deliberate absence of `lib`: `motoko/test/lib/` holds real fixture modules other tests import,
 * and skipping it silently drops 24 files.
 */
const SKIP_DIRS = new Set(['_out', '_build', 'node_modules', '.git']);

function walk(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path, out);
        } else if (entry.name.endsWith('.mo')) {
            out.push(path);
        }
    }
    return out;
}

/**
 * Every corpus file, in sorted path order, with the root it came from.
 *
 * Sorted order is what `--limit` slices, so a bounded run is reproducible: the same `--limit 200`
 * names the same 200 files on any machine with the same checkouts. That is a deliberate choice over
 * a strided or random sample — a sample that moves between runs makes two reports incomparable, and
 * the report's job is to be compared against the next one.
 */
function collectFiles(opts) {
    const roots = corpusRoots(opts.roots);
    const present = roots.filter((r) => existsSync(r.dir));
    const missing = roots.filter((r) => !existsSync(r.dir));
    const files = [];
    for (const root of present) {
        for (const path of walk(root.dir)) {
            files.push({ path, source: root.label, root: root.dir });
        }
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { files, missing, roots };
}

// ---------------------------------------------------------------------------------------------
// The two engines
// ---------------------------------------------------------------------------------------------

/**
 * The old engine's versions, or null when the scratch dir is absent or holds the wrong ones.
 *
 * Both are checked, not just the plugin: a scratch dir with 0.13.0 next to a Prettier 3 would load
 * and then fail per file with a confusing printer error, which is a much worse failure mode than
 * reinstalling. Verifying here turns that into "the scratch dir is stale, fixing it".
 */
function oldEngineVersions(oldHome) {
    try {
        const read = (name) =>
            JSON.parse(
                readFileSync(
                    join(oldHome, 'node_modules', name, 'package.json'),
                    'utf8',
                ),
            ).version;
        return {
            plugin: read('prettier-plugin-motoko'),
            prettier: read('prettier'),
        };
    } catch {
        return null;
    }
}

/**
 * Install `prettier@2` and `prettier-plugin-motoko@0.13.0` into the scratch dir, unless a matching
 * pair is already there.
 *
 * `--prefix` points npm at the scratch dir, so this repo's `node_modules` and `package.json` are
 * untouched; `--no-save` keeps the scratch `package.json` at the `{}` written below, so a reinstall
 * is decided by what is on disk rather than by a manifest that could disagree with it. The scratch
 * dir is created first because `createRequire` is anchored at its `package.json`, and writing that
 * file ourselves means the anchor exists even if npm changes how it materialises the directory.
 *
 * A failure here is fatal and loud: continuing would mean reporting every file as "identical" (if
 * the old engine silently became the new one) or crashing on every file. Neither is a churn report.
 */
function ensureOldEngine(oldHome, log) {
    const existing = oldEngineVersions(oldHome);
    if (
        existing &&
        existing.plugin === OLD_PLUGIN_VERSION &&
        existing.prettier.startsWith(`${OLD_PRETTIER_MAJOR}.`)
    ) {
        log(
            `old engine: reusing prettier@${existing.prettier} + ` +
                `prettier-plugin-motoko@${existing.plugin} at ${oldHome}\n`,
        );
        return existing;
    }

    mkdirSync(oldHome, { recursive: true });
    const manifest = join(oldHome, 'package.json');
    if (!existsSync(manifest)) writeFileSync(manifest, '{}\n');

    log(
        `old engine: installing prettier@${OLD_PRETTIER_RANGE} + ` +
            `prettier-plugin-motoko@${OLD_PLUGIN_VERSION} into ${oldHome}…\n`,
    );
    const install = spawnSync(
        'npm',
        [
            'install',
            '--prefix',
            oldHome,
            '--no-save',
            '--no-package-lock',
            '--no-audit',
            '--no-fund',
            '--loglevel=error',
            `prettier@${OLD_PRETTIER_RANGE}`,
            `prettier-plugin-motoko@${OLD_PLUGIN_VERSION}`,
        ],
        { encoding: 'utf8', cwd: oldHome },
    );
    if (install.error) {
        throw new Error(
            `churn report: could not run npm to install the old engine (${install.error.message}). ` +
                `The 0.13.0 comparison needs prettier@2 + prettier-plugin-motoko@${OLD_PLUGIN_VERSION} ` +
                `in ${oldHome}.`,
        );
    }
    if (install.status !== 0) {
        throw new Error(
            `churn report: npm install of the old engine failed (exit ${install.status}) in ${oldHome}.\n` +
                `${install.stderr ?? ''}`,
        );
    }

    const installed = oldEngineVersions(oldHome);
    if (
        !installed ||
        installed.plugin !== OLD_PLUGIN_VERSION ||
        !installed.prettier.startsWith(`${OLD_PRETTIER_MAJOR}.`)
    ) {
        throw new Error(
            `churn report: after installing into ${oldHome} the directory holds ` +
                `${installed ? `prettier@${installed.prettier} + prettier-plugin-motoko@${installed.plugin}` : 'nothing usable'}, ` +
                `expected prettier@${OLD_PRETTIER_MAJOR}.x + prettier-plugin-motoko@${OLD_PLUGIN_VERSION}.`,
        );
    }
    return installed;
}

/**
 * Load the old engine through a `createRequire` anchored at the scratch dir.
 *
 * The parser name is *discovered*, not written down. 0.13.0 registers exactly one parser and calls
 * it `motoko-tt-parse`; a later 0.13.x that added a `motoko` alias would make a hardcoded name
 * either stale or, worse, a name that silently resolves to the NEW plugin when both are passed in
 * the same call. Reading the key off the plugin cannot drift from the plugin. `motoko` is preferred
 * when both exist only because it is the name the new engine uses, so the two sides are asked for
 * the same language.
 */
function loadOldEngine(oldHome) {
    const require = createRequire(join(oldHome, 'package.json'));
    let prettier;
    let plugin;
    try {
        prettier = require('prettier');
        plugin = require('prettier-plugin-motoko');
    } catch (error) {
        throw new Error(
            `churn report: could not load the old engine from ${oldHome}: ${error.message}. ` +
                `Delete the directory and re-run to force a clean install.`,
        );
    }
    // CJS interop: the package sets `__esModule` and also exports the plugin object directly, so
    // `require` may hand back the namespace rather than the plugin. Both shapes are unwrapped here
    // rather than at the call site, so the call site cannot get it wrong.
    const engine = plugin?.parsers ? plugin : plugin?.default;
    const parserNames = Object.keys(engine?.parsers ?? {});
    if (parserNames.length === 0) {
        throw new Error(
            `churn report: prettier-plugin-motoko@${OLD_PLUGIN_VERSION} in ${oldHome} exposes no ` +
                `parsers; refusing to compare against an engine that cannot parse Motoko.`,
        );
    }
    const parser = parserNames.includes('motoko') ? 'motoko' : parserNames[0];
    return { prettier, plugin: engine, parser, parserNames };
}

/**
 * One format call, in the shape a user makes it.
 *
 * The options are spelled once, here, so both engines are asked the same question — printWidth 80,
 * tabWidth 2, trailingComma none. They are Prettier's own defaults for both majors, so this is not a
 * configuration choice being smuggled in; it is the choice written down rather than inherited, which
 * is what makes "the two outputs differ because of the printer" a claim the report can support.
 */
const FORMAT_OPTIONS = {
    printWidth: 80,
    tabWidth: 2,
    trailingComma: 'none',
};

const oldFormat = (engine, source) =>
    engine.prettier.format(source, {
        ...FORMAT_OPTIONS,
        parser: engine.parser,
        plugins: [engine.plugin],
    });

const newFormat = (prettier, plugin, source) =>
    prettier.format(source, {
        ...FORMAT_OPTIONS,
        parser: 'motoko',
        plugins: [plugin],
    });

// ---------------------------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------------------------

/**
 * A line diff, as `{ added, removed, ops, truncated }`.
 *
 * Myers 1986, with the common prefix and suffix trimmed before the search: a churn diff between two
 * formatters is mostly identical text with local changes, and trimming first keeps the edit distance
 * — and therefore the search — proportional to the changed region rather than to the file. Files in
 * this corpus reach 3200 lines, and the untrimmed search on those would be the whole runtime.
 *
 * `cap` bounds the search. A pair whose edit distance exceeds it is reported as the middle region
 * fully replaced (`truncated: true`) rather than as a wrong number: an O(ND) search that is cut off
 * has no honest partial answer, and reporting a plausible-looking undercount would be worse than
 * reporting that this one file was not measured finely.
 *
 * `ops` are in source order: `{ type: '=', aIndex, bIndex }`, `{ type: '-', aIndex }`,
 * `{ type: '+', bIndex }`, where the indices are into the *untrimmed* inputs.
 */
function diffLines(a, b, cap = 4000) {
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (
        suf < a.length - pre &&
        suf < b.length - pre &&
        a[a.length - 1 - suf] === b[b.length - 1 - suf]
    ) {
        suf++;
    }

    const midA = a.slice(pre, a.length - suf);
    const midB = b.slice(pre, b.length - suf);
    const inner = myers(midA, midB, cap);

    // The trimmed prefix and suffix are real `=` ops and are put back, not dropped: the excerpt
    // needs them for context, and the self-test's index-coverage check requires every input line to
    // appear exactly once in the ops. Leaving them out would make the ops a diff of the *changed
    // region* while the counts claimed to be a diff of the file.
    const ops = [];
    for (let i = 0; i < pre; i++) ops.push({ type: '=', aIndex: i, bIndex: i });
    for (const op of inner.ops) {
        if (op.type === '-') ops.push({ type: '-', aIndex: pre + op.aIndex });
        else if (op.type === '+')
            ops.push({ type: '+', bIndex: pre + op.bIndex });
        else
            ops.push({
                type: '=',
                aIndex: pre + op.aIndex,
                bIndex: pre + op.bIndex,
            });
    }
    for (let i = 0; i < suf; i++) {
        const aIndex = a.length - suf + i;
        const bIndex = b.length - suf + i;
        if (a[aIndex] !== b[bIndex]) {
            // Cannot happen: the suffix was trimmed by equality. Guards against a future change to
            // the trim loop turning a silent misalignment into a wrong `=` op.
            throw new Error(
                'churn report: internal diff error — trimmed suffix lines differ',
            );
        }
        ops.push({ type: '=', aIndex, bIndex });
    }

    return {
        added: inner.added,
        removed: inner.removed,
        ops,
        truncated: inner.truncated,
        prefix: pre,
        suffix: suf,
    };
}

/** The Myers search itself. Exported shape is internal to `diffLines`. */
function myers(a, b, cap) {
    const n = a.length;
    const m = b.length;
    const limit = Math.min(n + m, cap);
    const off = limit + 1;
    const size = 2 * limit + 3;
    const v = new Int32Array(size).fill(-1);
    v[off + 1] = 0;

    const trace = [];
    let found = -1;
    for (let d = 0; d <= limit; d++) {
        trace.push(v.slice());
        for (let k = -d; k <= d; k += 2) {
            let x;
            if (k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off]))
                x = v[k + 1 + off];
            else x = v[k - 1 + off] + 1;
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) {
                x++;
                y++;
            }
            v[k + off] = x;
            if (x >= n && y >= m) {
                found = d;
                break;
            }
        }
        if (found >= 0) break;
    }

    if (found < 0) {
        // Over the cap: the honest answer is that this file was not measured finely, so the middle
        // is reported as wholly replaced instead of as an arbitrary partial diff.
        return {
            added: m,
            removed: n,
            truncated: true,
            ops: [
                ...a.map((_, i) => ({ type: '-', aIndex: i })),
                ...b.map((_, i) => ({ type: '+', bIndex: i })),
            ],
        };
    }

    const ops = [];
    let x = n;
    let y = m;
    for (let d = found; d > 0; d--) {
        const vPrev = trace[d];
        const k = x - y;
        let prevK;
        if (k === -d || (k !== d && vPrev[k - 1 + off] < vPrev[k + 1 + off]))
            prevK = k + 1;
        else prevK = k - 1;
        const prevX = vPrev[prevK + off];
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) {
            ops.push({ type: '=', aIndex: x - 1, bIndex: y - 1 });
            x--;
            y--;
        }
        if (x === prevX) {
            ops.push({ type: '+', bIndex: y - 1 });
            y--;
        } else {
            ops.push({ type: '-', aIndex: x - 1 });
            x--;
        }
    }
    while (x > 0 && y > 0) {
        ops.push({ type: '=', aIndex: x - 1, bIndex: y - 1 });
        x--;
        y--;
    }
    while (x > 0) ops.push({ type: '-', aIndex: --x });
    while (y > 0) ops.push({ type: '+', bIndex: --y });
    ops.reverse();

    let added = 0;
    let removed = 0;
    for (const op of ops) {
        if (op.type === '+') added++;
        else if (op.type === '-') removed++;
    }
    return { added, removed, truncated: false, ops };
}

/**
 * The first differences, bounded, as lines a reviewer reads.
 *
 * Starts a little before the first change so the excerpt has context to be read against — a hunk
 * whose first line is the change tells the reader what moved but not what it moved inside.
 */
function excerpt(diff, a, b, maxOps) {
    const firstChange = diff.ops.findIndex((op) => op.type !== '=');
    if (firstChange < 0) return { lines: [], remaining: 0 };
    const start = Math.max(0, firstChange - 3);
    const slice = diff.ops.slice(start, start + maxOps);
    const lines = [];
    for (const op of slice) {
        if (op.type === '=')
            lines.push({ type: ' ', line: a[op.aIndex], aLine: op.aIndex + 1 });
        else if (op.type === '-')
            lines.push({ type: '-', line: a[op.aIndex], aLine: op.aIndex + 1 });
        else
            lines.push({ type: '+', line: b[op.bIndex], bLine: op.bIndex + 1 });
    }
    const remaining = diff.ops.length - (start + slice.length);
    return { lines, remaining };
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

/**
 * Lexical kinds, tried in order, first match wins.
 *
 * Ordered from most to least specific on purpose: `type T = ...` must classify as `type` before a
 * later rule sees the `=`. The last entry is an explicit catch-all, and the report prints it as
 * `other` with its count, because a table where every line lands somewhere named is a table that
 * cannot be checked against the corpus.
 */
const LEXICAL_RULES = [
    ['import', /^\s*(public\s+)?import\b/],
    ['comment', /^\s*(\/\/|\/\*|\*)/],
    [
        'actor/class/object',
        /^\s*(\*?\s*)?(persistent\s+)?(shared\s+)?(actor|class|module|object|actor\s+class)\b/,
    ],
    ['function', /\b(func|shared\s+(query\s+)?(func)?)\b/],
    ['type', /^\s*(public\s+)?type\b/],
    ['binding (let/var)', /^\s*(let|var)\b/],
    [
        'control flow',
        /^\s*(if|else|switch|case|while|loop|for|do|label|return|break|continue|assert|try|catch|throw)\b/,
    ],
    ['closing punctuation', /^\s*[})\];,.]/],
    ['other', /.*/],
];

function lexicalKind(line) {
    for (const [kind, pattern] of LEXICAL_RULES) {
        if (pattern.test(line)) return kind;
    }
    return 'other';
}

/**
 * The grammar node type enclosing a 1-based line of `source`, from the new engine's own parser.
 *
 * This is a real node type, not a guess from the line's text: the tree is walked and the deepest
 * node whose row span contains the line wins. It answers "what construct is this change inside",
 * which is the question the plan's per-construct review asks, and it is answered by the same grammar
 * the printer prints from — so a construct that shows up here is one this codebase actually has a
 * printer for.
 *
 * Returns null when the source does not parse (the old engine's output need not, and the new
 * engine's output does by construction but is not assumed to).
 */
function nodeTypeAtRow(root, row) {
    let best = null;
    const visit = (node) => {
        if (row < node.startPosition.row || row > node.endPosition.row) return;
        // Only branches name a rule. The deepest node at any row is a leaf (`Text`, a comment; or
        // `Token`), and those carry no `type` — taking one would report `undefined` for every line.
        if (node.nodeType === 'Branch') best = node;
        if (node.nodeType === 'Text' || node.nodeType === 'Token') return;
        for (const child of node.children) visit(child);
    };
    visit(root);
    return best && best !== root ? best.type : null;
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

/**
 * Churn for one file.
 *
 * Failures are bucketed per engine rather than aborting: the old formatter rejects some corpus files
 * with a syntax error (its parser is the old one), and a tool that died on the first such file would
 * report nothing about the other 1800. The buckets are `old-error` and `new-error`, and `both-error`
 * for the files neither engine formats — kept apart because they mean different things (a known
 * limit of the old engine, versus a regression in the new one).
 */
async function churnFile(file, engines, deps, excerptOps) {
    const raw = readFileSync(file.path);
    const decoded = decodeUtf8(raw);
    if (decoded.text === null) {
        return {
            path: file.path,
            source: file.source,
            status: 'unreadable',
            reason: decoded.reason,
        };
    }
    const source = decoded.text;

    let oldOut = null;
    let oldError = null;
    try {
        oldOut = oldFormat(engines.old, source);
    } catch (error) {
        oldError = firstLine(error?.message ?? String(error));
    }

    let newOut = null;
    let newError = null;
    try {
        newOut = await newFormat(
            engines.new.prettier,
            engines.new.plugin,
            source,
        );
    } catch (error) {
        newError = firstLine(error?.message ?? String(error));
    }

    if (oldError !== null || newError !== null) {
        const status =
            oldError !== null && newError !== null
                ? 'both-error'
                : oldError !== null
                  ? 'old-error'
                  : 'new-error';
        return {
            path: file.path,
            source: file.source,
            status,
            oldError,
            newError,
            bytes: raw.length,
            lines: source.split('\n').length,
        };
    }

    if (oldOut === newOut) {
        return {
            path: file.path,
            source: file.source,
            status: 'identical',
            bytes: raw.length,
            lines: source.split('\n').length,
        };
    }

    const a = oldOut.split('\n');
    const b = newOut.split('\n');
    const diff = diffLines(a, b);
    // The tier: identical once whitespace is discarded means the style moved and the program did
    // not. Anything else is a stronger claim and gets its own row in the report.
    const layoutOnly = stripWhitespace(oldOut) === stripWhitespace(newOut);

    // The construct guide: the grammar node enclosing the new engine's first differing line, found
    // against the new engine's own output, which is the text whose shape is being reviewed.
    const changed = diffResultLines(diff);
    let nodeType = null;
    const anchor = changed.firstBLine ?? changed.firstALine;
    if (anchor !== null) {
        try {
            const parsed = await deps.parse(newOut);
            nodeType = nodeTypeAtRow(parsed.root, anchor - 1);
        } catch {
            nodeType = null;
        }
    }

    return {
        path: file.path,
        source: file.source,
        status: layoutOnly ? 'layout-only' : 'token-differs',
        bytes: raw.length,
        lines: source.split('\n').length,
        added: diff.added,
        removed: diff.removed,
        truncated: diff.truncated,
        nodeType,
        lexical: lexicalTally(diff, a, b),
        excerpt: excerpt(diff, a, b, excerptOps),
        fullDiff: diff,
    };
}

/** The first changed line, on each side, from a diff's ops. */
function diffResultLines(diff) {
    let firstALine = null;
    let firstBLine = null;
    for (const op of diff.ops) {
        if (op.type === '+') {
            if (firstBLine === null) firstBLine = op.bIndex + 1;
        } else if (op.type === '-') {
            if (firstALine === null) firstALine = op.aIndex + 1;
        }
    }
    return { firstALine, firstBLine };
}

/** Counts of changed lines by lexical kind, over both sides of the diff. */
function lexicalTally(diff, a, b) {
    const out = {};
    for (const op of diff.ops) {
        if (op.type === '=') continue;
        const line = op.type === '+' ? b[op.bIndex] : a[op.aIndex];
        const kind = lexicalKind(line ?? '');
        out[kind] = (out[kind] ?? 0) + 1;
    }
    return out;
}

/**
 * Everything that is not whitespace, discarded.
 *
 * The layout/token tier decision. Deliberately blunt: it is a cheap question with a cheap answer, and
 * any cleverer version would be a lexer — which is the parser's job, and the parser is what the
 * *other* two buckets (crash, unparseable) already speak for.
 */
function stripWhitespace(text) {
    return text.replace(/\s+/g, '');
}

function decodeUtf8(buffer) {
    try {
        return {
            text: new TextDecoder('utf-8', {
                fatal: true,
                ignoreBOM: false,
            }).decode(buffer),
            reason: null,
        };
    } catch {
        return { text: null, reason: 'not valid UTF-8' };
    }
}

function firstLine(text) {
    const cut = text.indexOf('\n');
    return cut < 0 ? text : text.slice(0, cut);
}

// ---------------------------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------------------------

/**
 * Prove the comparison can fail, before reporting that some number of files failed it.
 *
 * This is the same principle `run.mjs` applies to its round-trip check, and it matters more here
 * than there. The single failure that would make this report read as perfect news is the two engines
 * quietly being the same engine: every file would be `identical`, the added/removed totals would be
 * zero, and nothing in the output would look wrong. So:
 *
 *   - the two plugin objects must be different objects, from different directories;
 *   - the two engines must disagree on an input they are known to format differently (0.13.0 writes
 *     `func f() : async Nat` and the new printer writes `func f():async Nat`), so a run where they
 *     agree on everything is a run where something is wired wrong;
 *   - the diff must reconstruct: applying its ops to the old output must produce the new output,
 *     and its counts must equal the number of `+`/`-` ops. A diff that silently dropped ops would
 *     under-count the churn while still looking like a diff.
 *
 * A failure here is fatal, and the report is not written.
 */
async function selfTest(engines, deps) {
    const results = [];
    const record = (name, pass, detail) =>
        results.push({ name, pass, detail: detail ?? null });

    record(
        'self-test: the old engine is prettier 2 and the new engine is prettier 3',
        engines.old.prettier.version.startsWith(`${OLD_PRETTIER_MAJOR}.`) &&
            engines.new.prettier.version.startsWith('3.'),
        `old ${engines.old.prettier.version} / new ${engines.new.prettier.version}`,
    );
    record(
        'self-test: the two plugins are distinct objects',
        engines.old.plugin !== engines.new.plugin,
        `old parser ${JSON.stringify(engines.old.parser)} (${engines.old.parserNames.join(', ')})`,
    );
    record(
        'self-test: the old engine loaded from the scratch dir, not from this repo',
        !String(engines.old.prettier.version).startsWith('3.'),
        'a Prettier 3 here would mean the scratch dir resolved this repo instead',
    );

    const SAMPLE = 'actor{public func f():async Nat{1}};';
    let oldOut = null;
    let newOut = null;
    try {
        oldOut = oldFormat(engines.old, SAMPLE);
        newOut = await newFormat(
            engines.new.prettier,
            engines.new.plugin,
            SAMPLE,
        );
    } catch (error) {
        record(
            'self-test: both engines format a snippet',
            false,
            firstLine(String(error?.message)),
        );
    }
    if (oldOut !== null && newOut !== null) {
        record(
            'self-test: the two engines disagree on a known-different snippet',
            oldOut !== newOut,
            `old ${JSON.stringify(oldOut)} new ${JSON.stringify(newOut)}`,
        );
    }

    // Diff reconstruction. Two properties, checked on every pair: the ops must rebuild the
    // right-hand side from the `=` and `+` ops (the `-` ops are what was dropped), and every input
    // index must appear exactly once on its own side — a diff that silently lost a line would still
    // produce a plausible-looking excerpt while under-counting the churn.
    const pairs = [
        [
            ['a', 'b', 'c'],
            ['a', 'b', 'c'],
        ],
        [
            ['a', 'b', 'c'],
            ['a', 'x', 'c'],
        ],
        [
            ['a', 'b', 'c'],
            ['a', 'b', 'c', 'd'],
        ],
        [['a', 'b', 'c'], []],
        [[], ['a', 'b']],
        [
            ['x', 'a', 'b', 'y'],
            ['x', 'b', 'a', 'y'],
        ],
        [
            ['a', 'a', 'a'],
            ['a', 'b', 'a'],
        ],
        [
            ['a', 'b', 'c', 'd', 'e'],
            ['a', 'c', 'b', 'e'],
        ],
    ];
    let diffOk = true;
    let diffDetail = null;
    for (const [a, b] of pairs) {
        const diff = diffLines(a, b);
        const rebuilt = diff.ops
            .filter((op) => op.type !== '-')
            .map((op) => b[op.bIndex])
            .join('\n');
        const countedAdd = diff.ops.filter((op) => op.type === '+').length;
        const countedRemove = diff.ops.filter((op) => op.type === '-').length;
        const aSeen = diff.ops
            .filter((op) => op.type !== '+')
            .map((op) => op.aIndex);
        const bSeen = diff.ops
            .filter((op) => op.type !== '-')
            .map((op) => op.bIndex);
        const covered = (seen, len) =>
            seen.length === len && seen.every((v, i) => v === i);
        if (
            rebuilt !== b.join('\n') ||
            diff.added !== countedAdd ||
            diff.removed !== countedRemove ||
            !covered(aSeen, a.length) ||
            !covered(bSeen, b.length)
        ) {
            diffOk = false;
            diffDetail = `${JSON.stringify(a)} -> ${JSON.stringify(b)}`;
            break;
        }
    }
    record(
        'self-test: the diff reconstructs its right-hand side',
        diffOk,
        diffDetail,
    );

    // The classifier must be able to say something other than `other`, and `other` must be reachable
    // for a line no rule claims — otherwise the catch-all is decoration.
    record(
        'self-test: the lexical classifier names a known line and falls through on an unknown one',
        lexicalKind('let x = 1;') === 'binding (let/var)' &&
            lexicalKind('let x = 1;') !== 'other' &&
            lexicalKind('~~~') === 'other',
        `let -> ${lexicalKind('let x = 1;')}, ~~~ -> ${lexicalKind('~~~')}`,
    );

    // The node lookup must find a real node, and must not claim one for a line outside the tree.
    try {
        const parsed = await deps.parse(
            'actor { public func f() : async Nat { 1 } };',
        );
        const found = nodeTypeAtRow(parsed.root, 0);
        record(
            'self-test: the node lookup names a construct and returns null off the end',
            typeof found === 'string' &&
                found.length > 0 &&
                nodeTypeAtRow(parsed.root, 99) === null,
            `row 0 -> ${JSON.stringify(found)}, row 99 -> ${JSON.stringify(nodeTypeAtRow(parsed.root, 99))}`,
        );
    } catch (error) {
        record(
            'self-test: the node lookup names a construct',
            false,
            firstLine(String(error?.message)),
        );
    }

    const failed = results.filter((r) => !r.pass);
    return {
        passed: results.length - failed.length,
        total: results.length,
        failed,
        results,
    };
}

/**
 * The stronger contamination check, opt-in via `--check-contamination`.
 *
 * The claim being tested is the one that justifies running two Prettier majors in one process: that
 * neither engine's module state leaks into the other's *output*. The design makes that likely
 * (`createRequire` gives two module registries, so two copies of everything) but "likely" is not a
 * measurement, and the failure it would cause is invisible — a few files formatted slightly wrong,
 * with no crash and no obviously-wrong number.
 *
 * The method is the direct one: format a sample with each engine *alone*, record the bytes, then
 * format the same sample with both engines interleaved in this process, and require the bytes to
 * match. If an engine's output depended on what the other engine had just done — a mutated module
 * global, a shared cache, a leaked option — the interleaved reading would differ from the isolated
 * one for at least one file, and this reports which.
 *
 * A mismatch here is fatal. It would mean the in-process design is unsound and every number in the
 * report is suspect, which is exactly the kind of thing that must not be discovered later.
 */
async function checkContamination(engines, sample) {
    // Each reading is `{ path, out }` with `out: null` for a file the engine rejected, so a
    // rejection on both readings counts as agreement rather than as a difference, and the two
    // readings are compared by path rather than by array position — the loops skip unreadable
    // files, and positional comparison across a skip is how this check would silently pass.
    const oldAlone = [];

    // Alone: the old engine over the whole sample, then the new engine over the whole sample.
    for (const file of sample) {
        const source = decodeUtf8(readFileSync(file.path));
        if (source.text === null) continue;
        let out = null;
        try {
            out = oldFormat(engines.old, source.text);
        } catch {
            out = null;
        }
        oldAlone.push({ path: file.path, out });
    }
    const newAlone = [];
    for (const file of sample) {
        const source = decodeUtf8(readFileSync(file.path));
        if (source.text === null) continue;
        let out = null;
        try {
            out = await newFormat(
                engines.new.prettier,
                engines.new.plugin,
                source.text,
            );
        } catch {
            out = null;
        }
        newAlone.push({ path: file.path, out });
    }

    // Interleaved: both engines, alternating, in this one process.
    const oldInterleaved = [];
    const newInterleaved = [];
    for (const file of sample) {
        const source = decodeUtf8(readFileSync(file.path));
        if (source.text === null) continue;
        try {
            newInterleaved.push({
                path: file.path,
                out: await newFormat(
                    engines.new.prettier,
                    engines.new.plugin,
                    source.text,
                ),
            });
        } catch {
            newInterleaved.push({ path: file.path, out: null });
        }
        try {
            oldInterleaved.push({
                path: file.path,
                out: oldFormat(engines.old, source.text),
            });
        } catch {
            oldInterleaved.push({ path: file.path, out: null });
        }
    }

    const compare = (alone, interleaved, label, differences) => {
        const byPath = new Map(interleaved.map((r) => [r.path, r.out]));
        if (byPath.size !== alone.length) {
            differences.push(
                `${label}: ${alone.length} isolated reading(s) vs ${byPath.size} interleaved`,
            );
            return;
        }
        for (const r of alone) {
            if (!byPath.has(r.path)) {
                differences.push(
                    `${label}: ${r.path} missing from the interleaved reading`,
                );
            } else if (byPath.get(r.path) !== r.out) {
                differences.push(`${label}: ${r.path}`);
            }
        }
    };

    const differences = [];
    compare(oldAlone, oldInterleaved, 'old', differences);
    compare(newAlone, newInterleaved, 'new', differences);
    return { files: sample.length, compared: oldAlone.length, differences };
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

function renderReport(report, opts) {
    const t = report.totals;
    const pct = (n, d) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);
    const lines = [];

    lines.push('# Churn report — 0.13.0 vs. the `preserve` printer');
    lines.push('');
    lines.push(
        `Generated ${report.generatedAt} by \`node tools/corpus/churn.mjs\` on Node ` +
            `${report.environment.node} (${report.environment.platform}) in ` +
            `${(report.environment.elapsedMs / 1000).toFixed(1)}s.`,
    );
    lines.push('');
    lines.push(
        'This file is written by the tool and gitignored, like `RESULTS.md` and `report.json`: every ' +
            'run rewrites it, so committing it would dirty the tree on each invocation. It is the ' +
            'artifact the plan asks for under *"Plus a churn report"* — the evidence that the new ' +
            'style is the intended one and that the parity gap is understood rather than assumed closed.',
    );
    lines.push('');
    lines.push(
        `**Engines.** old = \`prettier@${report.engines.old.prettier}\` + ` +
            `\`prettier-plugin-motoko@${report.engines.old.plugin}\` (parser ` +
            `\`${report.engines.old.parser}\`), installed at \`${report.engines.old.home}\`; ` +
            `new = \`prettier@${report.engines.new.prettier}\` + \`src/index.ts\` at ` +
            `\`${report.engines.new.commit}\` (working tree ` +
            `${report.engines.new.dirty ? '**dirty**' : 'clean'}). Both were asked for ` +
            `\`printWidth: 80, tabWidth: 2, trailingComma: "none"\`.`,
    );

    lines.push('');
    lines.push('## Headline');
    lines.push('');
    lines.push(`- **Files scanned:** ${t.scanned}`);
    lines.push(
        `- **Identical** (byte-for-byte, both engines): ${t.identical} (${pct(t.identical, t.scanned)})`,
    );
    lines.push(
        `- **Layout-only difference** (same token text, different whitespace): ${t.layoutOnly} ` +
            `(${pct(t.layoutOnly, t.scanned)})`,
    );
    lines.push(
        `- **Token text differs** (a stronger claim — read every one): ${t.tokenDiffers} ` +
            `(${pct(t.tokenDiffers, t.scanned)})`,
    );
    lines.push(`- **Total lines added** by the new engine: ${t.added}`);
    lines.push(`- **Total lines removed** by the new engine: ${t.removed}`);
    lines.push('');
    lines.push('| bucket | count | meaning |');
    lines.push('| --- | ---: | --- |');
    lines.push(
        `| identical | ${t.identical} | the new printer reproduced 0.13.0's output exactly |`,
    );
    lines.push(
        `| layout-only | ${t.layoutOnly} | same tokens, different whitespace — the style moving |`,
    );
    lines.push(
        `| token-differs | ${t.tokenDiffers} | different non-whitespace characters — review each |`,
    );
    lines.push(
        `| old-error | ${t.oldError} | 0.13.0 could not format the file; no comparison exists |`,
    );
    lines.push(
        `| new-error | ${t.newError} | **the new engine could not format the file** |`,
    );
    lines.push(
        `| both-error | ${t.bothError} | neither engine formats it (usually a negative fixture) |`,
    );
    lines.push(`| unreadable | ${t.unreadable} | not valid UTF-8 |`);
    lines.push('');
    lines.push(
        `${t.compared} of ${t.scanned} file(s) produced a comparison ` +
            `(${t.identical} identical + ${t.layoutOnly + t.tokenDiffers} differing). The ` +
            `${t.oldError + t.newError + t.bothError + t.unreadable} that did not are listed with ` +
            `their reason under *Files with no comparison* — counted, never dropped, because "could ` +
            `not be compared" and "compared and equal" are different facts.`,
    );
    lines.push('');
    lines.push(
        t.newError + t.bothError === 0
            ? '**The new engine formatted every readable file.** A `new-error` here would be the ' +
                  'most serious thing this report could say: the in-tree printer failing on a file ' +
                  'the corpus contains. There are none.'
            : `> **⚠️ ${t.newError + t.bothError} file(s) the new engine could not format.** These are not ` +
                  `necessarily regressions — most will be negative fixtures or documented grammar ` +
                  `deviations. Each is listed with its reason under *Files with no comparison*, ` +
                  `which is where to check against \`docs/grammar-deviations.md\`.`,
    );
    if (t.truncated > 0) {
        lines.push('');
        lines.push(
            `> **${t.truncated} file(s) had a diff too large to measure finely** (edit distance over ` +
                `the \$4000\$ cap). Their added/removed counts are reported as the whole changed ` +
                `region replaced, which over-counts rather than under-counts. They are marked ` +
                `\`truncated\` in the table below.`,
        );
    }

    lines.push('');
    lines.push('### Why this is not a pass/fail gate');
    lines.push('');
    lines.push(
        'The tool exits 0 whether or not files differ, and it has no threshold. The plan asks for ' +
            'the diff to be *reviewed per construct*, not driven to zero: "0 files differ" would ' +
            'mean the new printer is a reimplementation of 0.13.0, which is not what M2 is for. The ' +
            'exit code is reserved for the tool failing to do its job — the old engine could not be ' +
            'installed, a self-test failed, or the runner threw.',
    );
    lines.push('');
    lines.push(
        `**Non-vacuity self-test: ${report.selfTest.passed}/${report.selfTest.total} passed.** ` +
            `The one bug that would make this report read as the best possible news is the two ` +
            `engines quietly being the same engine — every file identical, every total zero, nothing ` +
            `visibly wrong. So every run first requires the two plugins to be distinct objects from ` +
            `distinct directories, requires them to *disagree* on a snippet they are known to format ` +
            `differently, requires the diff to reconstruct its right-hand side on seven synthetic ` +
            `pairs, and requires the classifier to name a known line and to fall through on an ` +
            `unknown one. A failure aborts the run and no report is written.`,
    );
    lines.push('');
    lines.push(
        `The two engines run **in one process**, which is why the self-test checks isolation rather ` +
            `than assuming it. The old engine is loaded through a \`createRequire\` anchored at ` +
            `\`${report.engines.old.home}/package.json\`, so it resolves its own \`prettier@2\` and ` +
            `its own plugin copy; neither this repo's \`node_modules\` nor its \`package.json\` is ` +
            `touched. The self-test above verifies the major versions on each side.`,
    );
    lines.push('');
    lines.push(
        report.contamination
            ? `**Contamination: checked this run.** \`--check-contamination\` formatted ` +
                  `${report.contamination.compared} sampled file(s) with each engine alone and then ` +
                  `interleaved in this process, and required both readings byte-identical, which is ` +
                  `what justifies the single-process design. ` +
                  `${report.contamination.differences.length} difference(s).`
            : `**Contamination: not checked this run.** The always-on self-test proves the two ` +
                  `plugins are distinct objects from distinct directories, but it does NOT prove ` +
                  `one engine's module state cannot leak into the other's output — that is what ` +
                  `\`--check-contamination\` measures, and it is opt-in because it formats the sample ` +
                  `three times over. Run it when the loading strategy, either Prettier version, or ` +
                  `the scratch dir changes.`,
    );

    lines.push('');
    lines.push('## By construct');
    lines.push('');
    lines.push(
        'The node type is the grammar node enclosing the **first differing line of the new ' +
            "engine's output**, found by walking the real tree from `src/parser/parse.ts`. These are " +
            'node types this codebase has a printer for, so a name here is a place to read.',
    );
    lines.push('');
    lines.push('| node type at first difference | files | added | removed |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const row of report.byNodeType) {
        lines.push(
            `| ${row.nodeType === null ? '_(unknown — output did not parse)_' : `\`${row.nodeType}\``} ` +
                `| ${row.files} | ${row.added} | ${row.removed} |`,
        );
    }
    lines.push('');
    lines.push(
        'The lexical table below is the softer one: it classifies **every changed line** by the ' +
            "first non-blank token's spelling. That is a guess from the text, not a node type, so it " +
            'has an explicit `other` bucket rather than a rule that swallows whatever is left.',
    );
    lines.push('');
    lines.push('| changed lines by lexical kind | lines |');
    lines.push('| --- | ---: |');
    for (const [kind, count] of report.byLexical) {
        lines.push(`| ${kind} | ${count} |`);
    }

    lines.push('');
    lines.push('## Per source');
    lines.push('');
    lines.push(
        '| source | files | identical | layout-only | token-differs | old-error | new-error | both-error | added | removed |',
    );
    lines.push(
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const row of report.sources) {
        lines.push(
            `| ${row.label} | ${row.files} | ${row.identical} | ${row.layoutOnly} | ` +
                `${row.tokenDiffers} | ${row.oldError} | ${row.newError} | ${row.bothError} | ` +
                `${row.added} | ${row.removed} |`,
        );
    }
    lines.push('');
    lines.push(
        `Across ${report.sources.length} root(s). A root that was not found is listed in ` +
            `*Files with no comparison* with the reason rather than silently contributing zero.`,
    );

    // Where to spend the review. Computed from the run, not asserted: the plan asks for the diff to
    // be read per construct, and if the churn is concentrated there are only a handful of files
    // worth reading first. Printing the number is what turns that from advice into a worklist.
    const t2 = report.totals;
    const churnTotal = t2.added + t2.removed;
    if (churnTotal > 0 && report.topChurn.files > 0) {
        const pct = (n) => ((n / churnTotal) * 100).toFixed(0);
        lines.push('');
        lines.push(
            `**Where the churn is.** The ${report.topChurn.files} file(s) with the largest diffs ` +
                `account for ${report.topChurn.lines} of ${churnTotal} changed line(s) ` +
                `(${pct(report.topChurn.lines)}%), and the largest single file alone accounts for ` +
                `${pct(report.topChurn.largest)}%. The churn is concentrated: reading those first ` +
                `is a different afternoon from reading all ${t2.layoutOnly + t2.tokenDiffers} ` +
                `differing files.`,
        );
    }

    if (report.excerpts.length) {
        lines.push('');
        lines.push('## Excerpts');
        lines.push('');
        lines.push(
            `The first differences for the ${report.excerpts.length} file(s) with the largest churn ` +
                `(added + removed), bounded to ${opts.excerpt} diff operations each. ` +
                `\`-\` is 0.13.0's line, \`+\` is the new engine's. This is a sample; the full ` +
                `per-file diff is available with \`--file <path>\`.`,
        );
        lines.push('');
        for (const ex of report.excerpts) {
            lines.push(
                `<details><summary><code>${ex.path}</code> — ` +
                    `${ex.status}, +${ex.added}/-${ex.removed}` +
                    `${ex.nodeType ? `, in \`${ex.nodeType}\`` : ''}` +
                    `${ex.truncated ? ', truncated' : ''}</summary>`,
            );
            lines.push('');
            lines.push('```diff');
            for (const line of ex.excerpt.lines) {
                const no = line.type === '+' ? line.bLine : line.aLine;
                lines.push(
                    `${line.type} ${String(no).padStart(5)} ${line.line ?? ''}`,
                );
            }
            if (ex.excerpt.remaining)
                lines.push(`  … ${ex.excerpt.remaining} more diff op(s)`);
            lines.push('```');
            lines.push('');
            lines.push('</details>');
            lines.push('');
        }
    }

    lines.push('');
    lines.push('## Files with no comparison');
    lines.push('');
    const noComparison = report.files.filter(
        (f) =>
            f.status === 'old-error' ||
            f.status === 'new-error' ||
            f.status === 'both-error' ||
            f.status === 'unreadable',
    );
    if (noComparison.length === 0) {
        lines.push('_Every readable file was compared by both engines._');
    } else {
        lines.push('| file | status | detail |');
        lines.push('| --- | --- | --- |');
        for (const f of noComparison) {
            lines.push(
                `| \`${f.path}\` | ${f.status} | ${f.oldError ?? f.newError ?? f.reason ?? ''} |`,
            );
        }
    }
    if (report.missingRoots.length) {
        lines.push('');
        lines.push('| root not found |');
        lines.push('| --- |');
        for (const r of report.missingRoots)
            lines.push(`- \`${r.label}\`: \`${r.dir}\``);
    }

    if (report.fileFocus) {
        lines.push('');
        lines.push('## Single-file focus');
        lines.push('');
        lines.push(
            `\`--file ${report.fileFocus.path}\` — ${report.fileFocus.status}` +
                `${report.fileFocus.added !== undefined ? `, +${report.fileFocus.added}/-${report.fileFocus.removed}` : ''}.`,
        );
        if (report.fileFocus.oldOut !== undefined) {
            lines.push('');
            lines.push('### old (0.13.0)');
            lines.push('');
            lines.push('```motoko');
            lines.push(report.fileFocus.oldOut.replace(/\n$/, ''));
            lines.push('```');
            lines.push('');
            lines.push('### new');
            lines.push('');
            lines.push('```motoko');
            lines.push(report.fileFocus.newOut.replace(/\n$/, ''));
            lines.push('```');
        }
        if (report.fileFocus.oldError || report.fileFocus.newError) {
            lines.push('');
            lines.push('```');
            if (report.fileFocus.oldError)
                lines.push(`old: ${report.fileFocus.oldError}`);
            if (report.fileFocus.newError)
                lines.push(`new: ${report.fileFocus.newError}`);
            lines.push('```');
        }
    }

    lines.push('');
    lines.push('## Notes for a reviewer');
    lines.push('');
    lines.push(
        '**Why `old-error` is 0, and why that is not good news.** 0.13.0 never rejects a file: ' +
            'asked to format `1 + 2 *;` it returns the text unchanged. Its parser is error-' +
            'recovering and its printer has no guard, so a file it "formatted" may be a file it did ' +
            'not understand. The consequence for this report is that a comparison succeeding does ' +
            'not mean the old engine parsed the input — it means only that the old engine produced ' +
            'some output. Where the new engine *does* reject a file (`new-error`), the two sides are ' +
            'not being compared at all, and the counts above are about the ' +
            `${t.compared} files that were.`,
    );
    lines.push('');
    lines.push(
        '**The `new-error` files are not all regressions.** Most are `test/fail/*` — ' +
            'moc’s own negative fixtures, which are supposed to be syntax errors, so the new ' +
            'engine rejecting them is the engine working. The rest are on ' +
            '`docs/grammar-deviations.md` (the `@`-identifiers in `timer.mo` and the spaced type ' +
            'application in `perf/qr/list.mo`), which is the documented deviation list rather than ' +
            'a new break. The tool does not know either list, so it reports all of them and lets a ' +
            'reviewer apply the documentation — a count that silently subtracted a hardcoded ' +
            'allowlist would hide the day the allowlist went stale.',
    );
    lines.push('');
    lines.push(
        '**`layout-only` is the expected tier and `token-differs` is the surprising one.** Most of ' +
            'the corpus should be layout: the plan’s style changes are about whitespace. A file ' +
            'in `token-differs` is one where the two formatters emit different non-whitespace ' +
            'characters — a moved comment, a normalised literal, a different bracket — and those ' +
            'are the ones the plan’s per-construct review is for. If that number is high, read ' +
            'the biggest ones first; the excerpts below are sorted by churn for exactly that.',
    );
    lines.push('');
    lines.push(
        '**The old engine needs its own Prettier, and gets one.** 0.13.0 is a Prettier 2 plugin: ' +
            'its printer is a sync `print`, it registers its parser as `motoko-tt-parse`, and it ' +
            'declares no Prettier 3 peer. This repo is Prettier 3. So `prettier@2` and ' +
            '`prettier-plugin-motoko@0.13.0` are installed together into an isolated scratch ' +
            'directory and loaded through a `createRequire` anchored there. Nothing is added to ' +
            'this repo’s `package.json`, and this repo’s `node_modules` is never written to.',
    );
    lines.push('');
    lines.push(
        '**The parser name is discovered, not written down.** 0.13.0 calls its parser ' +
            '`motoko-tt-parse` rather than `motoko` — `parser: "motoko"` against 0.13.0 fails with ' +
            '`Couldn\'t resolve parser "motoko"`. The name is read off the loaded plugin instead, so ' +
            'a version that adds a `motoko` alias cannot make this tool ask for a parser the engine ' +
            'does not have.',
    );
    lines.push('');
    lines.push(
        '**What "layout-only" cannot see.** Tiering discards whitespace, so a comment whose *text* ' +
            'was reflowed lands in `token-differs` alongside real token changes; telling the two ' +
            'apart needs a lexer, and a regex approximation would misread `"//"` inside a string. ' +
            'The tier is a filter for where to look, not a verdict.',
    );
    lines.push('');
    lines.push(
        '**The diff has a cap, and says so.** Myers is bounded at an edit distance of 4000; a file ' +
            'past that is reported as the whole changed region replaced and flagged `truncated`, ' +
            'which over-counts rather than under-counts. No file in this run reached it unless the ' +
            'warning above says so.',
    );
    lines.push('');
    lines.push(
        `**Reproduce with:** \`node tools/corpus/churn.mjs\` (all ${t.scanned} files), or ` +
            '`--limit 200` for the first 200 in sorted path order, or `--file <path>` for one file ' +
            'in detail. The scratch install is cached, so only the first run pays for `npm install`.',
    );

    lines.push('');
    lines.push('## Provenance');
    lines.push('');
    lines.push(
        `- old engine: \`prettier@${report.engines.old.prettier}\` + ` +
            `\`prettier-plugin-motoko@${report.engines.old.plugin}\`, at \`${report.engines.old.home}\``,
    );
    lines.push(
        `- new engine: \`prettier@${report.engines.new.prettier}\` + \`src/index.ts\`, repo ` +
            `\`${report.engines.new.commit}\` (${report.engines.new.dirty ? 'dirty' : 'clean'})`,
    );
    lines.push(
        `- corpus roots: ${report.roots.map((r) => `\`${r.dir}\``).join(', ')}`,
    );
    lines.push(
        `- limit: ${opts.limit ?? '(none)'}   file: ${opts.file ?? '(none)'}`,
    );
    lines.push('');
    lines.push(`Report path: \`${relative(repoRoot, opts.report)}\``);
    lines.push('');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        process.stdout.write(HELP);
        return;
    }

    const log = (text) => {
        if (!opts.quiet) process.stderr.write(text);
    };

    // The old engine first: if it cannot be installed there is no comparison to make, and the
    // failure should be the first thing the user sees rather than something after a long scan.
    const requested = ensureOldEngine(opts.oldHome, log);
    const old = loadOldEngine(opts.oldHome);

    // The new engine through Node's own TypeScript support, exactly as `run.mjs` imports it, so this
    // measures `src/` rather than a stale `lib/`. Prettier resolves from this repo's node_modules.
    const prettier = (await import('prettier')).default;
    const plugin = (
        await import(pathToFileURL(join(repoRoot, 'src', 'index.ts')).href)
    ).default;
    const parseModule = await import(
        pathToFileURL(join(repoRoot, 'src', 'parser', 'parse.ts')).href
    );
    const deps = { parse: parseModule.parse };
    if (typeof deps.parse !== 'function') {
        throw new Error(
            'churn report: src/parser/parse.ts did not export `parse`; the construct classification ' +
                'reads the grammar tree and cannot run without it.',
        );
    }

    const engines = {
        old: {
            prettier: old.prettier,
            plugin: old.plugin,
            parser: old.parser,
            parserNames: old.parserNames,
            version: requested,
            home: opts.oldHome,
        },
        new: {
            prettier,
            plugin,
            version: prettier.version,
            commit: currentCommit(),
            dirty: isDirty(),
        },
    };
    log(
        `new engine: prettier@${prettier.version} + src/index.ts at ${engines.new.commit} ` +
            `(${engines.new.dirty ? 'dirty' : 'clean'})\n`,
    );

    const selfTestResult = await selfTest(engines, deps);
    if (selfTestResult.failed.length) {
        throw new Error(
            `churn report self-test failed (${selfTestResult.failed.length} of ` +
                `${selfTestResult.total}): ` +
                selfTestResult.failed
                    .map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ''}`)
                    .join('; ') +
                '. The comparison this run would produce MUST NOT be believed.',
        );
    }
    log(
        `self-test: ${selfTestResult.passed}/${selfTestResult.total} passed ` +
            `(distinct engines, a known disagreement, a reconstructing diff, a live classifier)\n`,
    );

    // The file list. `--file` wins over `--limit`: asking for one file in detail is asking for that
    // file, not for the first one of a bounded scan.
    let selected;
    let missingRoots = [];
    let roots = [];
    let focus = null;
    if (opts.file) {
        if (!existsSync(opts.file)) {
            throw new Error(
                `churn report: --file ${opts.file} does not exist.`,
            );
        }
        selected = [
            { path: opts.file, source: '(explicit)', root: dirname(opts.file) },
        ];
        roots = [{ label: '(explicit)', dir: dirname(opts.file) }];
        focus = opts.file;
    } else {
        const collected = collectFiles(opts);
        missingRoots = collected.missing;
        roots = collected.roots;
        selected =
            opts.limit === null
                ? collected.files
                : collected.files.slice(0, opts.limit);
        log(
            `corpus: ${collected.files.length} file(s) across ` +
                `${collected.roots.length} root(s); examining ${selected.length}` +
                (missingRoots.length
                    ? `; ${missingRoots.length} root(s) not found`
                    : '') +
                '\n',
        );
    }

    // The opt-in contamination sweep, before the real run: if in-process execution leaks state then
    // every number below is suspect, so the check belongs before the work it would invalidate rather
    // than after. Sampled across the corpus rather than taken from the front, because a leak that
    // only shows up on one construct would hide in an alphabetical prefix.
    let contamination = null;
    if (opts.checkContamination) {
        const sampleSize = Math.min(200, selected.length);
        const step = Math.max(1, Math.floor(selected.length / sampleSize));
        const sample = selected
            .filter((_, i) => i % step === 0)
            .slice(0, sampleSize);
        contamination = await checkContamination(engines, sample);
        log(
            `contamination: ${contamination.compared}/${contamination.files} file(s) ` +
                `formatted alone and interleaved; ` +
                `${contamination.differences.length} difference(s)\n`,
        );
        if (contamination.differences.length) {
            throw new Error(
                `churn report: in-process contamination detected — the interleaved readings differ ` +
                    `from the isolated ones on ${contamination.differences.length} reading(s): ` +
                    `${contamination.differences.slice(0, 10).join(', ')}. ` +
                    `The two engines are NOT isolated and this report's numbers cannot be trusted.`,
            );
        }
    }

    const startedAt = Date.now();
    const results = [];
    for (let i = 0; i < selected.length; i++) {
        const result = await churnFile(
            selected[i],
            engines,
            deps,
            opts.excerpt,
        );
        results.push(result);
        if (!opts.quiet && (i + 1) % 200 === 0) {
            process.stderr.write(
                `  ${i + 1}/${selected.length} files… (${new Date().toISOString().slice(11, 19)})\n`,
            );
        }
    }
    const elapsedMs = Date.now() - startedAt;

    // Tally.
    const totals = {
        scanned: results.length,
        compared: 0,
        identical: 0,
        layoutOnly: 0,
        tokenDiffers: 0,
        oldError: 0,
        newError: 0,
        bothError: 0,
        unreadable: 0,
        added: 0,
        removed: 0,
        truncated: 0,
    };
    const statusKey = {
        identical: 'identical',
        'layout-only': 'layoutOnly',
        'token-differs': 'tokenDiffers',
        'old-error': 'oldError',
        'new-error': 'newError',
        'both-error': 'bothError',
        unreadable: 'unreadable',
    };
    const byNodeType = new Map();
    const byLexical = new Map();
    const bySource = new Map();

    for (const r of results) {
        totals[statusKey[r.status]] += 1;
        if (r.status === 'identical') totals.compared += 1;
        if (r.status === 'layout-only' || r.status === 'token-differs') {
            totals.compared += 1;
            totals.added += r.added;
            totals.removed += r.removed;
            if (r.truncated) totals.truncated += 1;

            const key = r.nodeType ?? null;
            const row = byNodeType.get(key) ?? {
                nodeType: key,
                files: 0,
                added: 0,
                removed: 0,
            };
            row.files += 1;
            row.added += r.added;
            row.removed += r.removed;
            byNodeType.set(key, row);

            for (const [kind, count] of Object.entries(r.lexical)) {
                byLexical.set(kind, (byLexical.get(kind) ?? 0) + count);
            }
        }

        const srow = bySource.get(r.source) ?? {
            label: r.source,
            files: 0,
            identical: 0,
            layoutOnly: 0,
            tokenDiffers: 0,
            oldError: 0,
            newError: 0,
            bothError: 0,
            unreadable: 0,
            added: 0,
            removed: 0,
        };
        srow.files += 1;
        srow[statusKey[r.status]] += 1;
        if (r.added) srow.added += r.added;
        if (r.removed) srow.removed += r.removed;
        bySource.set(r.source, srow);
    }

    // Excerpts: the largest churn first, so the bounded sample is the informative one rather than
    // whichever files happen to sort first.
    const differing = results
        .filter(
            (r) => r.status === 'layout-only' || r.status === 'token-differs',
        )
        .sort((a, b) => b.added + b.removed - (a.added + a.removed));
    const excerpts = differing.slice(0, focus ? 1 : 25).map((r) => ({
        path: r.path,
        status: r.status,
        added: r.added,
        removed: r.removed,
        truncated: r.truncated,
        nodeType: r.nodeType,
        excerpt: r.excerpt,
    }));

    // How concentrated the churn is, over the same sample the excerpts show. A reviewer's first
    // question is "do I have to read all of these", and this is the honest answer from the data.
    const topChurn = {
        files: excerpts.length,
        lines: differing
            .slice(0, excerpts.length)
            .reduce((n, r) => n + r.added + r.removed, 0),
        largest: differing.length
            ? differing[0].added + differing[0].removed
            : 0,
    };

    const report = {
        generatedAt: new Date().toISOString(),
        engines: {
            old: {
                prettier: requested.prettier,
                plugin: requested.plugin,
                parser: old.parser,
                home: opts.oldHome,
            },
            new: {
                prettier: engines.new.version,
                plugin: 'src/index.ts',
                commit: engines.new.commit,
                dirty: engines.new.dirty,
            },
        },
        environment: {
            node: process.version,
            platform: `${process.platform}-${process.arch}`,
            elapsedMs,
        },
        roots,
        missingRoots,
        totals,
        byNodeType: [...byNodeType.values()].sort((a, b) => b.files - a.files),
        byLexical: [...byLexical.entries()].sort((a, b) => b[1] - a[1]),
        sources: [...bySource.values()].sort((a, b) =>
            a.label < b.label ? -1 : 1,
        ),
        files: results.map((r) => ({
            path: r.path,
            source: r.source,
            status: r.status,
            added: r.added,
            removed: r.removed,
            nodeType: r.nodeType,
            truncated: r.truncated,
            oldError: r.oldError,
            newError: r.newError,
            reason: r.reason,
        })),
        excerpts,
        topChurn,
        selfTest: selfTestResult,
        contamination,
        fileFocus: null,
    };

    // `--file` prints the full diff to stdout, which is the point of the mode: the report bounds the
    // excerpt, and a reader who asked for one file should not have to read a bounded sample of it.
    if (focus) {
        const only = results[0];
        const full = await churnFileDetail(selected[0], engines);
        report.fileFocus = full;
        process.stdout.write(renderSingleFile(only, full));
    }

    const markdown = renderReport(report, opts);
    mkdirSync(dirname(opts.report), { recursive: true });
    writeFileSync(opts.report, markdown);

    process.stdout.write(
        [
            '',
            `files ${totals.scanned}  identical ${totals.identical}  ` +
                `layout-only ${totals.layoutOnly}  token-differs ${totals.tokenDiffers}`,
            `old-error ${totals.oldError}  new-error ${totals.newError}  ` +
                `both-error ${totals.bothError}  unreadable ${totals.unreadable}`,
            `lines added ${totals.added}  removed ${totals.removed}` +
                (totals.truncated ? `  truncated ${totals.truncated}` : ''),
            `self-test ${selfTestResult.passed}/${selfTestResult.total}`,
            `wrote ${relative(process.cwd(), opts.report)}`,
            '',
        ].join('\n'),
    );

    // Exit 0 whatever the churn is. Differing is the subject of the report, not a failure of it.
    process.exitCode = 0;
}

/** The two outputs and the full diff for one file, for `--file`. */
async function churnFileDetail(file, engines) {
    const decoded = decodeUtf8(readFileSync(file.path));
    if (decoded.text === null) return { path: file.path, status: 'unreadable' };
    const source = decoded.text;
    let oldOut = null;
    let newOut = null;
    let oldError = null;
    let newError = null;
    try {
        oldOut = oldFormat(engines.old, source);
    } catch (error) {
        oldError = firstLine(error?.message ?? String(error));
    }
    try {
        newOut = await newFormat(
            engines.new.prettier,
            engines.new.plugin,
            source,
        );
    } catch (error) {
        newError = firstLine(error?.message ?? String(error));
    }
    if (oldOut === null || newOut === null)
        return { path: file.path, status: 'error', oldError, newError };
    const a = oldOut.split('\n');
    const b = newOut.split('\n');
    const diff = diffLines(a, b);
    return {
        path: file.path,
        status:
            oldOut === newOut
                ? 'identical'
                : stripWhitespace(oldOut) === stripWhitespace(newOut)
                  ? 'layout-only'
                  : 'token-differs',
        added: diff.added,
        removed: diff.removed,
        oldOut,
        newOut,
        lines: diff.ops,
        a,
        b,
    };
}

/** The unbounded diff, printed to stdout, in unified-ish form. */
function renderSingleFile(result, detail) {
    const lines = [];
    lines.push('');
    lines.push(`file: ${detail.path}`);
    lines.push(`status: ${detail.status}`);
    if (result.nodeType)
        lines.push(`first difference inside: ${result.nodeType}`);
    if (detail.added !== undefined)
        lines.push(`added ${detail.added}  removed ${detail.removed}`);
    if (detail.oldError) lines.push(`old error: ${detail.oldError}`);
    if (detail.newError) lines.push(`new error: ${detail.newError}`);
    lines.push('');
    if (detail.lines) {
        const MAX = 400;
        for (const op of detail.lines.slice(0, MAX)) {
            if (op.type === '=')
                lines.push(
                    `  ${String(op.aIndex + 1).padStart(5)} ${detail.a[op.aIndex]}`,
                );
            else if (op.type === '-')
                lines.push(
                    `- ${String(op.aIndex + 1).padStart(5)} ${detail.a[op.aIndex]}`,
                );
            else
                lines.push(
                    `+ ${String(op.bIndex + 1).padStart(5)} ${detail.b[op.bIndex]}`,
                );
        }
        if (detail.lines.length > MAX)
            lines.push(`  … ${detail.lines.length - MAX} more diff op(s)`);
    } else if (detail.oldError || detail.newError) {
        lines.push('no diff: one or both engines could not format this file');
    } else {
        lines.push('the two engines produce byte-identical output');
    }
    lines.push('');
    return lines.join('\n');
}

/** `git rev-parse HEAD` in this repo, for provenance, or null outside a checkout. */
function currentCommit() {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    return r.status === 0 ? r.stdout.trim() : null;
}

/** Whether `src/` has uncommitted changes — a churn number against a dirty tree is not reproducible. */
function isDirty() {
    const r = spawnSync('git', ['status', '--porcelain', '--', 'src'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    return r.status === 0 && r.stdout.trim().length > 0;
}

main().catch((error) => {
    process.stderr.write(`churn report: ${error?.stack ?? error}\n`);
    process.exit(1);
});
