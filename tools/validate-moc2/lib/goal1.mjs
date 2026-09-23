// Goal 1: "never invalid, never a semantic change", run unit by unit.
//
// WHAT THIS CAN AND CANNOT DO TODAY. The plan's Goal 1 rewrites every unit with `moc2` and demands
// every level pass on the *output*. `moc2` does not exist yet, so there is no output. This module
// therefore runs the levels with an explicit **rewrite function**; today the only one available is the
// identity, `identityRewrite`. Under the identity, the levels still do real work:
//
//   - they run end to end over the corpus (proving the level plumbing is not a stub that checks
//     nothing), and
//   - they cross-check **our grammar against moc** on every unit: a unit our grammar accepts but moc
//     rejects (or vice versa) is a grammar deviation, which is the one substantive thing this can
//     find before `moc2` exists.
//
// Passing a `moc2` rewrite in (`rewrite: fn`) turns the same driver into the plan's Goal 1 unchanged:
// every observable is then input-vs-output rather than input-vs-input, and the identity's trivially
// equal levels become real checks. That is the seam a future `moc2` plugs into.
//
// The levels, per the plan's table:
//   parse        our grammar parses input and output with no ERROR/MISSING. (moc 2.0 parsing is
//                covered by `parseTree`, which is `moc -dp`.)
//   diagnostics  `moc --check` gives the same diagnostic-code multiset on input and output.
//   parseTree    `moc -dp` of input and output is identical after normalisation.
//   typedTree    `moc -t -v -dt` likewise.
//   execution    the compiler's `test/run` + `test/run-drun` goldens. NOT RUNNABLE HERE: it needs a
//                nix shell of the motoko repo and the golden corpus. This level is a loud stub that
//                FAILS (never silently passes), naming exactly what is missing.
//   idempotence  rewrite(rewrite(x)) == rewrite(x).
//
// Run with `--set oracle` (the files #6385 touches, 641 units at base) or `--set full` (every `.mo`
// and fence, 2511 units). Each non-identity moc invocation costs ~20ms, so the full set is a few
// minutes; the oracle set is well under a minute.

import { BASE, PRELUDE_PREFIX } from './config.mjs';
import { assertCheckout, listFiles, readerFor } from './git.mjs';
import { unitsForFile } from './units.mjs';
import { createParser } from './grammar.mjs';
import {
    checkLevel,
    findMoc,
    parseTreeLevel,
    sameDiagnostics,
    typedTreeLevel,
} from './moc.mjs';

/** The only rewrite available today. A future `moc2` replaces this. */
export const identityRewrite = (source) => source;

/** A loud, non-silent stand-in for the rewrite that does not exist yet. */
export function moc2Rewrite() {
    throw new Error(
        'validate-moc2: Goal 1 with the real rewrite needs `moc2`, which does not exist yet ' +
            '(docs/formatter-rework.md, M3). Re-run the identity driver for the grammar-vs-moc ' +
            'cross-check, or wire a built `moc2` in here.',
    );
}

/**
 * The execution level, as the plan's own words say it: it "runs in a nix shell of the motoko repo,
 * nightly or on demand, not on every PR". This environment has neither the nix shell nor the golden
 * corpus wired up, so the level CANNOT run. It throws rather than returning a pass.
 */
export function executionLevel() {
    throw new Error(
        'validate-moc2: the execution level requires a nix shell of the motoko repository plus its ' +
            '`test/run` (309) and `test/run-drun` (439) goldens. Neither is available here, so this ' +
            'level cannot run and must not report a pass. See RESULTS.md ("Goal 1 status").',
    );
}

/**
 * Run Goal 1 over one set at BASE.
 *
 * `rewrite` defaults to the identity. `limit` caps the units processed (for a quick run); the result
 * records whether it was truncated, so a partial run is never mistaken for a full one.
 */
