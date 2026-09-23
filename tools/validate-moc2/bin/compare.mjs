// CLI: the base-vs-head three-way comparison, written out as divergences.json.
//
//   node tools/validate-moc2/bin/compare.mjs            # run, print a summary, write divergences.json
//   node tools/validate-moc2/bin/compare.mjs --json     # print the full result object to stdout too
//   node tools/validate-moc2/bin/compare.mjs --dry-run  # print the summary, write nothing
//
// WHAT THIS IS, HONESTLY. docs/formatter-rework.md asks for a three-way comparison between (a) the
// base revision, (b) #6385's head, and (c) our formatter's output. The `moc2` rewrite (c) does not
// exist yet, so there is nothing of ours to compare. What CAN be computed today, and is what this
// writes, is the projection onto the two revisions that do exist: **what #6385 actually changed,
// at tree level**, and how does each change fall into the plan's three buckets.
//
// The buckets, and what they mean when there is no `moc2` yet. Each entry carries a `reason` whose
// prefix names the bucket, so a reader can see the classification, not just the count:
//   - intended  — an edit that IS the target migration (a whole-head paren removed, a braced arm
//                 body added), or an edit the plan names as intended-but-not-migration: `func`
//                 wrappers around undeclared names, `func … = e`, `style-guide.md`'s deliberate
//                 counter-example block, comment-only edits. Stays listed permanently.
//   - extra     — an edit whose observable effect is NOT the target migration and not on the plan's
//                 intended list: rewritten doc examples, new fence content, foreign node types.
//                 Listed for a human to confirm (or to report upstream).
//   - missed    — a site the target migration should have reached but did not. Populated from the
//                 head-vs-target direction: residue that survives at HEAD under the migration's own
//                 rules (`headResidue`), i.e. sites the *hand* migration left. The plan's zero target.
//
// A comparison of base vs head is not the plan's comparison, and divergences.json says so in its own
// `meta`: it records which third leg is absent and what it would take to add.

import { writeFileSync } from 'node:fs';
import { BASE, HEAD } from '../lib/config.mjs';
import {
    compareBaseHead,
    headResidue,
    changedUnitPaths,
} from '../lib/compare.mjs';

const OUT = new URL('../divergences.json', import.meta.url);

async function main() {
    const asJson = process.argv.includes('--json');
    const dryRun = process.argv.includes('--dry-run');

    const cmp = await compareBaseHead({ siteLimit: 3 });
    const residue = await headResidue();
    const changed = changedUnitPaths();

    // Head residue, grouped by the migration rule it violates — each is a "missed" site in the
    // head-vs-target direction. Cap the stored sites so the file stays readable; the counts are exact.
    const missedFromResidue = Object.entries(residue.residue)
        .filter(([, n]) => n > 0)
        .map(([rule, count]) => ({
            rule,
            count,
            sites: residue.sites
                .filter((s) => s.construct === rule)
                .slice(0, 20),
        }));

    const doc = {
        meta: {
            generatedBy: 'tools/validate-moc2/bin/compare.mjs',
            base: BASE,
            head: HEAD,
            grammar: cmp.grammar ?? null,
            // The missing third leg, named rather than silently omitted.
            missingLeg: {
                what: 'our moc2 formatter output',
                why: 'the moc2 rewrite does not exist yet; see docs/formatter-rework.md',
                effect:
                    'the three-way (base, head, ours) comparison collapses to base-vs-head plus ' +
                    'head-vs-target residue; there is no "ours" column to attribute changed sites to',
                toAdd:
                    'point this script at a built moc2 and add a third tree build per unit, then ' +
                    'diff ours-vs-both instead of base-vs-head',
            },
            changedUnitPaths: changed.length,
        },
        summary: {
            unitsInBaseOracle: cmp.unitsInBaseOracle,
            unitsInHeadOracle: cmp.unitsInHeadOracle,
            matched: cmp.matched,
            changed: cmp.changed,
            moved: cmp.moved.length,
            shifted: cmp.shifted.length,
            unparseable: cmp.unparseable.length,
            buckets: cmp.buckets.counts,
            headResidue: {
                parsed: residue.parsed,
                unparsed: residue.unparsed,
                total: Object.values(residue.residue).reduce(
                    (a, b) => a + b,
                    0,
                ),
                grouped: residue.grouped,
            },
        },
        // bucket -> entries, each naming the unit, its sites and a one-line reason.
        intended: cmp.buckets.intended,
        missed: cmp.buckets.missed,
        extra: cmp.buckets.extra,
        // Units a fence-count change made unpaired; never classified, because a false edit is worse
        // than a reported gap. Each names the file's base/head fence counts.
        shifted: cmp.shifted,
        unparseable: cmp.unparseable,
        moved: cmp.moved,
        // The head-vs-target "missed" sites, kept separate from the base-vs-head "missed" entries,
        // because they answer a different question (what the hand migration left, not what changed).
        missedResidue: missedFromResidue,
    };

    if (asJson) process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);

    console.log(
        '=== base-vs-head tree comparison (the runnable projection of Goal 2) ===',
    );
    console.log(`base ${BASE.slice(0, 9)}  ->  head ${HEAD.slice(0, 9)}`);
    console.log(
        `oracle units: base ${cmp.unitsInBaseOracle}, head ${cmp.unitsInHeadOracle}`,
    );
    console.log(
        `matched ${cmp.matched}   changed ${cmp.changed}   moved ${cmp.moved.length}   shifted ${cmp.shifted.length}   unparseable ${cmp.unparseable.length}`,
    );
    console.log(
        `buckets: intended ${cmp.buckets.counts.intended}  missed ${cmp.buckets.counts.missed}  extra ${cmp.buckets.counts.extra}`,
    );
    console.log(
        `head residue (head-vs-target missed): ${doc.summary.headResidue.total} site(s) over ${residue.parsed} parsed units`,
    );
    for (const [k, v] of Object.entries(residue.grouped))
        console.log(`  ${k}: ${v}`);

    if (dryRun) {
        console.log('\n--dry-run: divergences.json NOT written');
        return;
    }
    writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
    console.log('\nwrote tools/validate-moc2/divergences.json');
}

await main();
