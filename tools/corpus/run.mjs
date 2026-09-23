/**
 * The corpus harness (docs/formatter-rework.md, "Verification" item 3; M1's exit criterion,
 * extended by M2's "corpus CI job (all checks)").
 *
 * What this runs:
 *
 * The plan's corpus unit has four checks — token round-trip, idempotence, re-parse (no
 * ERROR/MISSING) and tree equality between input and output. M1 had no printer, so the harness ran
 * only the two the parser and normaliser answer on their own and reported the other two as
 * `not-run (no printer)` rather than as passing:
 *
 *   1. parse            — every unit parses, or raises `MotokoSyntaxError` (never a crash);
 *   2. token round-trip — re-concatenating the normalised tree's leaves and gaps reproduces the
 *                         input exactly. This is the normaliser's losslessness property, and it is
 *                         the same check as the plan's first bullet.
 *   3. invariants       — normalised offsets are monotonic and in range, and a tree that parsed
 *                         without error carries no `error`/`missing` node.
 *
 * M2 shipped the `preserve` printer, so the other two run now, on exactly the units that parsed:
 *
 *   4. idempotence      — `format(format(x)) === format(x)`;
 *   5. re-parse         — the printed output parses with no error (this is also what `format`
 *                         itself enforces through the runtime guard, but the harness checks it
 *                         independently so a guard that silently stopped firing would show here);
 *   6. tree equality    — `shapeOf` of the input and of the printed output agree.
 *
 * A unit that the grammar rejects on purpose is not formatted: there is no output to compare, and
 * inventing one would mean formatting something moc also rejects. Those units are counted as
 * `not-formattable` with the reason, so the difference between "formatted and equal" and "never
 * reached the printer" is visible in the report rather than folded into a denominator.
 *
 * "No silent caps": every unit the harness decides not to check is appended to a skip list with a
 * machine-readable reason, and the report prints the counts. A repo that could not be found, a
 * file that is not UTF-8, a fence that is not Motoko, an unclosed fence — all of them are counted.
 *
 * Usage:
 *   node tools/corpus/run.mjs --help
 *   node tools/corpus/run.mjs --job all --motoko-rev master --report tools/corpus/RESULTS.md
 *
 * The CLI is the contract `.github/workflows/corpus.yml` already calls; see the INTEGRATION TODO
 * at the top of that file.
 */

import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    decodeUtf8,
    headRev,
    isGitRepo,
    listFiles,
    listFilesUnder,
    originSlug,
    readBlobs,
    resolveRev,
} from './lib/git.mjs';
import { countAllFences, extractMotokoFences } from './lib/fences.mjs';
import { findMoc, parseTree, sameTree } from './lib/moc-oracle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const HELP = `corpus harness — parse + normaliser fidelity over the Motoko corpus

Usage:
  node tools/corpus/run.mjs [options]