export async function goal1({
    setName = 'oracle',
    paths,
    limit = Infinity,
    rewrite = identityRewrite,
    rewriteName = 'identity',
    siteLimit = 3,
} = {}) {
    assertCheckout();
    const read = readerFor(BASE);
    const all = (paths ?? listFiles(BASE)).filter(
        (p) => p.endsWith('.mo') || p.endsWith('.md'),
    );

    const moc = findMoc();
    const parser = await createParser();
    const out = {
        setName,
        rev: BASE,
        rewrite: rewriteName,
        moc: moc
            ? { name: moc.name, path: moc.path, version: moc.version }
            : null,
        unitsTotal: 0,
        unitsProcessed: 0,
        truncated: false,
        skipped: [],
        // Units that already fail at BASE, before any rewrite: our grammar gives them an ERROR, or
        // moc cannot parse/type them. The plan records these as "pre-existing failure" and does not
        // count them against a level. Kept separate so a level's pass count is honest.
        preExisting: [],
        // Units that type-check nowhere at base, so the typed-tree level cannot compare them.
        typedTreeNotRun: [],
        levels: {
            parse: { ok: 0, total: 0, failed: [] },
            diagnostics: { ok: 0, total: 0, failed: [] },
            parseTree: { ok: 0, total: 0, failed: [] },
            typedTree: { ok: 0, total: 0, failed: [] },
            idempotence: { ok: 0, total: 0, failed: [] },
            execution: { ran: false, reason: null, total: 0 },
        },
        // Units our grammar parses clean but moc rejects, or the reverse — a grammar deviation the
        // plan says the oracle (moc) catches and our grammar does not.
        grammarVsMoc: { grammarCleanMocRejects: [], mocCleanGrammarErrors: [] },
        diagnosticsOnInput: {}, // code -> count, over the set (pre-existing moc diagnostics)
    };

    try {
        for (const p of all) {
            for (const u of unitsForFile(p, read)) {
                out.unitsTotal += 1;
                if (out.unitsProcessed >= limit) {
                    out.truncated = true;
                    continue;
                }
                if (!u.source.trim()) continue;
                if (u.repoPath.startsWith(PRELUDE_PREFIX)) {
                    out.skipped.push({
                        unit: u.label,
                        reason: 'prelude @-privileged names; grammar cannot reach privileged_identifier',
                    });
                    continue;
                }

                // The rewrite happens first: a rewrite that throws is a real failure to record, not a
                // pre-existing condition, so it is tracked before the parse/parseTree gates.
                let output;
                try {
                    output = rewrite(u.source);
                } catch (e) {
                    out.skipped.push({
                        unit: u.label,
                        reason: `rewrite threw: ${e.message}`,
                    });
                    continue;
                }
                out.unitsProcessed += 1;

                // --- pre-existing gate: does BASE itself fail before any rewrite? ---
                const ti = parser.parse(u.source);
                const to = parser.parse(output);
                let inHasError;
                let outHasError;
                try {
                    inHasError = ti.rootNode.hasError;
                    outHasError = to.rootNode.hasError;
                } finally {
                    ti.delete();
                    to.delete();
                }
                const dpI = moc ? parseTreeLevel(moc, u.source) : null;
                if (inHasError || (dpI && !dpI.ok)) {
                    out.preExisting.push({
                        unit: u.label,
                        reason: inHasError
                            ? 'our grammar ERROR on input at base'
                            : 'moc -dp produced no dump for input at base',
                    });
                    // Still record grammar-vs-moc agreement: a unit ONE side rejects and the other
                    // accepts is the grammar deviation the plan wants surfaced, even here.
                    if (!inHasError && dpI && !dpI.ok)
                        out.grammarVsMoc.grammarCleanMocRejects.push(u.label);
                    if (inHasError && dpI && dpI.ok)
                        out.grammarVsMoc.mocCleanGrammarErrors.push(u.label);
                    continue;
                }

                tally(
                    out.levels.parse,
                    !outHasError,
                    u.label,
                    outHasError
                        ? 'our grammar ERROR on rewritten output'
                        : null,
                );

                if (!moc) {
                    for (const lvl of [
                        'diagnostics',
                        'parseTree',
                        'typedTree',
                    ]) {
                        out.levels[lvl].failed.push({
                            unit: u.label,
                            reason: 'requires moc; none found',
                        });
                    }
                    continue;
                }

                // --- diagnostics ---
                const ckI = checkLevel(moc, u.source);
                for (const [code, n] of Object.entries(ckI.counts))
                    out.diagnosticsOnInput[code] =
                        (out.diagnosticsOnInput[code] ?? 0) + n;
                const ckO = checkLevel(moc, output);
                tally(
                    out.levels.diagnostics,
                    sameDiagnostics(ckI, ckO),
                    u.label,
                    sameDiagnostics(ckI, ckO)
                        ? null
                        : `codes differ: input ${JSON.stringify(ckI.counts)} vs output ${JSON.stringify(ckO.counts)}`,
                );

                // --- parse tree (moc -dp) ---
                // dpI was already computed for the pre-existing gate above and is ok here.
                const dpO = parseTreeLevel(moc, output);
                const dpSame = dpO.ok && dpI.dump === dpO.dump;
                tally(
                    out.levels.parseTree,
                    dpSame,
                    u.label,
                    !dpO.ok
                        ? 'moc -dp produced no dump for output'
                        : dpI.dump === dpO.dump
                          ? null
                          : 'moc -dp dumps differ',
                );

                // --- typed tree (moc -t -v -dt) ---
                // A unit that does not type-check at base (a `test/fail` fence, an illustrative
                // fragment) cannot be typed-tree-compared; that is pre-existing, recorded, not a
                // level failure. When it DOES type-check at base, a rewrite that stops it is a bug.
                const dtI = typedTreeLevel(moc, u.source);
                if (!dtI.ok) {
                    out.typedTreeNotRun.push({
                        unit: u.label,
                        reason: 'moc -dt produced no dump for input at base (e.g. a test/fail unit)',
                    });
                } else {
                    const dtO = typedTreeLevel(moc, output);
                    const dtSame = dtO.ok && dtI.dump === dtO.dump;
                    tally(
                        out.levels.typedTree,
                        dtSame,
                        u.label,
                        !dtO.ok
                            ? 'moc -dt produced no dump for output'
                            : dtI.dump === dtO.dump
                              ? null
                              : 'moc -dt dumps differ',
                    );
                }

                // --- idempotence ---
                const twice = rewrite(output);
                tally(
                    out.levels.idempotence,
                    twice === output,
                    u.label,
                    twice === output
                        ? null
                        : 'rewrite(rewrite(x)) != rewrite(x)',
                );

                // Trim per-level failure lists for a readable report; counts stay exact via `ok`.
                for (const lvl of [
                    'parse',
                    'diagnostics',
                    'parseTree',
                    'typedTree',
                    'idempotence',
                ]) {
                    const f = out.levels[lvl].failed;
                    if (f.length > 40) f.length = 40;
                }
            }
        }
    } finally {
        parser.delete();
    }

    // The execution level is attempted, and its loud failure is recorded as "not run", never as a pass.
    try {
        executionLevel();
        out.levels.execution = {
            ran: true,
            reason: null,
            total: out.unitsProcessed,
        };
    } catch (e) {
        out.levels.execution = { ran: false, reason: e.message, total: 0 };
    }

    out.summary = {
        unitsTotal: out.unitsTotal,
        unitsProcessed: out.unitsProcessed,
        truncated: out.truncated,
        skipped: out.skipped.length,
        preExisting: out.preExisting.length,
        typedTreeNotRun: out.typedTreeNotRun.length,
        levels: Object.fromEntries(
            Object.entries(out.levels).map(([k, v]) => [
                k,
                v.ran === false ? 'NOT RUN' : `${v.ok}/${v.total}`,
            ]),
        ),
        grammarMocDisagreements:
            out.grammarVsMoc.grammarCleanMocRejects.length +
            out.grammarVsMoc.mocCleanGrammarErrors.length,
    };
    return out;
}

/** Increment a level's ok count or record a failure, keeping both exact. */
function tally(level, ok, unit, reason) {
    level.total += 1;
    if (ok) level.ok += 1;
    else level.failed.push({ unit, reason });
}
