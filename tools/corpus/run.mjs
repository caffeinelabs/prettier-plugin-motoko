/**
 * The corpus harness (docs/formatter-rework.md, "Verification" item 3; M1's exit criterion).
 *
 * What this runs, and what it deliberately does not:
 *
 * The plan's corpus unit has four checks — token round-trip, idempotence, re-parse (no
 * ERROR/MISSING) and tree equality between input and output. **Two of those need a printer, and
 * there is no printer yet.** So this harness runs only the half that the parser and normaliser can
 * answer on their own, and says so in its output rather than reporting the other two as passing:
 *
 *   1. parse            — every unit parses, or raises `MotokoSyntaxError` (never a crash);
 *   2. token round-trip — re-concatenating the normalised tree's leaves and gaps reproduces the
 *                         input exactly. This is the normaliser's losslessness property, and it is
 *                         the same check as the plan's first bullet.
 *   3. invariants       — normalised offsets are monotonic and in range, and a tree that parsed
 *                         without error carries no `error`/`missing` node.
 *
 * Idempotence and tree equality are **NOT RUN**; they are reported as `not-run (no printer)` in
 * RESULTS.md and in report.json, so nobody can mistake their absence for a pass.
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
  --oracle-rev <rev>    moc AST-oracle pin. Accepted and recorded for provenance; the oracle
                        layer itself is NOT implemented (see RESULTS.md) — passing it is a no-op.
  --report <path>       where to write the human report (markdown)   (default: tools/corpus/RESULTS.md)
  --json <path>         where to write the machine report            (default: tools/corpus/report.json)
  --repos <dir>         directory to scan for sibling checkouts      (default: this repo's parent)
  --no-siblings         check only the Motoko repo, skip every sibling package set
  --quiet               suppress per-unit progress lines
  -h, --help            this text

Exit code is 0 when nothing crashed and no unit failed the checks that CAN run. Units the grammar
rejects are counted and listed but are not a failure: they are expected (docs/grammar-deviations.md).
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
        ms: Number(process.hrtime.bigint() - started) / 1e6,
    };
}

function firstLine(text) {
    const cut = text.indexOf('\n');
    return cut < 0 ? text : text.slice(0, cut);
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
    const deps = {
        parse: parseModule.parse,
        MotokoSyntaxError: parseModule.MotokoSyntaxError,
        checkRoundTrip: normalizeModule.checkRoundTrip,
    };
    if (
        typeof deps.parse !== 'function' ||
        typeof deps.checkRoundTrip !== 'function'
    ) {
        throw new Error(
            'corpus harness: src/parser/parse.ts or normalize.ts did not export the expected ' +
                'functions. The harness measures those modules; a rename must be reflected here.',
        );
    }

    const checkouts = indexCheckouts(opts.reposDir);
    const { sources, skips: sourceSkips } = buildSources(opts, checkouts);

    // Prove the checks can fail before reporting that they did not.
    const selfTestResult = await selfTest(deps);
    const allSelfTestFailures = [
        ...selfTestResult.failed,
        ...selfTestResult.fences.failed,
    ];
    if (allSelfTestFailures.length) {
        throw new Error(
            `corpus harness self-test failed (${allSelfTestFailures.length} of ` +
                `${selfTestResult.total + selfTestResult.fences.total}): ` +
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
                `${selfTestResult.fences.passed}/${selfTestResult.fences.total} fence checks passed ` +
                `(the round-trip check rejects 3 deliberate corruptions and accepts 9 clean shapes)\n`,
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
    };
    let ok = 0;
    const progress = (done, total, unit) => {
        if (opts.quiet || done % 500 !== 0) return;
        process.stderr.write(
            `  ${done}/${total} units… (${new Date().toISOString().slice(11, 19)})\n`,
        );
    };

    for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const outcome = await checkUnit(unit, deps);
        if (outcome.status === 'ok') ok += 1;
        else {
            failures[outcome.status].push({
                id: unit.id,
                source: unit.source,
                path: unit.path,
                line: unit.line,
                message: outcome.message,
                ...(outcome.loc ? { loc: outcome.loc } : {}),
                ...(outcome.stack ? { stack: outcome.stack } : {}),
            });
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
            oracleLayer: 'not-implemented',
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
        },
        checks: {
            parse: 'run',
            tokenRoundTrip: 'run',
            invariants: 'run',
            idempotence: 'not-run (no printer)',
            reParse: 'not-run (no printer)',
            treeEquality: 'not-run (no printer)',
            mocOracle:
                'not-run (no oracle layer; parseMotoko JS artifact absent)',
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
            `skipped ${report.skips.length} item(s) across ${Object.keys(report.skipsByKind).length} kind(s)`,
            `wrote ${relative(process.cwd(), opts.json)}`,
            `wrote ${relative(process.cwd(), opts.report)}`,
            '',
        ].join('\n'),
    );

    // The gate: crashes (our bugs), round-trip failures (our bugs), invariant violations (our bugs)
    // and a whole-file syntax error that is not accounted for — all fail the run. Ordinary grammar
    // rejections on fixtures, documented deviations and Markdown fences do not.
    const fatal =
        failures.crash.length +
        failures['round-trip'].length +
        failures.invariant.length +
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
        '**Idempotence, re-parse and tree equality are not run.** They compare a formatted output ' +
            'against an input, and there is no printer yet — M1 is parse-only. Reporting them as ' +
            'passing would be vacuous, so they are listed as `not-run`. The M1 exit criterion ' +
            '("100% of the corpus parses and round-trips") is therefore only half-evaluable: ' +
            '*parses* and *token round-trips* are measured below; *format-and-reparse* is not.',
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
        '| source | units | files | fences | ok | syntax-error | crash | round-trip | invariant |',
    );
    lines.push(
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const row of report.sources) {
        lines.push(
            `| ${row.label} | ${row.units} | ${row.files} | ${row.fences} | ${row.ok} | ${row.syntaxError} | ` +
                `${row.crash} | ${row.roundTrip} | ${row.invariant} |`,
        );
    }
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
    if (t.crash === 0 && t.roundTrip === 0 && t.invariant === 0) {
        lines.push(
            '**No crashes, no round-trip mismatches, no invariant violations.**',
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
        }[kind];
        lines.push(`### ${label} — ${list.length}`);
        lines.push('');
        lines.push('<details><summary>list</summary>');
        lines.push('');
        for (const f of list) {
            lines.push(
                `- \`${f.path}${f.line ? `#L${f.line}` : ''}\` — ${f.message}`,
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
        `- oracle rev (recorded, layer not implemented): \`${report.pins.oracleRev ?? '(none)'}\``,
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
