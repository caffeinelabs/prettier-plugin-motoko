/**
 * The moc AST oracle, shared by the corpus harness and (later) the moc2 validation levels.
 *
 * WHY THIS LIVES IN `tools/corpus/lib/` AND NOT IN `tools/validate-moc2/lib/`. Both harnesses need
 * the same thing: run moc on a unit, get a normalised parse tree, and decide whether two trees are
 * the same tree. `tools/validate-moc2/lib/moc.mjs` already does this well, and this module is
 * deliberately the same design (same banner stripping, same temp-path rewriting) rather than a
 * second implementation, so the two harnesses cannot drift into disagreeing about what moc said.
 * The difference is what each layer then does with the dump; that stays in each harness.
 *
 * WHY IT MATTERS AT ALL: the runtime guard in `src/verify.ts` re-parses printed output with OUR
 * grammar, so it is structurally blind wherever our grammar's reading differs from moc's -- and
 * `docs/grammar-deviations.md` is a catalogue of exactly those places. The oracle closes that hole
 * by asking moc instead. A zero from the guard and a zero from the oracle are different claims.
 *
 * The parse observable is `moc -dp`, NOT `moc --check`:
 *   - `--check` also runs the type checker, so a stub file with an unresolved import is rejected for
 *     reasons that have nothing to do with syntax. Using it as a syntax signal made 688 stub files
 *     look like parser failures during M2.
 *   - `--check` prints `MOC_RELEASE_RTS not set` on a non-nix build and exits 1 even on clean input,
 *     so its status is not a usable success flag.
 * `-dp` prints the parse tree and nothing else, which is the question being asked.
 *
 * Normalisation, and why it is exactly this much:
 *   - `--`-prefixed phase banners and the absolute temp path are stripped (they vary per run and per
 *     machine -- same treatment as validate-moc2).
 *   - Anonymous names (`@anon-func-12.34`, `@anon-async*-5.7`, `@anon-val-3.9`, `@anon-class-...`)
 *     carry BOTH a counter and a source column, and both move when layout moves. The plan says the
 *     normalisation is "anonymous-function names carrying source positions are normalised
 *     everywhere". They are mapped to `@anon-<kind>#<ordinal>` by first appearance, which preserves
 *     order -- so a printer that reordered two anonymous functions still fails -- while removing
 *     counter and column noise. Mapping them to a bare kind instead would hide such a reordering.
 *   - Whitespace is removed for the COMPARISON ONLY. `moc -dp` is a pretty-printer that wraps long
 *     nodes at a width, and a differing anonymous name's length moves the wrap point, so whitespace
 *     can differ between two identical trees. The dump's whitespace is not tree content. The
 *     space-collapsed form is kept for the human-readable diff.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where a moc binary might be. `MOC` wins; the rest are the layouts this repo sets up. */
export function mocCandidates(motokoDir) {
    const out = [];
    if (process.env.MOC) out.push({ path: process.env.MOC, kind: 'env' });
    // A build of the pinned #6385 head. docs/grammar-deviations.md documents building one here.
    out.push({
        path: '/tmp/moc6385/src/_build/default/exes/moc.exe',
        kind: 'source-6385',
    });
    if (motokoDir) {
        out.push({
            path: join(motokoDir, '_build', 'default', 'exes', 'moc.exe'),
            kind: 'source-motoko',
        });
    }
    out.push({ path: '/tmp/mocnow/moc', kind: 'release' });
    return out;
}

function isRunnable(path) {
    const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
    return !r.error && r.status !== null;
}

/**
 * The first runnable moc, or null. Never throws: the oracle is an OPTIONAL layer, and a corpus run
 * without moc must still produce its other numbers rather than dying. Callers report the absence.
 */
export function findMoc(motokoDir) {
    for (const cand of mocCandidates(motokoDir)) {
        if (!isRunnable(cand.path)) continue;
        const v = spawnSync(cand.path, ['--version'], { encoding: 'utf8' });
        return { ...cand, version: (v.stdout || '').trim() };
    }
    return null;
}

/**
 * Strip phase banners, the temp path, and the nix-shell RTS warning, so two runs are comparable.
 * Identical in effect to `tools/validate-moc2/lib/moc.mjs`'s `normaliseMocOutput`.
 */
export function normaliseMocOutput(text, tmpPath) {
    return text
        .split('\n')
        .filter((l) => !l.startsWith('--'))
        .filter(
            (l) =>
                !l.startsWith('Environment variable MOC_RELEASE_RTS not set'),
        )
        .map((l) => (tmpPath ? l.split(tmpPath).join('<unit>') : l))
        .join('\n')
        .trim();
}

/**
 * Anonymous names are per-process counters plus a source column. Map every distinct one to
 * `@anon-<kind>#<ordinal>` by first appearance, so order survives and position does not.
 *
 * The kind character class includes `*` because moc emits `@anon-async*` for `async*` blocks.
 */
export function normaliseAnonNames(text) {
    const seen = new Map();
    const counters = new Map();
    return text.replace(/@anon-([a-z*]+)-[\d.]+/g, (whole, kind) => {
        let mapped = seen.get(whole);
        if (mapped === undefined) {
            const n = (counters.get(kind) ?? 0) + 1;
            counters.set(kind, n);
            mapped = `@anon-${kind}#${n}`;
            seen.set(whole, mapped);
        }
        return mapped;
    });
}

/** The comparison key: identity of the tree, indifferent to the dump's own line wrapping. */
export const oracleKey = (s) => (s ?? '').replace(/\s+/g, '');

/** The human-readable form, for a diff that a person has to read. */
export const oracleLegible = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** A scratch dir per process, so a whole corpus run writes its units in one place. */
let scratchDir = null;
function scratch() {
    if (!scratchDir) scratchDir = mkdtempSync(join(tmpdir(), 'corpus-oracle-'));
    return scratchDir;
}

/**
 * `moc -dp` on `source`. Returns the normalised, space-collapsed dump, or null when moc produced no
 * dump at all (a syntax error, which is moc's business and not the printer's).
 *
 * Names are NOT normalised here -- `parseTree` returns the legible form with positions intact, and
 * `oracleKey`/`oracleLegible` normalise. Splitting it that way keeps the raw dump inspectable when a
 * mismatch has to be debugged by hand.
 */
export function parseTree(moc, source, tag = 'unit') {
    const file = join(scratch(), `${tag}.mo`);
    writeFileSync(file, source.endsWith('\n') ? source : `${source}\n`);
    const r = spawnSync(moc.path, ['-dp', file], { encoding: 'utf8' });
    const dump = normaliseMocOutput(r.stdout ?? '', file);
    return dump.length > 0 ? normaliseAnonNames(dump) : null;
}

/**
 * Are two `-dp` dumps the same tree?
 *
 * The whole normalisation, in one place so no caller can forget a step: collapse whitespace, drop
 * the anonymous-name counters and columns. Everything else is compared exactly.
 */
export function sameTree(a, b) {
    if (a === null || b === null) return a === b;
    return oracleKey(oracleLegible(a)) === oracleKey(oracleLegible(b));
}
