// The census: build the unit list for a set, parse each unit, count units and residue.
//
// Two sets, per the plan:
//   - ORACLE: the files #6385 touches (globs in config.mjs), read at BASE.
//   - FULL: every .mo and fence in the repo at BASE, including test/**.
//
// The census also enforces the plan's anti-regression rule: **expected unit counts per file**, and a
// failure when a count drops. The expectations live in `expected-counts.mjs` and are checked as
// "observed >= expected" per file, because a fence regex or extractor that regresses can only ever
// lose units, never invent them. A file present in the expectations but absent from the tree is a
// hard failure too — that is how a renamed/blanked file is caught.
//
// Parsing uses the raw grammar, so a unit that does not parse is recorded, with its ERROR span, and
// excluded from the residue totals (its counts would be meaningless), exactly as the plan says
// ("Units that don't parse on base are recorded as pre-existing failure"). It is never dropped
// silently: every such unit is listed in the run report.

import { BASE, PRELUDE_PREFIX } from './config.mjs';
import { assertCheckout, listFiles, readerFor } from './git.mjs';
import { unitsForFile, proveFenceRegex } from './units.mjs';
import { createParser, grammarInfo } from './grammar.mjs';
import { addCounts, groupCounts, scanTree, zeroCounts } from './residue.mjs';

/** Build the `{ path -> units[] }` map for a set of paths at a revision. */
export function collectUnits(paths, read) {
    const byFile = new Map();
    for (const p of paths) {
        byFile.set(p, unitsForFile(p, read));
    }
    return byFile;
}

/**
 * Run the census. `setName` is 'oracle' or 'full'. Returns a plain object with everything the report
 * needs: per-file unit counts, parse status, residue totals, and the skip/unparseable lists.
 */
export async function census({ setName, paths, rev = BASE }) {
    assertCheckout();
    const read = readerFor(rev);
    const byFile = collectUnits(paths, read);

    const parser = await createParser();
    const perFile = {};
    let totals = zeroCounts();
    const allSites = [];
    const unparsed = [];
    const skipped = [];
    let unitsTotal = 0;
    let unitsParsed = 0;
    let unitsEmpty = 0;

    try {
        for (const [file, units] of byFile) {
            const rec = {
                units: units.length,
                parsed: 0,
                unparsed: 0,
                empty: 0,
                fences: units.filter((u) => u.kind === 'fence').length,
                residue: zeroCounts(),
            };
            for (const u of units) {
                unitsTotal += 1;
                if (!u.source.trim()) {
                    unitsEmpty += 1;
                    rec.empty += 1;
                    continue;
                }
                // The prelude is counted but not scanned: the grammar cannot reach
                // `privileged_identifier`, so its trees are unreliable. Recorded with a reason.
                if (u.repoPath.startsWith(PRELUDE_PREFIX)) {
                    skipped.push({
                        unit: u.label,
                        reason: 'prelude uses @-privileged names; grammar cannot reach privileged_identifier',
                    });
                    continue;
                }
                const tree = parser.parse(u.source);
                try {
                    if (tree.rootNode.hasError) {
                        rec.unparsed += 1;
                        unparsed.push({
                            unit: u.label,
                            reason: 'grammar ERROR on base',
                        });
                        continue;
                    }
                    rec.parsed += 1;
                    unitsParsed += 1;
                    const { counts, sites } = scanTree(tree, u.source);
                    rec.residue = addCounts(rec.residue, counts);
                    for (const s of sites)
                        allSites.push({ unit: u.label, ...s });
                } finally {
                    tree.delete();
                }
            }
            totals = addCounts(totals, rec.residue);
            perFile[file] = rec;
        }
    } finally {
        parser.delete();
    }

    return {
        setName,
        rev,
        grammar: await grammarInfo(),
        files: perFile,
        fileCount: byFile.size,
        unitsTotal,
        unitsParsed,
        unitsEmpty,
        unparsed,
        skipped,
        residue: totals,
        grouped: groupCounts(totals),
        sites: allSites,
    };
}

/**
 * Check the anti-regression expectations. `expected` maps a repo path to a minimum unit count.
 *
 * Returns `{ ok, drops, missing }`; the caller decides how to surface them. A drop is
 * `observed < expected`; a missing file is one the expectations name but the set does not contain.
 */
export function checkExpected(censusResult, expected) {
    const drops = [];
    const missing = [];
    for (const [file, want] of Object.entries(expected)) {
        const got = censusResult.files[file];
        if (!got) {
            missing.push({ file, expected: want });
            continue;
        }
        if (got.units < want)
            drops.push({ file, expected: want, observed: got.units });
    }
    return { ok: drops.length === 0 && missing.length === 0, drops, missing };
}

/**
 * Check the fence-regex trap, rather than only describing it: for each Markdown file, extract fences
 * with the column-0-anchored regex and with the real one, and compare motoko-fence counts.
 *
 * Returns `{ files, anchoredTotal, unanchoredTotal, motokoAnchoredTotal, motokoUnanchoredTotal,
 * gainers, ok }`. `gainers` are files where the column-0-anchored regex finds **fewer** motoko fences
 * than the real one — the style-guide.md failure mode. `ok` means **at least one gainer exists**: that
 * is what proves the non-anchored regex is load-bearing rather than a stylistic preference, and it is
 * the property that fails if someone weakens `FENCE_OPEN` back to column-0 anchoring, or if the
 * indented-fence samples disappear from the corpus.
 *
 * Both numbers come from the same fence scanner, so only the opener regex differs — a bare ``` inside
 * an indented block cannot inflate one side.
 */
export function checkFenceRegex(read, mdPaths) {
    let anchoredTotal = 0;
    let unanchoredTotal = 0;
    let motokoAnchoredTotal = 0;
    let motokoUnanchoredTotal = 0;
    const gainers = [];
    for (const p of mdPaths) {
        const text = read(p);
        if (text == null) continue;
        const { anchored, unanchored, motokoAnchored, motokoUnanchored } =
            proveFenceRegex(text);
        anchoredTotal += anchored;
        unanchoredTotal += unanchored;
        motokoAnchoredTotal += motokoAnchored;
        motokoUnanchoredTotal += motokoUnanchored;
        if (motokoUnanchored > motokoAnchored)
            gainers.push({
                file: p,
                motokoAnchored,
                motokoUnanchored,
                anchored,
                unanchored,
            });
    }
    return {
        files: mdPaths.length,
        anchoredTotal,
        unanchoredTotal,
        motokoAnchoredTotal,
        motokoUnanchoredTotal,
        gainers,
        ok: gainers.length > 0,
    };
}

/** Convenience: list every `.mo` and `.md` path at a revision (the census set is filtered later). */
export function setPaths(rev, predicate) {
    return listFiles(rev).filter(predicate);
}
