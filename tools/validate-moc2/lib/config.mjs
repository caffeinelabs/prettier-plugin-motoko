// Shared configuration for the moc2 validation harness.
//
// Everything the harness needs to know about *where* it runs is here, so no other module hard-codes
// a path. Two things are deliberately environment-driven:
//
//   - MOTOKO_REPO points at a checkout of caffeinelabs/motoko. It defaults to `../motoko`, the same
//     sibling convention the corpus CI job uses (see AGENTS.md and tests/corpus.test.ts), so the
//     harness runs with no flags in the layouts this repo already sets up.
//   - MOC / MOC_SOURCE point at a moc 2.0 binary. `MOC` is the released beta (the plan calls for the
//     pinned beta, "both the pinned beta release and moc.js built from master"); `MOC_SOURCE` is a
//     moc built *from the pinned head revision*, which is the stronger oracle because it is exactly
//     the frontend #6385 was validated against. Either may be absent; the moc-backed levels then
//     FAIL LOUDLY ("requires moc") rather than passing silently, which is the plan's rule.
//
// Nothing here fetches or clones. Re-pinning is an explicit edit of BASE/HEAD below, per the plan
// ("adopted by re-pinning on purpose, never by following a branch").

/** Merge base of caffeinelabs/motoko#6385, verified to exist in the pinned checkout. */
export const BASE = '441dd70cd1ab935d0edbb6691fc5a20e6667c13f';

/** Head of caffeinelabs/motoko#6385. */
export const HEAD = '1d57a4fc7b0f2a28a43cd2fcdc7d0820c21e0986';

/**
 * Path to the motoko checkout. `MOTOKO_REPO` wins; otherwise `../motoko` relative to this repo root.
 *
 * We run git through `execFileSync('git', ['-C', MOTOKO_REPO, ...])` rather than importing isogit or
 * similar: the harness must work offline and must not gain a dependency, and the checkout is local.
 */
export const MOTOKO_REPO =
    process.env.MOTOKO_REPO ??
    new URL('../../../../motoko', import.meta.url).pathname;

/**
 * The oracle set: exactly the files #6385 touched, per the plan's globs.
 *
 * NOTE (recorded because it is a spec discrepancy, not a choice): the real #6385 diff also touches
 * `doc/chat.mo` and `doc/schat.mo`, which no glob here covers. The plan names the globs explicitly,
 * so we honour them and report the two out-of-scope files in RESULTS.md rather than silently
 * widening the set. `doc/schat.mo` also fails to parse under the 0.2.0 grammar, which the plan
 * predicts ("Units that don't parse on base are recorded as pre-existing failure").
 */
export const ORACLE_GLOBS = [
    /^doc\/md\//,
    /^doc\/overview-slides\.md$/,
    /^samples\//,
    /^src\/prelude\//,
];

/** True if a repo-relative path belongs to the oracle set. */
export function inOracleSet(repoPath) {
    return ORACLE_GLOBS.some((re) => re.test(repoPath));
}

/**
 * Files the harness treats as out of scope even though they are `.mo`, matching the plan: the prelude
 * uses `@`-privileged names the grammar cannot reach (`privileged_identifier`), so its units are
 * counted as skipped-with-reason, never as failures. Reported, not dropped.
 */
export const PRELUDE_PREFIX = 'src/prelude/';

/**
 * Locate moc binaries. Returns a list of `{ name, path, kind }`; `kind` is 'release' for the beta and
 * 'source' for a build of the pinned head. Missing entries are simply absent — callers must decide
 * whether absence is fatal (moc-backed levels) or fine (tree-only levels).
 */
export function mocCandidates() {
    const out = [];
    const release = process.env.MOC ?? '/tmp/mocnow/moc';
    const source =
        process.env.MOC_SOURCE ?? `${MOTOKO_REPO}/_build/default/exes/moc.exe`;
    out.push({ name: 'moc (release beta)', path: release, kind: 'release' });
    out.push({
        name: 'moc (built from pinned head)',
        path: source,
        kind: 'source',
    });
    return out;
}