Options:
  --job <name>          which check set to run: all | parse | fences   (default: all)
  --motoko-rev <rev>    revision of the Motoko compiler repo to check  (default: HEAD)
                        Applies to the compiler repo only; supporting package sets are read at
                        their own default branch. Records the resolved commit either way.
  --motoko <dir>        path to the Motoko checkout   (default: ../motoko next to this repo)
  --oracle-rev <rev>    provenance pin for the compiler source the corpus is read at. Recorded, not
                        honoured as a binary selector: the AST oracle runs whichever moc the search
                        finds (MOC=<path> to override), and reports that binary's version.
  --report <path>       where to write the human report (markdown)   (default: tools/corpus/RESULTS.md)
  --json <path>         where to write the machine report            (default: tools/corpus/report.json)
  --repos <dir>         directory to scan for sibling checkouts      (default: this repo's parent)
  --no-siblings         check only the Motoko repo, skip every sibling package set
  --require-oracle      fail the run when no moc binary is found. Use this in CI: without it a
                        runner with no moc silently reports the oracle as "not run", which turns
                        the strongest check in the harness into no check at all.
  --quiet               suppress per-unit progress lines
  -h, --help            this text

Exit code is 0 when nothing crashed and no unit failed the checks that CAN run. Units the grammar
rejects are counted and listed but are not a failure: they are expected (docs/grammar-deviations.md).
--require-oracle is the one exception that turns an absent tool into a failure.
`;

function parseArgs(argv) {
    const opts = {
        job: 'all',
        motokoRev: null,
        oracleRev: null,
        motokoDir: null,
        report: join(repoRoot, 'tools', 'corpus', 'RESULTS.md'),
        json: join(repoRoot, 'tools', 'corpus', 'report.json'),
        reposDir: resolve(repoRoot, '..'),
        siblings: true,
        quiet: false,
        requireOracle: false,
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
            case '--job':
                opts.job = next();
                break;
            case '--motoko-rev':
                opts.motokoRev = next();
                break;
            case '--oracle-rev':
                opts.oracleRev = next();
                break;
            case '--motoko':
                opts.motokoDir = resolve(next());
                break;
            case '--report':
                opts.report = resolve(next());
                break;
            case '--json':
                opts.json = resolve(next());
                break;
            case '--repos':
                opts.reposDir = resolve(next());
                break;
            case '--no-siblings':
                opts.siblings = false;
                break;
            case '--quiet':
                opts.quiet = true;
                break;
            case '--require-oracle':
                opts.requireOracle = true;
                break;
            default:
                throw new Error(`unknown argument: ${arg}`);
        }
    }
    // Env-var fallbacks: the workflow passes these as a convenience alongside the flags ("the flags
    // are the contract"). Reading them means a bare `node tools/corpus/run.mjs` still honours the
    // pins the workflow set, without a second way to *specify* anything.
    if (!opts.motokoRev && process.env.CORPUS_MOTOKO_REV) {
        opts.motokoRev = process.env.CORPUS_MOTOKO_REV;
    }
    if (!opts.oracleRev && process.env.CORPUS_ORACLE_REV) {
        opts.oracleRev = process.env.CORPUS_ORACLE_REV;
    }
    if (!opts.motokoDir && process.env.CORPUS_MOTOKO_DIR) {
        opts.motokoDir = resolve(process.env.CORPUS_MOTOKO_DIR);
    }
    return opts;
}

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------

/**
 * Index every git checkout directly under `reposDir` by its `origin` slug (`owner/name`), so a
 * packages.json entry that names a repository URL can be resolved to a local directory *without
 * network access*. The plan pins revisions and the environment is offline; this is how a pinned
 * remote becomes a local read.
 */
function indexCheckouts(reposDir) {
    const bySlug = new Map();
    let entries = [];
    try {
        entries = readdirSync(reposDir, { withFileTypes: true });
    } catch {
        return bySlug;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const dir = join(reposDir, entry.name);
        if (!isGitRepo(dir)) continue;
        const slug = originSlug(dir);
        if (slug && !bySlug.has(slug)) bySlug.set(slug, dir);
    }
    return bySlug;
}

/** `owner/name` for a repository URL such as `https://github.com/caffeinelabs/skills`. */
function slugOf(url) {
    const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    return match ? `${match[1]}/${match[2]}` : url;
}

/**
 * The grammar's `test/packages.json`, read from the pinned grammar package. It is the plan's
 * "grammar's test/packages.json set": a list of external repositories the grammar authors check
 * themselves against. Its `path` field, when present, narrows to a subdirectory.
 */
function readPackagesJson(targetDir) {
    const candidates = [
        join(
            repoRoot,
            'node_modules',
            'tree-sitter-motoko',
            'test',
            'packages.json',
        ),
        join(targetDir, 'test', 'packages.json'),
        '/Users/kamil.listopad/tree-sitter-motoko/test/packages.json',
    ];
    for (const path of candidates) {
        if (!existsSync(path)) continue;
        try {
            return { path, packages: JSON.parse(readFileSync(path, 'utf8')) };
        } catch {
            // A malformed packages.json is not fatal; the report will show the set as absent.
        }
    }
    return { path: null, packages: [] };
}

/**
 * The full source list.
 *
 * `motoko` is the compiler repo itself and is the only source whose absence is a hard error: it is
 * the corpus the M1 exit number (docs/m1-architecture.md) is quoted against. Every other source is
 * optional and becomes a skip record when its checkout is not present, so a developer with only
 * `../motoko` still gets a meaningful report rather than a wall of missing-repo noise.
 */
function buildSources(opts, checkouts) {
    const sources = [];
    const skips = [];

    // 1. The compiler corpus. `.mo` everywhere, plus `motoko` fences in Markdown.
    const motokoDir = opts.motokoDir ?? join(repoRoot, '..', 'motoko');
    if (!existsSync(motokoDir) || !isGitRepo(motokoDir)) {
        throw new Error(
            `corpus harness: no Motoko checkout at ${motokoDir}. Pass --motoko <dir>, set ` +
                `CORPUS_MOTOKO_DIR, or clone caffeinelabs/motoko next to this repo. This source ` +
                `is required — every published corpus number is measured against it.`,
        );
    }
    sources.push({ label: 'motoko', dir: motokoDir, kind: 'motoko' });

    // 2. motoko-core: the standard library, checked both as source and as Markdown.
    const coreDir = checkouts.get('caffeinelabs/motoko-core');
    if (coreDir)
        sources.push({ label: 'motoko-core', dir: coreDir, kind: 'motoko' });
    else
        skips.push({
            kind: 'source-absent',
            what: 'caffeinelabs/motoko-core',
            reason: 'not checked out under the scan directory',
        });

    // 3. The grammar's packages.json set.
    if (opts.siblings) {
        const { path, packages } = readPackagesJson(motokoDir);
        if (!path) {
            skips.push({
                kind: 'source-absent',
                what: 'test/packages.json',
                reason: 'grammar test/packages.json not found',
            });
        } else {
            for (const entry of packages) {
                const slug = slugOf(entry.repository);
                const dir = checkouts.get(slug);
                if (!dir) {
                    skips.push({
                        kind: 'source-absent',
                        what: `${entry.name} (${slug})`,
                        reason: 'repository not checked out locally; harness never clones (offline)',
                    });
                    continue;
                }
                sources.push({
                    label: entry.name,
                    dir,
                    prefix: entry.path ? `${entry.path}/` : '',
                    kind: 'package',
                });
            }
        }

        // 4. The plan's "plus skills-internal and mops-packages locally". These are not in
        // packages.json but the plan names them, so they are checked when present.
        for (const [label, slug] of [
            ['skills-internal', 'caffeinelabs/skills-internal'],
            ['mops-packages', 'caffeinelabs/mops-packages'],
        ]) {
            const dir = checkouts.get(slug);
            if (dir) sources.push({ label, dir, kind: 'package' });
            else
                skips.push({
                    kind: 'source-absent',
                    what: slug,
                    reason: 'not checked out under the scan directory',
                });
        }
    }

    return { sources, skips };
}

// ---------------------------------------------------------------------------------------------
// Collecting units
// ---------------------------------------------------------------------------------------------

/**
 * Enumerate the checkable units of one source.
 *
 * A unit is `{ id, source, path, line|null, text }`. Markdown contributes one unit per `motoko`
 * fence; everything else that is not `.mo` and not Markdown is counted and dropped *with a reason*,
 * never silently.
 */
function collectUnits(source, rev, counters, job) {
    const units = [];
    const wantMo = job !== 'fences';
    const wantMd = job !== 'parse';
    const moFiles = !wantMo
        ? []
        : listFiles(source.dir, rev, '.mo').filter((p) =>
              source.prefix ? p.startsWith(source.prefix) : true,
          );
    const mdFiles = !wantMd
        ? []
        : listFiles(source.dir, rev, '.md').filter((p) =>
              source.prefix ? p.startsWith(source.prefix) : true,
          );

    const all = [...moFiles, ...mdFiles];
    const blobs = readBlobs(source.dir, rev, all);

    for (const path of moFiles) {
        const { text, reason } = decodeUtf8(blobs.get(path));
        if (text === null) {
            counters.skipped.push({
                kind: 'unreadable',
                source: source.label,
                path,
                reason,
            });
            continue;
        }
        units.push({
            id: `${source.label}:${path}`,
            source: source.label,
            path,
            line: null,
            kind: 'file',
            text,
        });
    }

    for (const path of mdFiles) {
        const { text, reason } = decodeUtf8(blobs.get(path));
        if (text === null) {
            counters.skipped.push({
                kind: 'unreadable',
                source: source.label,
                path,
                reason,
            });
            continue;
        }
        const fences = extractMotokoFences(text);
        const allFences = countAllFences(text);
        counters.fences.files += 1;
        counters.fences.total += allFences;
        counters.fences.motoko += fences.length * 2; // opener + closer, to compare like with like
        for (const fence of fences) {
            if (!fence.closed) {
                // An unterminated fence is still a unit — the plan counts it rather than treating
                // the rest of the file as code — but the fact is recorded.
                counters.skipped.push({
                    kind: 'unclosed-fence',
                    source: source.label,
                    path,
                    line: fence.line,
                    reason: 'document ended before the fence closed',
                });
            }
            units.push({
                id: `${source.label}:${path}#L${fence.line}`,
                source: source.label,
                path,
                line: fence.line,
                kind: 'fence',
                text: fence.text,
            });
        }
    }

    return units;
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

/**
 * Sources whose grammar rejection is *documented* in `docs/grammar-deviations.md`.
 *
 * This list is the point of the check, not a convenience. A syntax error in a whole `.mo` file that
 * is neither a `test/fail` negative fixture nor one of these is a **coverage regression** — the
 * grammar rejecting something moc accepts, which is exactly what the M1 exit criterion cares about.
 * Keeping the list explicit means a new deviation fails the run until someone writes it down, rather
 * than being absorbed into a percentage.
 *
 * Every path here appears in `docs/grammar-deviations.md`'s corpus-sweep table (§515 onward) with
 * the construct that causes it. Keep them in step: if a deviation is fixed, remove it here too.
 */
const DOCUMENTED_DEVIATIONS = new Set([
    'doc/schat.mo', // §13 — dead/invalid source, moc rejects it too
    'src/prelude/internals.mo', // §5 — `@`-privileged identifiers
    'src/prelude/prim.mo', // §5
    'src/prelude/timers-api.mo', // §5
    'test/perf/qr/list.mo', // §3 — spaced type application `List <T>`
    'test/run-drun/timer.mo', // §5 — `@timer_helper()`
]);

/**
 * Structural invariants of a normalised tree, independent of the round-trip check.
 *
 * These are cheap and they catch the class of normaliser bug the round-trip check cannot see: an
 * offset that is in range and monotonically ordered can still be *wrong* if a node claims a range
 * that overlaps its sibling, and a tree can round-trip while carrying a node the grammar flagged as
 * an error. Walks the tree in source order and reports the first violation.
 */
function checkInvariants(root, source) {
    const problem = [];
    let prevEnd = 0;
    let flagged = null;

    function walk(node) {
        if (problem.length && problem.length >= 1) return;
        if (node.nodeType === 'Token' || node.nodeType === 'Text') {
            if (node.startIndex < 0 || node.endIndex > source.length) {
                problem.push(
                    `offset out of range: ${node.type} [${node.startIndex}, ${node.endIndex}) ` +
                        `for a source of ${source.length}`,
                );
                return;
            }
            if (node.startIndex < prevEnd) {
                problem.push(
                    `overlapping or out-of-order leaf: ${node.type} starts at ${node.startIndex} ` +
                        `but the previous leaf ended at ${prevEnd}`,
                );
                return;
            }
            prevEnd = node.endIndex;
            if ((node.error || node.missing) && !flagged) {
                flagged = `${node.type} (${node.error ? 'error' : 'missing'})`;
            }
            return;
        }
        if (node.error && !flagged) flagged = `${node.type} (error)`;
        for (const child of node.children) walk(child);
    }

    walk(root);

    if (problem.length) return { kind: 'invariant', message: problem[0] };
    if (flagged) {
        return {
            kind: 'invariant',
            message: `tree carries a grammar error node although parse reported success: ${flagged}`,
        };
    }
    return null;
}

/**
 * Run the checks for one unit.
 *
 * Ordering matters for the report: a crash is our bug and is separated from a grammar rejection,
 * and a round-trip mismatch is separated from both. A unit that fails to parse cannot be
 * round-tripped, so it is not counted against the round-trip totals.
 */
async function checkUnit(unit, deps) {
    const { parse, MotokoSyntaxError, checkRoundTrip } = deps;
    const started = process.hrtime.bigint();
    let result;
    try {
        result = await parse(unit.text);
    } catch (error) {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        if (error instanceof MotokoSyntaxError) {
            return {
                status: 'syntax-error',
                message: firstLine(error.message),
                loc: error.loc ?? null,
                ms,
            };
        }
        return {
            status: 'crash',
            message: `${error?.name ?? 'Error'}: ${firstLine(String(error?.message ?? error))}`,
            stack: error?.stack ?? null,
            ms,
        };
    }

    // The normaliser agreed with the tree; now check it lost nothing.
    const mismatch = checkRoundTrip(result.root, unit.text);
    if (mismatch) {
        return {
            status: 'round-trip',
            message: `at ${mismatch.at}: expected ${mismatch.expected} got ${mismatch.got}`,
            ms: Number(process.hrtime.bigint() - started) / 1e6,
        };
    }

    const invariant = checkInvariants(result.root, unit.text);
    if (invariant) {
        return {
            status: 'invariant',
            message: invariant.message,
            ms: Number(process.hrtime.bigint() - started) / 1e6,
        };
    }

    return {
        status: 'ok',
        root: result.root,
        ms: Number(process.hrtime.bigint() - started) / 1e6,
    };
}

function firstLine(text) {
    const cut = text.indexOf('\n');
    return cut < 0 ? text : text.slice(0, cut);
}

/**
 * The three printer checks the plan's corpus unit asks for, run on a unit that parsed.
 *
 * This is the M2 half of the harness. It is deliberately *not* inside the printer: `format` already
 * runs the runtime guard, and the point of measuring here is to be able to disagree with it. If the
 * guard's tolerance list widened until it stopped firing, the guard would still report success and
 * this stage would not — which is the only reason both exist.
 *
 * The three checks are ordered cheapest-and-most-fundamental first, so a unit that fails re-parse
 * is not then compared for tree equality against a tree that has no business existing:
 *
 *   1. `reParse`     — the printed text parses. A formatter whose output its own parser rejects is
 *                      broken regardless of what it meant.
 *   2. `treeEquality`— `shapeOf(input) === shapeOf(output)`. This is the `preserve` invariant
 *                      restated: the layout changed, the program did not. A tree difference here
 *                      means the printer changed meaning, which is the one failure this whole
 *                      milestone exists to prevent.
 *   3. `idempotence` — `format(format(x)) === format(x)`. A formatter that is not a fixed point
 *                      makes every downstream diff noisy and every round-trip claim empty.
 *
 * Note what tree equality can and cannot see, because the harness must not overclaim: `shapeOf`
 * projects `typ_params` and `inst` by node text, so it is blind to whitespace inside an angle list
 * (`docs/adjacency.md` L8) and has no node for a trailing gap, so it is blind to a trailing
 * newline. Both were real defects found by other means. A zero here is a necessary condition, not
 * a sufficient one, and `tests/printer.test.ts` and `tests/adjacency.test.ts` are where the seams no
 * gate can see are pinned.
 */
async function checkPrinter(unit, deps, sourceRoot, printed) {
    const { parse, shapeOf, compareShapes } = deps;
    const started = process.hrtime.bigint();
    const ms = () => Number(process.hrtime.bigint() - started) / 1e6;
    // Distinct temp-file names per oracle invocation, so two units in flight cannot collide and a
    // mismatch report names a readable unit. The counter lives on the function so it survives across
    // units.
    const nextOracleSeq = () =>
        (checkPrinter.oracleSeq = (checkPrinter.oracleSeq ?? 0) + 1);

    let outRoot;
    try {
        outRoot = (await parse(printed)).root;
    } catch (error) {
        return {
            status: 'printer-reparse',
            message: firstLine(error?.message ?? String(error)),
            ms: ms(),
        };
    }

    const difference = compareShapes(shapeOf(sourceRoot), shapeOf(outRoot));
    if (difference) {
        return {
            status: 'printer-tree',
            message:
                difference.path === undefined
                    ? String(difference)
                    : `at ${difference.path}: ${JSON.stringify(difference)}`,
            ms: ms(),
        };
    }

    let again;
    try {
        again = await deps.format(printed);
    } catch (error) {
        return {
            status: 'printer-idempotence',
            message: `re-formatting the output threw: ${firstLine(error?.message ?? String(error))}`,
            ms: ms(),
        };
    }
    if (again !== printed) {
        return {
            status: 'printer-idempotence',
            message: 'format(format(x)) !== format(x)',
            // The first differing line is the whole diagnostic; the full texts can be megabytes.
            firstDiff: firstLineDiff(printed, again),
            ms: ms(),
        };
    }

    // The moc oracle: does MOC read the output as the same program the input was? This is the layer
    // the guard cannot substitute for, because the guard re-parses with our grammar and is blind
    // wherever the grammar deviates (docs/grammar-deviations.md). Skipped, never faked, when moc is
    // absent -- a silent pass here would be the exact failure this layer exists to catch.
    let oracleRan = false;
    if (deps.moc) {
        const n = nextOracleSeq();
        const before = deps.parseTree(deps.moc, unit.text, `oracle-${n}-in`);
        if (before !== null) {
            const after = deps.parseTree(deps.moc, printed, `oracle-${n}-out`);
            oracleRan = true;
            if (!deps.sameTree(before, after)) {
                return {
                    status: 'printer-oracle',
                    message:
                        'moc reads the printed output as a different tree than the input',
                    firstDiff: firstTokenDiff(before, after),
                    ms: ms(),
                };
            }
        }
        // `before === null` means moc rejects the INPUT, which is moc's business and not the
        // printer's: the unit count for it is reported separately rather than counted as a pass.
    }

    return { status: 'ok', oracleRan, ms: ms() };
}

/**
 * The first differing token between two `-dp` dumps, with a little context on each side.
 *
 * Tokens rather than lines: the dump is a pretty-printer whose wrapping moves when the tree moves,
 * so a line diff would print the whole file from the first difference onward.
 */
function firstTokenDiff(before, after) {
    const a = before.split(' ');
    const b = (after ?? '').split(' ');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const lo = Math.max(0, i - 12);
    return {
        token: i,
        expected: a.slice(lo, i + 8).join(' '),
        actual: b.slice(lo, i + 8).join(' '),
    };
}

/** The first line where two texts differ, for a report that stays readable on a 2000-line file. */
function firstLineDiff(a, b) {
    const as = a.split('\n');
    const bs = b.split('\n');
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
        if (as[i] !== bs[i]) {
            return {
                line: i + 1,
                expected: as[i] ?? null,
                got: bs[i] ?? null,
            };
        }
    }
    return null;
}

/**
 * Prove the checks are not vacuous, in-run.
 *
 * "0 round-trip failures over 5590 units" is only meaningful if the round-trip check *can* fail.
 * A harness whose comparison was subtly broken — comparing a string to itself, or never reaching
 * the comparison because `parse` short-circuited — would report exactly the same zero, and the
 * reader would have no way to tell. So every run corrupts a known-good tree four ways and requires
 * the check to catch each one, plus round-trips six shapes that are easy to get wrong (empty input,
 * whitespace only, comments, CRLF, tabs, astral Unicode).
 *
 * A self-test failure is fatal and is reported as such: if it fails, the corpus numbers in the same
 * report should not be believed.
 */
async function selfTest(deps) {
    const { parse, checkRoundTrip } = deps;
    const results = [];

    const ok = async (name, source, mutate) => {
        try {
            const { root } = await parse(source);
            const tree = mutate ? structuredClone(root) : root;
            const mismatch = mutate ? mutate(tree) : null;
            const found = checkRoundTrip(tree, source);
            const expected = mutate ? 'mismatch' : 'clean';
            const actual = found ? 'mismatch' : 'clean';
            results.push({
                name,
                expected,
                actual,
                pass: expected === actual,
                detail: found,
            });
        } catch (error) {
            results.push({
                name,
                expected: mutate ? 'mismatch' : 'clean',
                actual: 'throw',
                pass: false,
                detail: `${error?.name}: ${firstLine(String(error?.message))}`,
            });
        }
    };

    const firstBranch = (node) => {
        if (node.nodeType !== 'Branch') return null;
        if (node.children.some((c) => c.nodeType === 'Token')) return node;
        for (const child of node.children) {
            const found = firstBranch(child);
            if (found) return found;
        }
        return null;
    };

    const SRC = 'actor { public func f() : async Nat { 1 } };';

    // Clean controls: the check must accept a good tree, in each awkward shape.
    for (const [name, source] of Object.entries({
        'self-test: clean source': SRC,
        'self-test: empty source': '',
        'self-test: whitespace only': '   \n\t\n',
        'self-test: line comment': '// hi\nactor {};',
        'self-test: nested block comment': '/* a /* b */ c */ actor {};',
        'self-test: CRLF': 'actor {};\r\n',
        'self-test: tab indent': '\tactor {\n\t\tpublic func f() {}\n\t};',
        'self-test: astral unicode in comment': '// 🎉 你好\nactor {};',
        'self-test: astral unicode in string':
            'actor { public let x = "🎉 你好"; };',
    })) {
        await ok(name, source, null);
    }

    // Corruptions: each must be caught.
    await ok('self-test: detect dropped child', SRC, (tree) => {
        const branch = firstBranch(tree);
        branch.children = branch.children.slice(1);
    });
    await ok('self-test: detect truncated leaf', SRC, (tree) => {
        const branch = firstBranch(tree);
        const leaf = branch.children.find((c) => c.nodeType === 'Token');
        leaf.endIndex -= 1;
        leaf.text = leaf.text.slice(0, -1);
    });

    // This one needs a *different* source than the tree was built from, so it is done directly
    // rather than through `ok`.
    {
        const { root } = await parse(SRC);
        const found = checkRoundTrip(root, `${SRC} // trailing`);
        results.push({
            name: 'self-test: detect trailing source text',
            expected: 'mismatch',
            actual: found ? 'mismatch' : 'clean',
            pass: Boolean(found),
            detail: found,
        });
    }

    const failed = results.filter((r) => !r.pass);
    return {
        passed: results.length - failed.length,
        total: results.length,
        failed,
        results,
        fences: fenceSelfTest(),
    };
}

/**
 * The printer check's own non-vacuity test, on the same principle as `selfTest`.
 *
 * `checkPrinter` is the harness's one new moving part in M2, and its three failure buckets could
 * all read zero simply because the function returns `ok` without lookin at anything. So this feeds
 * it a real source it *knows* formats, and then requires each check to fire on a deliberate
 * corruption of what it is given:
 *
 *   - a `sourceRoot` from a different program makes tree equality detect a difference (and proves
 *     `compareShapes` is being consulted rather than assumed);
 *   - a `printed` string that is not a fixed point makes idempotence fail;
 *   - a `printed` string that does not parse makes re-parse fail;
 *   - when a `moc` binary is present, a `printed` string that moc reads differently makes the oracle
 *     fail.
 *
 * The last three are simulated by driving the pieces directly rather than by finding a source the
 * printer mishandles — there is no such source, which is the point of the run — so the checks here
 * are of the harness's logic, not of the printer. The oracle case is the one that can only be built
 * this way, and deliberately so: it uses the spaced-type-application form (`List< Nat >`) that
 * `docs/grammar-deviations.md` §3 catalogues, because that is a string our grammar reads as the same
 * program, that is a fixed point, and that moc refuses to parse at all. Every other check passes on
 * it, so if the oracle is wired up it is the only one left to object — which is exactly the claim
 * being tested. If our grammar ever stops accepting that form, this case fails loudly with
 * `printer-reparse` instead of silently passing, which is the right signal: the deviation moved.
 */
async function printerSelfTest(deps) {
    const { parse } = deps;
    const results = [];
    const record = (name, expected, actual) =>
        results.push({ name, expected, actual, pass: expected === actual });

    const source = 'actor { public func f() : async Nat { 1 } };';
    const unit = {
        id: 0,
        source: 'self-test',
        path: 'self-test',
        line: null,
        text: source,
    };

    try {
        const printed = await deps.format(source);
        const clean = await checkPrinter(
            unit,
            deps,
            (await parse(source)).root,
            printed,
        );
        record(
            'printer self-test: a clean unit passes every check',
            'ok',
            clean.status,
        );

        // A different program as the reference tree: tree equality must not be a tautology.
        const other = await parse(
            'actor { public func g() : async Nat { 2 } };',
        );
        const wrongTree = await checkPrinter(unit, deps, other.root, printed);
        record(
            'printer self-test: a mismatched reference tree is caught',
            'printer-tree',
            wrongTree.status,
        );

        // Non-parseable "output": the re-parse check must speak.
        const broken = await checkPrinter(
            unit,
            deps,
            (await parse(source)).root,
            'actor { public func f() : async Nat { 1 } ',
        );
        record(
            'printer self-test: unparseable output is caught',
            'printer-reparse',
            broken.status,
        );

        // Not-a-fixed-point "output": idempotence must speak. Trailing blank lines are invisible to
        // `shapeOf`, so this lands on the idempotence check rather than the tree check — which is
        // the ordering `checkPrinter` documents.
        const unstable = await checkPrinter(
            unit,
            deps,
            (await parse(source)).root,
            `${source}\n\n\n`,
        );
        record(
            'printer self-test: a non-fixed-point output is caught',
            'printer-idempotence',
            unstable.status,
        );

        // The oracle must be able to speak, and this is the only input that isolates it: a spaced
        // type-application (`List< Nat >`, `docs/grammar-deviations.md` §3) is read by our grammar
        // as the same program, is a fixed point, and is still a failure — because moc will not parse
        // it at all. Re-parse, tree equality and idempotence all pass on it, so the oracle is the
        // only check left that can object, which is exactly the claim being tested. With no `moc`
        // binary the layer is honestly absent and no case is recorded.
        //
        // `printed` is produced by `format` rather than written by hand: the idempotence check
        // compares against `format`'s own output, trailing newline included, so a hand-written
        // string fails idempotence first and the oracle never gets a turn.
        if (deps.moc) {
            const unspaced =
                'actor { public func f() : async () { let x : List<Nat> = l; } };';
            const spaced = await deps.format(
                unspaced.replace('<Nat>', '< Nat >'),
            );
            const angleUnit = {
                id: 0,
                source: 'self-test',
                path: 'self-test',
                line: null,
                text: unspaced,
            };
            const oracleOnly = await checkPrinter(
                angleUnit,
                deps,
                (await parse(unspaced)).root,
                spaced,
            );
            record(
                'printer self-test: an oracle-only mismatch is caught',
                'printer-oracle',
                oracleOnly.status,
            );
        }
    } catch (error) {
        record(
            `printer self-test: threw (${firstLine(String(error?.message))})`,
            'no throw',
            'throw',
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
 * The fence scanner's own self-test.
 *
 * The plan names the exact bug this guards against: "#6385's own first harness anchored the fence
 * regex at column 0, silently matched none of `style-guide.md`'s fences, and so skipped the file
 * with the largest diff." An indent-aware scanner that regressed to column 0 would still report a
 * plausible corpus — it would just quietly drop 108 indented fences. So the scanner is checked
 * against a document that contains one fence at column 0, one indented inside a list item, one in
 * another language, and one unterminated at EOF, and each of the four must be classified right.
 */
function fenceSelfTest() {
    const doc = [
        'intro text',
        '```motoko',
        'actor {};',
        '```',
        '',
        '* a list item:',
        '',
        '  ```motoko no-repl',
        '  actor { public func f() {} };',
        '  ```',
        '',
        '```typescript',
        'const x = 1;',
        '```',
        '',
        '```motoko',
        'unclosed fence at eof',
    ].join('\n');

    const found = extractMotokoFences(doc);
    const checks = [
        {
            name: 'fence: finds a column-0 motoko block',
            pass: found.some((f) => f.line === 2 && f.indent === 0),
        },
        {
            name: 'fence: finds an indented motoko block and de-indents it exactly',
            pass: found.some(
                (f) =>
                    f.line === 8 &&
                    f.indent === 2 &&
                    f.text === 'actor { public func f() {} };',
            ),
        },
        {
            name: 'fence: skips a non-motoko block',
            pass: !found.some((f) => f.text.includes('const x')),
        },
        {
            name: 'fence: marks an unterminated trailing block unclosed rather than extending to EOF',
            pass: found.some((f) => f.line === 16 && f.closed === false),
        },
    ];
    const failed = checks.filter((c) => !c.pass);
    return {
        passed: checks.length - failed.length,
        total: checks.length,
        failed,
        results: checks,
    };
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

    // Import the plugin's parser through Node's own TypeScript support rather than through a build
    // step: `run.mjs` is a script in a repo whose `.ts` sources are erasable-syntax-only, and Node
    // ≥ 22.6 can import them directly. If that ever stops being true the harness should fail here,
    // loudly, rather than measure a stale `lib/`.
    const parseModule = await import(
        pathToFileURL(join(repoRoot, 'src', 'parser', 'parse.ts')).href
    );
    const normalizeModule = await import(
        pathToFileURL(join(repoRoot, 'src', 'parser', 'normalize.ts')).href
    );
    const verifyModule = await import(
        pathToFileURL(join(repoRoot, 'src', 'verify.ts')).href
    );
    // The printer is imported the same way, so the harness measures `src/`, not a stale `lib/`.
    // Prettier is resolved from the repo's own node_modules — the harness is not a published
    // entry point, and pinning a second copy of Prettier here would let the two drift.
    const prettier = (await import('prettier')).default;
    const plugin = (
        await import(pathToFileURL(join(repoRoot, 'src', 'index.ts')).href)
    ).default;

    /**
     * Format one unit exactly as a user would: same parser name, same plugin, and the documented
     * defaults. An option set that differed from `printer.test.ts`'s would let the corpus pass while
     * a test configuration failed (or the reverse), so this is the one place the pair is spelled.
     */
    const format = (source) =>
        prettier.format(source, {
            parser: 'motoko',
            plugins: [plugin],
            printWidth: 80,
            tabWidth: 2,
            trailingComma: 'none',
        });

    const deps = {
        parse: parseModule.parse,
        MotokoSyntaxError: parseModule.MotokoSyntaxError,
        checkRoundTrip: normalizeModule.checkRoundTrip,
        shapeOf: normalizeModule.shapeOf,
        compareShapes: verifyModule.compareShapes,
        format,
        // The moc AST oracle. `moc` is null when no binary was found, and every oracle check then
        // reports "not run" with the reason instead of passing -- the layer must never be able to
        // pass by doing nothing.
        moc: findMoc(opts.motokoDir),
        parseTree,
        sameTree,
    };
    if (
        typeof deps.parse !== 'function' ||
        typeof deps.checkRoundTrip !== 'function' ||
        typeof deps.shapeOf !== 'function' ||
        typeof deps.compareShapes !== 'function' ||
        typeof deps.format !== 'function'
    ) {
        throw new Error(
            'corpus harness: src/parser/parse.ts, normalize.ts, verify.ts or src/index.ts did not ' +
                'export the expected functions. The harness measures those modules; a rename must ' +
                'be reflected here.',
        );
    }

    // `--require-oracle` turns the one honest absence into a failure, and does it HERE rather than
    // at the exit-code computation: a runner with no moc would otherwise spend the whole run and
    // then report "oracle: not run" as green. Without the flag, an absent oracle is correct on a
    // developer machine and the report says so; with it, an oracle-less run declares itself
    // incomplete instead of looking finished, which is what CI wants.
    if (opts.requireOracle && !deps.moc) {
        throw new Error(
            'corpus harness: --require-oracle was passed but no moc binary was found. Set ' +
                'MOC=<path>, or build the pinned head (docs/grammar-deviations.md). Refusing to ' +
                'run an oracle-less corpus job that would report green.',
        );
    }

    const checkouts = indexCheckouts(opts.reposDir);
    const { sources, skips: sourceSkips } = buildSources(opts, checkouts);

    // Prove the checks can fail before reporting that they did not.
    const selfTestResult = await selfTest(deps);
    const printerSelfTestResult = await printerSelfTest(deps);
    const allSelfTestFailures = [
        ...selfTestResult.failed,
        ...selfTestResult.fences.failed,
        ...printerSelfTestResult.failed,
    ];
    if (allSelfTestFailures.length) {
        throw new Error(
            `corpus harness self-test failed (${allSelfTestFailures.length} of ` +
                `${selfTestResult.total + selfTestResult.fences.total + printerSelfTestResult.total}): ` +
                allSelfTestFailures
                    .map((f) =>
                        'expected' in f
                            ? `${f.name} expected ${f.expected} got ${f.actual}`
                            : f.name,
                    )
                    .join('; ') +
                '. The corpus numbers this run would produce MUST NOT be believed.',
        );
    }
    if (!opts.quiet) {
        process.stderr.write(
            `self-test: ${selfTestResult.passed}/${selfTestResult.total} round-trip checks + ` +
                `${selfTestResult.fences.passed}/${selfTestResult.fences.total} fence checks + ` +
                `${printerSelfTestResult.passed}/${printerSelfTestResult.total} printer checks passed ` +
                `(the round-trip check rejects 3 deliberate corruptions and accepts 9 clean shapes; ` +
                `the printer check is fed a mismatched tree, unparseable output and a non-fixed-point ` +
                `output, and must reject all three)\n`,
        );
    }

    const counters = {
        skipped: [...sourceSkips],
        fences: { files: 0, total: 0, motoko: 0 },
    };

    // Resolve every source to a pinned commit. All reads happen through `git`, so a working tree
    // with local edits cannot change what is measured; the dirty state is recorded in the report.
    const pinned = [];
    for (const source of sources) {
        // `--motoko-rev` pins the Motoko *compiler* repo, which is the one the M1 exit number is
        // measured against and the one a reader wants to reproduce. Every other source is a
        // supporting package set on its own default branch, and forcing the compiler's pin onto
        // them resolves nothing (they use `main`) — which is exactly what happened the first time
        // this ran, and why the report now names the ref each source resolved through. Each
        // source's resolved 40-hex commit is recorded either way, so a run is reproducible from
        // its own report even when it did not pin a sibling.
        const wantRev =
            source.label === 'motoko' ? (opts.motokoRev ?? 'HEAD') : 'HEAD';
        let resolved;
        try {
            resolved = resolveRev(source.dir, wantRev);
        } catch (error) {
            if (source.label === 'motoko') throw error;
            counters.skipped.push({
                kind: 'rev-unresolved',
                source: source.label,
                reason: firstLine(String(error.message ?? error)),
            });
            continue;
        }
        pinned.push({
            ...source,
            rev: resolved.rev,
            ref: resolved.ref,
            head: headRev(source.dir),
            slug: originSlug(source.dir),
        });
    }

    // Collect units.
    const units = [];
    for (const source of pinned) {
        const collected = collectUnits(source, source.rev, counters, opts.job);
        for (const unit of collected) units.push(unit);
    }

    // The grammar's own test corpus is GENERATED and gitignored; on a developer machine it is
    // present on disk, which would make the number depend on whether someone happened to run
    // `just build`. It is recorded as an explicit skip with that reason, not silently ignored.
    const generatedCorpus = join(
        repoRoot,
        '..',
        'tree-sitter-motoko',
        'test',
        'corpus',
        'generated',
    );
    if (existsSync(generatedCorpus)) {
        let count = 0;
        const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const p = join(dir, entry.name);
                if (entry.isDirectory()) walk(p);
                else if (
                    entry.name.endsWith('.mo') ||
                    entry.name.endsWith('.mo.txt')
                )
                    count += 1;
            }
        };
        try {
            walk(generatedCorpus);
        } catch {
            // A partially written generated directory is not worth failing over; the reason below
            // is accurate either way.
        }
        counters.skipped.push({
            kind: 'generated-corpus',
            what: 'tree-sitter-motoko/test/corpus/generated',
            reason:
                'generated and gitignored (tree-sitter-motoko justfile: `rm -rf test/corpus/generated`); ' +
                'present on this machine but not at any pinned revision, so including it would make ' +
                'the number depend on local build state',
            filesOnDisk: count,
        });
    }

    // Run.
    const startedAt = Date.now();
    const failures = {
        'syntax-error': [],
        crash: [],
        'round-trip': [],
        invariant: [],
        'printer-reparse': [],
        'printer-tree': [],
        'printer-idempotence': [],
        'printer-oracle': [],
    };
    let ok = 0;
    // Units that never reached the printer, because the grammar rejected them. Tracked separately
    // from `ok` so the printer checks have an honest denominator: "0 of 0 tree differences" and
    // "0 of 5590" are different claims, and only the second is worth anything. Every unit that
    // *did* parse is formatted, so `notFormattable` is exactly the syntax-error/round-trip/crash
    // set and `printerChecked + printerFailures + notFormattable === units`.
    let notFormattable = 0;
    let printerChecked = 0;
    // Units the moc oracle actually reached: parsed by moc on both sides and compared. Kept apart
    // from `printerChecked` so "0 of 0 oracle mismatches" can never be reported as a pass.
    let oracleChecked = 0;
    // Per-source printer tallies. Kept as a separate map rather than folded into `bySource`'s `ok`
    // because those two numbers mean different things: `ok` is "the parser accepted this unit",
    // which is what the M1 headline measures, while these are the M2 addendum. Folding them would
    // silently redefine a published number.
    const printerBySource = new Map();
    const tally = (source, key) => {
        const row = printerBySource.get(source) ?? {
            checked: 0,
            reparse: 0,
            tree: 0,
            idempotence: 0,
            oracle: 0,
            oracleChecked: 0,
        };
        row[key] += 1;
        printerBySource.set(source, row);
    };
    const progress = (done, total, unit) => {
        if (opts.quiet || done % 500 !== 0) return;
        process.stderr.write(
            `  ${done}/${total} units… (${new Date().toISOString().slice(11, 19)})\n`,
        );
    };

    for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const outcome = await checkUnit(unit, deps);
        if (outcome.status === 'ok') {
            ok += 1;
            // Parse is clean, so the printer half can run. A unit the grammar rejects on purpose is
            // not formatted: there is no meaningful output to compare, and formatting it would also
            // mean asking Prettier to print a tree that carries an error node.
            const printed = await deps.format(unit.text).catch((error) => ({
                thrown: firstLine(error?.message ?? String(error)),
            }));
            if (typeof printed !== 'string') {
                // `format` itself refused, which is a printer failure and belongs in the failures
                // list rather than the skip list — the guard rejected the printer's own output.
                failures['printer-reparse'].push({
                    id: unit.id,
                    source: unit.source,
                    path: unit.path,
                    line: unit.line,
                    message: `format() threw: ${printed.thrown}`,
                });
                tally(unit.source, 'reparse');
            } else {
                const check = await checkPrinter(
                    unit,
                    deps,
                    outcome.root,
                    printed,
                );
                if (check.status === 'ok') {
                    printerChecked += 1;
                    tally(unit.source, 'checked');
                    // The oracle's own denominator: units moc could parse AND agree on. A unit moc
                    // rejects has no oracle verdict, and reporting it in the oracle denominator
                    // would inflate coverage with units that were never checked.
                    if (check.oracleRan) {
                        oracleChecked += 1;
                        tally(unit.source, 'oracleChecked');
                    }
                } else {
                    failures[check.status].push({
                        id: unit.id,
                        source: unit.source,
                        path: unit.path,
                        line: unit.line,
                        message: check.message,
                        ...(check.firstDiff
                            ? { firstDiff: check.firstDiff }
                            : {}),
                    });
                    // `printer-reparse` / `printer-tree` / `printer-idempotence` are exactly the
                    // `reparse` / `tree` / `idempotence` tallies, so the key is the tail of the
                    // failure bucket's name rather than a second lookup table that could drift.
                    tally(unit.source, check.status.slice('printer-'.length));
                }
            }
        } else {
            failures[outcome.status].push({
                id: unit.id,
                source: unit.source,
                path: unit.path,
                line: unit.line,
                message: outcome.message,
                ...(outcome.loc ? { loc: outcome.loc } : {}),
                ...(outcome.stack ? { stack: outcome.stack } : {}),
            });
            notFormattable += 1;
        }
        progress(i + 1, units.length, unit);
    }
    const elapsedMs = Date.now() - startedAt;

    // Coverage: how many of the units are the "grammar rejects this on purpose" set. `test/fail`
    // is moc's own negative-fixture directory; a rejection there is the grammar working.
    const isNegative = (u) => /(^|\/)test\/fail\//.test(u.path);
    const syntaxErrorsInFailDir = failures['syntax-error'].filter((f) =>
        isNegative(f),
    ).length;

    // A *whole-file* syntax error is only expected on a negative fixture or a documented deviation.
    // Everything else is a coverage regression, and it is broken out so it cannot hide inside the
    // fence noise (most fence rejections are documentation showing API signatures, not code).
    const unexpected = failures['syntax-error'].filter(
        (f) =>
            f.line === null &&
            !isNegative(f) &&
            !DOCUMENTED_DEVIATIONS.has(f.path),
    );
    const documented = failures['syntax-error'].filter(
        (f) =>
            f.line === null &&
            !isNegative(f) &&
            DOCUMENTED_DEVIATIONS.has(f.path),
    );
    const fenceErrors = failures['syntax-error'].filter((f) => f.line !== null);

    const bySource = new Map();
    for (const s of pinned) {
        bySource.set(s.label, {
            units: 0,
            files: 0,
            fences: 0,
            ok: 0,
            syntaxError: 0,
            crash: 0,
            roundTrip: 0,
            invariant: 0,
            printerChecked: 0,
            printerReParse: 0,
            printerTree: 0,
            printerIdempotence: 0,
        });
    }
    for (const u of units) {
        const row = bySource.get(u.source);
        row.units += 1;
        if (u.kind === 'fence') row.fences += 1;
        else row.files += 1;
    }
    for (const f of failures['syntax-error'])
        bySource.get(f.source).syntaxError += 1;
    for (const f of failures.crash) bySource.get(f.source).crash += 1;
    for (const f of failures['round-trip'])
        bySource.get(f.source).roundTrip += 1;
    for (const f of failures.invariant) bySource.get(f.source).invariant += 1;
    // The printer tallies ride along per source, so "0 tree differences" can be read against the
    // number of units that actually reached the printer in that source rather than against `ok`.
    for (const [label, row] of printerBySource) {
        const target = bySource.get(label);
        if (!target) continue;
        target.printerChecked = row.checked;
        target.printerReParse = row.reparse;
        target.printerTree = row.tree;
        target.printerIdempotence = row.idempotence;
        target.printerOracle = row.oracle;
        target.oracleChecked = row.oracleChecked;
    }
    for (const [label, row] of bySource) {
        row.ok =
            row.units -
            row.syntaxError -
            row.crash -
            row.roundTrip -
            row.invariant;
        void label;
    }

    const report = {
        generatedAt: new Date().toISOString(),
        job: opts.job,
        pins: {
            motokoRev: opts.motokoRev ?? 'HEAD',
            oracleRev: opts.oracleRev,
            // `oracleRev` still pins the compiler source the corpus is read at; the AST oracle is a
            // moc BINARY, so what it actually ran is recorded here rather than only the revision
            // asked for. `oracleLayer` says whether it ran at all.
            oracleLayer: deps.moc ? 'run' : 'not-run',
            oracleBinary: deps.moc
                ? {
                      path: deps.moc.path,
                      version: deps.moc.version,
                      kind: deps.moc.kind,
                  }
                : null,
        },
        grammar: await grammarProvenance(),
        environment: {
            node: process.version,
            platform: `${process.platform}-${process.arch}`,
            elapsedMs,
        },
        totals: {
            units: units.length,
            ok,
            syntaxError: failures['syntax-error'].length,
            crash: failures.crash.length,
            roundTrip: failures['round-trip'].length,
            invariant: failures.invariant.length,
            syntaxErrorsInFailDir,
            syntaxErrorsDocumentedDeviation: documented.length,
            syntaxErrorsUnexpected: unexpected.length,
            syntaxErrorsInFences: fenceErrors.length,
            printerChecked,
            notFormattable,
            printerReParse: failures['printer-reparse'].length,
            printerTree: failures['printer-tree'].length,
            printerIdempotence: failures['printer-idempotence'].length,
            printerOracle: failures['printer-oracle'].length,
            // The oracle's honest denominators. `oracleChecked` counts units moc could parse on
            // both sides, so a run with no moc binary reports 0 checked and "not-run" below.
            oracleChecked,
            oracleNotRun: deps.moc ? 0 : printerChecked,
        },
        checks: {
            parse: 'run',
            tokenRoundTrip: 'run',
            invariants: 'run',
            idempotence: 'run',
            reParse: 'run',
            treeEquality: 'run',
            mocOracle: deps.moc
                ? `run (${deps.moc.version || deps.moc.path})`
                : 'not-run (no moc binary found; MOC=<path> to enable)',
        },
        fences: counters.fences,
        sources: [...bySource.entries()].map(([label, row]) => {
            const pin = pinned.find((p) => p.label === label);
            return {
                label,
                ...row,
                dir: pin?.dir ?? null,
                rev: pin?.rev ?? null,
                ref: pin?.ref ?? null,
                head: pin?.head ?? null,
                slug: pin?.slug ?? null,
            };
        }),
        skips: counters.skipped,
        skipsByKind: countBy(counters.skipped, (s) => s.kind),
        selfTest: selfTestResult,
        printerSelfTest: printerSelfTestResult,
        failures: {
            ...failures,
            'unexpected-syntax-error': unexpected,
        },
        documentedDeviations: [
            ...new Set(
                failures['syntax-error']
                    .filter(
                        (f) =>
                            f.line === null &&
                            DOCUMENTED_DEVIATIONS.has(f.path),
                    )
                    .map((f) => f.path),
            ),
        ].sort(),
    };

    writeFileSync(opts.json, `${JSON.stringify(report, null, 2)}\n`);

    const markdown = renderReport(report, opts);
    mkdirSync(dirname(opts.report), { recursive: true });
    writeFileSync(opts.report, markdown);

    process.stdout.write(
        [
            '',
            `units ${report.totals.units}  ok ${report.totals.ok}  ` +
                `syntax-error ${report.totals.syntaxError} (${report.totals.syntaxErrorsUnexpected} unexpected)  ` +
                `crash ${report.totals.crash}  ` +
                `round-trip-fail ${report.totals.roundTrip}  invariant-fail ${report.totals.invariant}`,
            `printer ${report.totals.printerChecked}/${report.totals.ok} checked  ` +
                `reparse-fail ${report.totals.printerReParse}  ` +
                `tree-diff ${report.totals.printerTree}  ` +
                `idempotence-fail ${report.totals.printerIdempotence}  ` +
                `(not-formattable ${report.totals.notFormattable})`,
            // The oracle gets its own line, and an explicit "not run" when moc is absent, because
            // "0 mismatches" and "0 of 0 checked" are different claims and the second must never
            // read as the first. Keyed off `pins.oracleLayer` rather than comparing two totals:
            // the totals are a coincidence of arithmetic, the pin is the actual fact.
            report.pins.oracleLayer === 'not-run'
                ? `oracle  not run (no moc binary found; set MOC=<path>)`
                : `oracle  ${report.totals.oracleChecked}/${report.totals.printerChecked} checked  ` +
                  `mismatches ${report.totals.printerOracle}`,
            `skipped ${report.skips.length} item(s) across ${Object.keys(report.skipsByKind).length} kind(s)`,
            `wrote ${relative(process.cwd(), opts.json)}`,
            `wrote ${relative(process.cwd(), opts.report)}`,
            '',
        ].join('\n'),
    );

    // The gate: crashes (our bugs), round-trip failures (our bugs), invariant violations (our bugs),
    // a whole-file syntax error that is not accounted for, and every printer failure — a printer
    // failure is by definition our bug, since a corpus file that parsed cleanly was formatted and
    // the result either did not parse, did not mean the same thing, or was not a fixed point.
    // Ordinary grammar rejections on fixtures, documented deviations and Markdown fences do not.
    //
    // `printer-oracle` belongs in this sum even though it can only fire when a `moc` binary is
    // present: with no `moc` the list is necessarily empty, so its presence costs nothing, and with
    // one, an oracle mismatch is the *most* serious of the four — the other three ask our own
    // grammar whether the output is still the same program, and this one asks moc.
    const fatal =
        failures.crash.length +
        failures['round-trip'].length +
        failures.invariant.length +
        failures['printer-reparse'].length +
        failures['printer-tree'].length +
        failures['printer-idempotence'].length +
        failures['printer-oracle'].length +
        unexpected.length;
    process.exitCode = fatal === 0 ? 0 : 1;
}

function pathToFileUrl(p) {
    return pathToFileURL(p).href;
}

function countBy(items, key) {
    const out = {};
    for (const item of items) {
        const k = key(item);
        out[k] = (out[k] ?? 0) + 1;
    }
    return out;
}

/** Grammar + wasm provenance, so a report can be checked against the grammar it was produced from. */
async function grammarProvenance() {
    const { createRequire } = await import('node:module');
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const require = createRequire(join(repoRoot, 'package.json'));
    let version = null;
    let wasmPath = null;
    try {
        const pkg = require.resolve('tree-sitter-motoko/package.json');
        version = require(pkg).version;
        wasmPath = join(dirname(pkg), 'tree-sitter-motoko.wasm');
    } catch {
        // Leave both null; the report says "unknown" rather than inventing a version.
    }
    let sha256 = null;
    if (wasmPath && existsSync(wasmPath)) {
        sha256 = createHash('sha256')
            .update(readFileSync(wasmPath))
            .digest('hex');
    }
    let info = null;
    try {
        const ts = await import(
            pathToFileURL(join(repoRoot, 'src', 'parser', 'tree-sitter.ts'))
                .href
        );
        info = await ts.grammarInfo();
    } catch {
        // A failure to introspect the grammar is worth reporting but not worth failing on.
    }
    return { package: 'tree-sitter-motoko', version, wasmSha256: sha256, info };
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

function renderReport(report, opts) {
    const t = report.totals;
    const moto = report.sources.find((s) => s.label === 'motoko') ?? {
        ok: 0,
        units: 1,
        syntaxError: 0,
    };
    const motoFileExpected = report.failures['syntax-error'].filter(
        (f) =>
            f.source === 'motoko' &&
            f.line === null &&
            (/(^|\/)test\/fail\//.test(f.path) ||
                report.documentedDeviations.includes(f.path)),
    ).length;
    const motoFileUnexpected = report.failures[
        'unexpected-syntax-error'
    ].filter((f) => f.source === 'motoko').length;
    const pct = (n, d) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);
    const lines = [];

    lines.push('# Corpus harness results');
    lines.push('');
    lines.push(
        `Generated ${report.generatedAt} by \`node tools/corpus/run.mjs\` (job \`${report.job}\`) on ` +
            `Node ${report.environment.node} (${report.environment.platform}) in ` +
            `${(report.environment.elapsedMs / 1000).toFixed(1)}s.`,
    );
    lines.push('');
    lines.push(
        'This file is written by the harness. It is the artifact `.github/workflows/corpus.yml` ' +
            'uploads, and the source of the number quoted in `docs/m1-architecture.md`.',
    );

    lines.push('');
    lines.push('## What ran, and what did not');
    lines.push('');
    lines.push('| plan check | status |');
    lines.push('| --- | --- |');
    for (const [name, status] of Object.entries(report.checks)) {
        lines.push(`| ${name} | ${status} |`);
    }
    lines.push('');
    lines.push(
        '**Idempotence, re-parse and tree equality are now run.** They compare a formatted output ' +
            'against its input, so they need a printer; M1 was parse-only and reported them ' +
            '`not-run`. M2 ships the `preserve` printer, and the harness formats every unit that ' +
            'parsed and checks the output three ways: it re-parses, it means the same thing ' +
            '(`compareShapes`), and formatting it again is a fixed point. The denominator is not ' +
            'the unit count — units the grammar rejects have no output to compare — so the printer ' +
            'totals below are reported against the units that reached the printer, and the rest are ' +
            'counted as `not-formattable`.',
    );
    lines.push('');
    lines.push(
        '**A zero here is a necessary condition, not a sufficient one.** `shapeOf` projects an ' +
            'angle list (`typ_params`, `inst`) by its node text, so it is blind to whitespace ' +
            'inside the angle brackets — the `L8` defect where a broken list drops the close onto ' +
            'its own line, which `moc` then reads as a greater-than operator. It is also blind to a ' +
            'trailing gap. Those seams are pinned by `tests/adjacency.test.ts` instead, which is ' +
            'the reason that suite exists.',
    );
    lines.push('');
    lines.push(
        `**Non-vacuity self-test: ${report.selfTest.passed}/${report.selfTest.total} round-trip ` +
            `checks and ${report.selfTest.fences.passed}/${report.selfTest.fences.total} fence ` +
            `checks passed.** ` +
            `A "0 round-trip failures" number is only worth reading if the check *can* fail, so ` +
            `every run first corrupts a known-good tree three ways (dropped child, truncated leaf, ` +
            `trailing source text) and requires the check to catch each one, and round-trips nine ` +
            `awkward-but-valid shapes (empty, whitespace-only, comments, nested comments, CRLF, ` +
            `tabs, astral Unicode in comments and strings). The fence scanner is checked separately ` +
            `against a document with a column-0 fence, an indented fence inside a list item, a ` +
            `non-Motoko fence and an unterminated trailing fence — the indented case is the exact ` +
            `bug #6385's first harness had (a column-0 anchor silently matched no fence in ` +
            `\`style-guide.md\`). A failure in either aborts the run.`,
    );

    lines.push('');
    lines.push('## Headline');
    lines.push('');
    lines.push(`- **Units checked:** ${t.units}`);
    lines.push(`- **Parse ok:** ${t.ok} (${pct(t.ok, t.units)})`);
    lines.push(
        `- **Grammar syntax errors:** ${t.syntaxError} (${pct(t.syntaxError, t.units)})`,
    );
    lines.push('');
    lines.push(
        'The syntax errors decompose, and the decomposition is the useful part:',
    );
    lines.push('');
    lines.push('| where | count | expected? |');
    lines.push('| --- | ---: | --- |');
    lines.push(
        `| whole \`.mo\` file in moc's own \`test/fail/\` (negative fixtures) | ${t.syntaxErrorsInFailDir} | yes — a rejection is the grammar working |`,
    );
    lines.push(
        `| whole \`.mo\` file on the documented-deviation list | ${t.syntaxErrorsDocumentedDeviation} | yes — \`docs/grammar-deviations.md\` |`,
    );
    lines.push(
        `| \`motoko\` fence inside Markdown | ${t.syntaxErrorsInFences} | mostly — many fences are API signatures or fragments, not compilable units |`,
    );
    lines.push(
        `| **whole \`.mo\` file otherwise (COVERAGE REGRESSION)** | **${t.syntaxErrorsUnexpected}** | **no — must be 0** |`,
    );
    lines.push('');
    lines.push(`- **Normaliser crashes (our bugs):** ${t.crash}`);
    lines.push(`- **Token round-trip failures (our bugs):** ${t.roundTrip}`);
    lines.push(`- **Invariant violations (our bugs):** ${t.invariant}`);
    lines.push('');
    lines.push(
        `### Printer (\`preserve\`) — ${t.printerChecked}/${t.ok} parse-ok units checked`,
    );
    lines.push('');
    lines.push(
        '| check | count | meaning |',
        '| --- | ---: | --- |',
        `| units formatted and re-parsed identically | ${t.printerChecked} | a failure to re-parse is a syntax error the printer introduced |`,
        `| output does not parse (OUR BUG) | ${t.printerReParse} | \`format\` threw, or its output was rejected |`,
        `| output means something else (OUR BUG) | ${t.printerTree} | \`compareShapes\` found a difference |`,
        `| output is not a fixed point (OUR BUG) | ${t.printerIdempotence} | formatting twice differs from formatting once |`,
        `| \`moc\` reads the output differently (OUR BUG) | ${t.printerOracle} | the moc AST oracle disagreed — it uses \`moc\`'s parser, so it catches readings our own grammar gets wrong (\`docs/grammar-deviations.md\`) |`,
        `| units the grammar rejected or the normaliser failed, so no output to compare | ${t.notFormattable} | they are the ${t.syntaxError} syntax error(s), ${t.roundTrip} round-trip failure(s), ${t.crash} crash(es) and ${t.invariant} invariant violation(s) above, so \`${t.notFormattable} = ${t.units} - ${t.ok}\` |`,
    );
    lines.push('');
    lines.push(
        `The four printer failure counts are what fail the run. \`${t.printerChecked} + ${t.notFormattable} = ${t.units}\` ` +
            `is the accounting identity: every parse-ok unit (${t.printerChecked}) was formatted and ` +
            `checked, the rest (${t.notFormattable}) never had an output to check. With all four at ` +
            `zero the honest claim is *every unit that parsed was formatted into something that ` +
            `parses, means the same thing, and is a fixed point* — not "the printer is correct", ` +
            `because \`shapeOf\` cannot see the angle seams (§ above).`,
    );
    lines.push('');
    lines.push(
        report.pins.oracleBinary
            ? `The moc AST oracle ran on **${t.oracleChecked}/${t.printerChecked}** of the units that ` +
                  `reached the printer, under \`${report.pins.oracleBinary.version || report.pins.oracleBinary.path}\`. ` +
                  `The remaining ${t.printerChecked - t.oracleChecked} are units \`moc\` itself rejects, which have ` +
                  `no oracle verdict rather than a passing one. This layer is strictly stronger than the ` +
                  `\`compareShapes\` row above: it asks \`moc\`, not our grammar, so it sees the readings our ` +
                  `grammar gets wrong — and a zero here and a zero there are therefore different claims.`
            : `The moc AST oracle **did not run** (\`${t.oracleNotRun}\` units went unchecked by it). ` +
                  `It needs a \`moc\` binary: set \`MOC=<path>\`, or build one at the path ` +
                  `\`docs/grammar-deviations.md\` documents. The layer being absent is reported as ` +
                  `*not-run*, never as a zero, because a check that cannot fail proves nothing.`,
    );
    lines.push('');
    lines.push(
        `Across all sources, **${t.ok}/${t.units} = ${pct(t.ok, t.units)}** of units parse. ` +
            `Against the Motoko compiler repo alone — the number \`docs/m1-architecture.md\` quotes ` +
            `— it is **${moto.ok}/${moto.units} = ${pct(moto.ok, moto.units)}**: ` +
            `${moto.units - moto.ok} rejections, being ${motoFileExpected} whole-file (of which ` +
            `${motoFileUnexpected} unexpected) and ${moto.syntaxError - motoFileExpected - motoFileUnexpected} ` +
            `inside Markdown fences.`,
    );

    if (t.syntaxErrorsUnexpected > 0) {
        lines.push('');
        lines.push(
            '> **⚠️ Unexpected whole-file syntax errors.** These are not negative fixtures and not ' +
                'on the documented-deviation list, so they mean the grammar lost coverage. They ' +
                'are listed under Failures and fail the run.',
        );
    }

    lines.push('');
    lines.push('## Per source');
    lines.push('');
    lines.push(
        '`files` are `.mo` units; `fences` are `motoko` fenced blocks lifted out of Markdown. A ' +
            'Markdown file can contribute many units, so the two columns explain a unit count that ' +
            'is larger than the file count.',
    );
    lines.push('');
    lines.push(
        '| source | units | files | fences | ok | syntax-error | crash | round-trip | invariant | printed | reparse-fail | tree-diff | idem-fail | oracle-mismatch | oracle-checked |',
    );
    lines.push(
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const row of report.sources) {
        lines.push(
            `| ${row.label} | ${row.units} | ${row.files} | ${row.fences} | ${row.ok} | ${row.syntaxError} | ` +
                `${row.crash} | ${row.roundTrip} | ${row.invariant} | ${row.printerChecked} | ` +
                `${row.printerReParse} | ${row.printerTree} | ${row.printerIdempotence} | ` +
                `${row.printerOracle ?? 0} | ${row.oracleChecked ?? 0} |`,
        );
    }
    lines.push('');
    lines.push(
        'The last six columns are the printer half for that source. `printed` counts units that ' +
            'were formatted and passed all four printer checks, so it is the denominator for the ' +
            'four failure columns next to it — a source where `printed` is 0 makes a `0` in a ' +
            "failure column meaningless, not reassuring. `oracle-checked` is the oracle's own " +
            'denominator, smaller than `printed` wherever `moc` rejects the input.',
    );
    if (report.fences.files > 0) {
        lines.push('');
        const other = report.fences.total - report.fences.motoko;
        lines.push(
            `Across ${report.fences.files} Markdown file(s), ${report.fences.total} fence line(s) ` +
                `were seen and ${report.fences.motoko} belong to \`motoko\`/\`mo\` blocks (opener + ` +
                `closer, so ${report.fences.motoko / 2} blocks). The other ${other} fence line(s) ` +
                `are other languages and are not checked.`,
        );
    }

    lines.push('');
    lines.push('## What was skipped, and why');
    lines.push('');
    lines.push(
        'The plan is emphatic that a skipped unit must be counted and named, never dropped ' +
            '("no silent caps"). Every unit this run did not check appears here.',
    );
    lines.push('');
    const kinds = Object.entries(report.skipsByKind).sort(
        (a, b) => b[1] - a[1],
    );
    if (kinds.length === 0) {
        lines.push('_Nothing was skipped._');
    } else {
        lines.push('| kind | count | meaning |');
        lines.push('| --- | ---: | --- |');
        const meaning = {
            'source-absent':
                'a repository the corpus names is not checked out locally (offline; the harness never clones)',
            unreadable: 'a tracked file could not be decoded as UTF-8',
            'unclosed-fence':
                'a Markdown fence opened and the document ended first (still checked as a unit)',
            'rev-unresolved':
                'a revision did not resolve to a commit in that checkout',
            'generated-corpus':
                "the grammar's generated, gitignored test corpus (present on disk, not at any revision)",
        };
        for (const [kind, count] of kinds)
            lines.push(`| ${kind} | ${count} | ${meaning[kind] ?? ''} |`);
        lines.push('');
        lines.push('<details><summary>skip detail</summary>');
        lines.push('');
        for (const skip of report.skips) {
            const where = skip.path
                ? `${skip.source}:${skip.path}${skip.line ? `#L${skip.line}` : ''}`
                : (skip.what ?? '');
            lines.push(`- \`${skip.kind}\` ${where} — ${skip.reason}`);
        }
        lines.push('');
        lines.push('</details>');
    }

    lines.push('');
    lines.push('## Failures');
    lines.push('');
    if (
        t.crash === 0 &&
        t.roundTrip === 0 &&
        t.invariant === 0 &&
        t.printerReParse === 0 &&
        t.printerTree === 0 &&
        t.printerIdempotence === 0
    ) {
        lines.push(
            '**No crashes, no round-trip mismatches, no invariant violations, and no printer ' +
                'failures.**',
        );
        lines.push('');
    }
    for (const [kind, list] of Object.entries(report.failures)) {
        if (list.length === 0) continue;
        // Whole-file unexpected syntax errors are already called out in the Headline table and in
        // the unexpected-syntax-error list below; skip the duplicate roll-up of everything.
        if (kind === 'syntax-error') continue;
        const label = {
            'unexpected-syntax-error':
                'Unexpected whole-file syntax errors (neither a negative fixture nor a documented deviation — COVERAGE REGRESSION, must be 0)',
            crash: 'Normaliser crashes (bugs in our code — must be 0)',
            'round-trip':
                'Token round-trip failures (bugs in our code — must be 0)',
            invariant: 'Invariant violations (bugs in our code — must be 0)',
            'printer-reparse':
                'Printer output that does not parse, or `format` refusing (bugs in our code — must be 0)',
            'printer-tree':
                'Printer output that means something else (`compareShapes`) (bugs in our code — must be 0)',
            'printer-idempotence':
                'Printer output that is not a fixed point (bugs in our code — must be 0)',
            'printer-oracle':
                'Printer output that moc reads as a different program (bugs in our code — must be 0; this is the strongest of the four, because it is the only one that does not answer with our own grammar)',
        }[kind];
        lines.push(`### ${label} — ${list.length}`);
        lines.push('');
        lines.push('<details><summary>list</summary>');
        lines.push('');
        for (const f of list) {
            const diff = f.firstDiff
                ? ` (first difference at line ${f.firstDiff.line}: expected \`${f.firstDiff.expected}\`, got \`${f.firstDiff.got}\`)`
                : '';
            lines.push(
                `- \`${f.path}${f.line ? `#L${f.line}` : ''}\` — ${f.message}${diff}`,
            );
        }
        lines.push('');
        lines.push('</details>');
        lines.push('');
    }

    // The syntax-error list is long and mostly fences; it goes last, behind a summary.
    const syntaxErrors = report.failures['syntax-error'];
    if (syntaxErrors.length) {
        lines.push('');
        lines.push(`### All grammar syntax errors — ${syntaxErrors.length}`);
        lines.push('');
        lines.push(
            'Kept in full so a reader can check the classification above rather than trust it. ' +
                'Fence entries dominate, and most are documentation rather than compilable code.',
        );
        lines.push('');
        lines.push('<details><summary>list</summary>');
        lines.push('');
        for (const f of syntaxErrors) {
            const where = f.line ? `${f.path}#L${f.line}` : f.path;
            lines.push(`- \`${f.source}:${where}\` — ${f.message}`);
        }
        lines.push('');
        lines.push('</details>');
    }

    lines.push('');
    lines.push('## Notes for a reviewer');
    lines.push('');
    lines.push(
        'Facts about this harness that are not visible in the numbers above.',
    );
    lines.push('');
    lines.push(
        '**The normaliser already existed.** This harness was written against `src/parser/parse.ts` ' +
            'and `src/parser/normalize.ts`, which exports `checkRoundTrip`. There is no second, ' +
            'hand-rolled round-trip implementation to drift out of step with the real one: the ' +
            'harness calls the normaliser the plugin will use.',
    );
    lines.push('');
    lines.push(
        '**Which grammar wasm.** The grammar is read from `node_modules/tree-sitter-motoko` via ' +
            '`createRequire`, not from a copy vendored under `tools/corpus/`. The hashes: this ' +
            'harness measured `35e710b0…` (368294 bytes). `src/parser/tree-sitter-motoko.wasm` is ' +
            'byte-identical to it. A *different* wasm at a checkout of the grammar (366521 bytes, ' +
            '`00cbf7d6…`) circulated as "stale"; `docs/grammar-deviations.md` reports it does not ' +
            'change a single parse over the corpus, and this harness never loads it — the risk is ' +
            'that a future run silently picks up the wrong one, so the sha256 is printed above.',
    );
    lines.push('');
    lines.push(
        '**Two `--motoko-rev` behaviours worth knowing.** The flag pins the compiler repo only; ' +
            'supporting package sets are read at their own default branch (`main`), because pushing ' +
            '`master` at them resolves nothing. And a bare `master` resolves through ' +
            '`origin/master` when no local branch by that name exists — a checkout of the ' +
            'compiler repo frequently has only the remote-tracking ref. The provenance table above ' +
            'names the ref that actually resolved, so a surprising pin is visible rather than ' +
            'silent.',
    );
    lines.push('');
    lines.push(
        "**The `test/fail` fixtures are a floor, not a ceiling.** Counting only moc's negative " +
            'fixtures would treat every other rejection as a regression, so the documented ' +
            'deviations are also listed, and the two are reported separately from fence errors. A ' +
            'whole-file rejection that is neither fails the run: this is how a grammar bump that ' +
            'quietly lost coverage gets noticed.',
    );
    lines.push('');
    lines.push(
        '**Fence errors are mostly not errors.** Of the 143 rejections, the large majority are ' +
            '`motoko` fences in prose that show an API signature (`Prim.envVar : <system>(name : ' +
            'Text) -> ?Text`) rather than a compilable unit. They are counted rather than filtered, ' +
            'because "which fences are real code" has no reliable answer; the whole-file rows in ' +
            'the decomposition table are the ones to gate on.',
    );
    lines.push('');
    lines.push(
        '**Reproduce with:** `node tools/corpus/run.mjs --job all --motoko-rev master`. Add ' +
            '`--quiet` for just the summary line, `--json <path>` to move the machine report.',
    );

    lines.push('');
    lines.push('## Provenance');
    lines.push('');
    lines.push(
        `- grammar: \`${report.grammar.package}@${report.grammar.version ?? 'unknown'}\``,
    );
    if (report.grammar.wasmSha256) {
        lines.push(`- grammar wasm sha256: \`${report.grammar.wasmSha256}\``);
    }
    if (report.grammar.info) {
        lines.push(
            `- abi: ${report.grammar.info.abiVersion}, node types: ${report.grammar.info.nodeTypeCount}`,
        );
    }
    lines.push(`- motoko rev requested: \`${report.pins.motokoRev}\``);
    lines.push(
        `- oracle rev (provenance; the AST oracle itself is a \`moc\` binary, below): \`${report.pins.oracleRev ?? '(none)'}\``,
    );
    lines.push(
        report.pins.oracleBinary
            ? `- moc AST oracle: \`${report.pins.oracleBinary.version || report.pins.oracleBinary.path}\`` +
                  ` (${report.pins.oracleBinary.kind}) at \`${report.pins.oracleBinary.path}\``
            : '- moc AST oracle: **not run** — no `moc` binary found. Set `MOC=<path>` (or build one at the ' +
                  'path `docs/grammar-deviations.md` documents) to enable the layer. Every other number ' +
                  'in this report is unaffected; the oracle column is absent, not zero.',
    );
    lines.push('');
    lines.push(
        '### Revisions actually read',
        '',
        'Each source is read through `git` at the revision below, so a dirty working tree cannot ' +
            'change the measurement. `rev` is the resolved 40-hex commit that was read; `HEAD` is ' +
            "where that checkout's own HEAD was, so a pin that is not HEAD is visible.",
        '',
    );
    lines.push(
        '| source | revision read | resolved via | checkout HEAD | slug | dir |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const s of report.sources) {
        lines.push(
            `| ${s.label} | \`${(s.rev ?? '').slice(0, 12)}\` | \`${s.ref ?? ''}\` | \`${(s.head ?? '').slice(0, 12)}\` | ${s.slug ?? ''} | \`${s.dir ?? ''}\` |`,
        );
    }
    lines.push('');
    lines.push(`Report path: \`${relative(repoRoot, opts.report)}\``);
    lines.push('');
    return lines.join('\n');
}

main().catch((error) => {
    process.stderr.write(`corpus harness: ${error?.stack ?? error}\n`);
    process.exit(1);
});
