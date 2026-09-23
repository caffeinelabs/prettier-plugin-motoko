// The moc side: run the compiler on a unit and extract the three observables the plan names.
//
// WHY THIS IS RUNNABLE HERE, CONTRARY TO THE TASK BRIEF. The task brief states there is no moc binary
// and the moc-backed levels cannot run. That is false in this environment, and the harness must not
// pretend otherwise: two working binaries exist and were verified before this module was written.
//
//   - `<repo>/../motoko/_build/default/exes/moc.exe` — built from the *pinned head* revision
//     (`1d57a4fc`, reported as `1.16.1-26-g1d57a4fc7b`). This is the stronger oracle: exactly the
//     frontend #6385 was validated against. `MOC_SOURCE` overrides the path.
//   - `/tmp/mocnow/moc` — the released 2.0.0-beta.1. `MOC` overrides the path.
//
// So the levels are implemented to RUN when a binary is present, and to FAIL LOUDLY ("requires moc")
// when none is. That satisfies both the plan (stubs that fail loudly, never silently pass) and the
// truth of this environment (they can and do run for the source build).
//
// The observables:
//   - diagnostics: `moc --check` stderr; we reduce to a multiset of error codes (M0141, M0062, ...).
//   - parse tree:  `moc -dp` stdout.
//   - typed tree:  `moc -t -v -dt` stdout. Plain `-dt` prints nothing: pipeline.ml gates the dump on
//                  `!Flags.trace && !Flags.verbose`, so `-t -v` is required for a non-empty dump.
//
// Normalisation: moc prints `--`-prefixed phase banners and absolute paths. Both are unstable across
// runs and machines, so every comparison strips `^--` lines and rewrites the temp-file path to a
// fixed token before diffing. Nothing else is forgiven here; the plan's wider ParP/BlockE
// normalisation belongs to the rewrite's edit log, which does not exist yet.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mocCandidates } from './config.mjs';

/** Does this path exist and look executable? `spawnSync` with ENOENT tells us. */
function isRunnable(path) {
    const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
    return !r.error && r.status !== null;
}

/**
 * The moc binary to use, or null. Prefers the source build of the pinned head (the stronger oracle),
 * then the release beta. Returns `{ name, path, kind, version }`.
 */
export function findMoc() {
    for (const cand of mocCandidates()) {
        if (!isRunnable(cand.path)) continue;
        const v = spawnSync(cand.path, ['--version'], { encoding: 'utf8' });
        return { ...cand, version: (v.stdout || '').trim() };
    }
    return null;
}

/**
 * Throw a loud, clearly-worded error naming what is missing. Called by any moc-backed level that is
 * asked to run without a binary, so a level never passes by doing nothing.
 */
export function requireMoc(level) {
    const moc = findMoc();
    if (!moc) {
        throw new Error(
            `validate-moc2: level "${level}" requires moc and none was found. ` +
                `Set MOC=/path/to/moc (release beta) or MOC_SOURCE=/path/to/moc.exe ` +
                `(build from the pinned head). Tried: ` +
                mocCandidates()
                    .map((c) => c.path)
                    .join(', '),
        );
    }
    return moc;
}

/**
 * Strip phase banners, the temp path, and the nix-shell RTS warning from moc output, so two runs are
 * comparable.
 *
 * The "MOC_RELEASE_RTS not set" line is emitted by a moc built outside the nix-shell wrapper on every
 * run, including successful ones, and it makes `spawnSync().status` 1 even when the dump was produced.
 * It carries no diagnostic code and no tree content, so it is removed here and never treated as a
 * failure signal; callers judge success by whether they got the output they asked for.
 */
function normaliseMocOutput(text, tmpPath) {
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

/** Extract the multiset of diagnostic codes (`M0141`, `M0062`, `M0274`, ...) from moc stderr. */
export function diagnosticCodes(stderr) {
    const codes = stderr.match(/\bM\d{4}\b/g) ?? [];
    const counts = {};
    for (const c of codes) counts[c] = (counts[c] ?? 0) + 1;
    return { codes, counts };
}

/** A scratch dir per process, for writing units as `.mo` files moc can read. */
let scratchDir = null;
function scratch() {
    if (!scratchDir) scratchDir = mkdtempSync(join(tmpdir(), 'validate-moc2-'));
    return scratchDir;
}

/**
 * Run one moc invocation on `source`. Returns `{ status, stdout, stderr, file }`.
 *
 * `extraFlags` are inserted before the file path (`-dp`, `--check`, `-t -v -dt`). No `moc` flags are
 * invented here; each caller names the exact invocation the plan specifies.
 */
export function runMoc(moc, source, extraFlags, tag = 'unit') {
    const file = join(scratch(), `${tag}.mo`);
    writeFileSync(file, source.endsWith('\n') ? source : `${source}\n`);
    const r = spawnSync(moc.path, [...extraFlags, file], { encoding: 'utf8' });
    return {
        status: r.status,
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
        file,
    };
}

/**
 * `moc --check`: the diagnostics level. Returns `{ ok, codes, counts, raw }`.
 *
 * `ok` means "no diagnostic codes at all" — not `status === 0`. A moc built outside the nix-shell
 * wrapper exits 1 on the RTS warning even for clean input, so `status` is not a usable success flag
 * here; the diagnostic multiset is (see `normaliseMocOutput`).
 */
export function checkLevel(moc, source) {
    const r = runMoc(moc, source, ['--check'], 'check');
    const { codes, counts } = diagnosticCodes(r.stderr);
    return {
        ok: codes.length === 0,
        codes,
        counts,
        raw: normaliseMocOutput(r.stderr, r.file),
    };
}

/** `moc -dp`: the parse-tree level. Returns `{ ok, dump }`. `ok` means a dump was produced. */
export function parseTreeLevel(moc, source) {
    const r = runMoc(moc, source, ['-dp'], 'dp');
    const dump = normaliseMocOutput(r.stdout, r.file);
    return { ok: dump.length > 0, dump };
}

/** `moc -t -v -dt`: the typed-tree level. Returns `{ ok, dump }`. */
export function typedTreeLevel(moc, source) {
    const r = runMoc(moc, source, ['-t', '-v', '-dt'], 'dt');
    const dump = normaliseMocOutput(r.stdout, r.file);
    return { ok: dump.length > 0, dump };
}

/** Do two diagnostic-code multisets agree exactly? */
export function sameDiagnostics(a, b) {
    const keys = new Set([...Object.keys(a.counts), ...Object.keys(b.counts)]);
    for (const k of keys)
        if ((a.counts[k] ?? 0) !== (b.counts[k] ?? 0)) return false;
    return true;
}

/** Does the environment have a usable moc right now? For the report header, never throws. */
export function mocAvailability() {
    try {
        const moc = findMoc();
        if (!moc)
            return {
                available: false,
                candidates: mocCandidates().map((c) => c.path),
            };
        return { available: true, ...moc };
    } catch (e) {
        return { available: false, error: String(e) };
    }
}
