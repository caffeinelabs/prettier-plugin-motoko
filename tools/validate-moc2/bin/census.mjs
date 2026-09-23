// CLI: run the census over the oracle and full sets at BASE, print the numbers.
//
//   node tools/validate-moc2/bin/census.mjs                  # both sets, human summary
//   node tools/validate-moc2/bin/census.mjs --json           # machine-readable, for the report writer
//   node tools/validate-moc2/bin/census.mjs --write-expected # regenerate expected-counts.mjs (re-pin only)
//
// Exit code is 1 when the expected-count check fails on either set, or when the fence-regex check
// finds a file the column-0-anchored regex would drop; 0 otherwise. Parsing failures are reported but
// do not fail the run (the plan says they are recorded, not fatal).

import { BASE, inOracleSet } from '../lib/config.mjs';
import { assertCheckout, listFiles, readerFor } from '../lib/git.mjs';
import { census, checkExpected, checkFenceRegex } from '../lib/census.mjs';
import { writeExpected } from '../lib/expected-counts.mjs';
import { EXPECTED_UNITS } from '../lib/expected-counts.mjs';

function isUnitFile(p) {
    return p.endsWith('.mo') || p.endsWith('.md');
}

/** Rewrite `lib/expected-counts.mjs` from a live census. Only run on a deliberate re-pin. */
function regenerate(oracle, full) {
    writeExpected({
        oracle: Object.fromEntries(
            Object.entries(oracle.files).filter(([, r]) => r.units > 0),
        ),
        full: Object.fromEntries(
            Object.entries(full.files).filter(([, r]) => r.units > 0),
        ),
    });
}

async function main() {
    const asJson = process.argv.includes('--json');
    const doWrite = process.argv.includes('--write-expected');
    assertCheckout();

    const allPaths = listFiles(BASE).filter(isUnitFile);
    const full = await census({ setName: 'full', paths: allPaths });
    const oraclePaths = allPaths.filter(inOracleSet);
    const oracle = await census({ setName: 'oracle', paths: oraclePaths });

    if (doWrite) {
        regenerate(oracle, full);
        console.log(`wrote lib/expected-counts.mjs from census @ ${BASE}`);
        return;
    }

    const fullCheck = checkExpected(full, EXPECTED_UNITS.full ?? {});
    const oracleCheck = checkExpected(oracle, EXPECTED_UNITS.oracle ?? {});
    // The fence-regex trap, asserted rather than described: any file the column-0-anchored regex
    // would drop is a failure, because using that regex is exactly what hid style-guide.md from #6385.
    const fenceCheck = checkFenceRegex(
        readerFor(BASE),
        allPaths.filter((p) => p.endsWith('.md')),
    );

    const out = {
        base: BASE,
        oracle: {
            files: oracle.fileCount,
            unitsTotal: oracle.unitsTotal,
            unitsParsed: oracle.unitsParsed,
            unparsed: oracle.unparsed,
            residue: oracle.residue,
            grouped: oracle.grouped,
        },
        full: {
            files: full.fileCount,
            unitsTotal: full.unitsTotal,
            unitsParsed: full.unitsParsed,
            unparsed: full.unparsed,
            residue: full.residue,
            grouped: full.grouped,
        },
        // #6385's reported figures, for the gap discussion.
        reported: {
            oracleUnits: 338,
            testBareArmBodies: 549,
            testArmSeparators: 1249,
        },
        checks: {
            oracle: oracleCheck,
            full: fullCheck,
            fenceRegex: {
                ok: fenceCheck.ok,
                files: fenceCheck.files,
                anchoredTotal: fenceCheck.anchoredTotal,
                unanchoredTotal: fenceCheck.unanchoredTotal,
                motokoAnchoredTotal: fenceCheck.motokoAnchoredTotal,
                motokoUnanchoredTotal: fenceCheck.motokoUnanchoredTotal,
                gainerCount: fenceCheck.gainers.length,
                gainers: fenceCheck.gainers,
            },
        },
    };

    if (asJson) {
        process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    } else {
        for (const [name, set] of [
            ['ORACLE', out.oracle],
            ['FULL', out.full],
        ]) {
            console.log(`\n=== ${name} set @ ${BASE.slice(0, 9)} ===`);
            console.log(
                `files: ${set.files}   units: ${set.unitsTotal}   parsed: ${set.unitsParsed}`,
            );
            console.log(`unparseable units: ${set.unparsed.length}`);
            console.log('residue (grouped):');
            for (const [k, v] of Object.entries(set.grouped))
                console.log(`  ${k}: ${v}`);
        }
        console.log('\n--- expected-count check ---');
        console.log('oracle ok:', out.checks.oracle.ok);
        console.log('full   ok:', out.checks.full.ok);
        const bad = [
            ...out.checks.oracle.drops.map(
                (d) => `oracle drop ${d.file}: ${d.observed} < ${d.expected}`,
            ),
            ...out.checks.oracle.missing.map(
                (d) => `oracle missing ${d.file} (expected ${d.expected})`,
            ),
            ...out.checks.full.drops.map(
                (d) => `full drop ${d.file}: ${d.observed} < ${d.expected}`,
            ),
            ...out.checks.full.missing.map(
                (d) => `full missing ${d.file} (expected ${d.expected})`,
            ),
        ];
        for (const line of bad) console.log('  FAIL ' + line);

        const fc = out.checks.fenceRegex;
        console.log('\n--- fence-regex check (the #6385 trap) ---');
        console.log(
            `over ${fc.files} .md files: column-0-anchored found ${fc.motokoAnchoredTotal} motoko fences, ` +
                `real regex found ${fc.motokoUnanchoredTotal}`,
        );
        console.log(
            fc.ok
                ? `trap confirmed: ${fc.gainerCount} file(s) would be dropped by column-0 anchoring`
                : 'FAIL no file loses fences under column-0 anchoring — the non-anchored regex is untested',
        );
        for (const g of fc.gainers.slice(0, 10))
            console.log(
                `  ${g.file}: anchored ${g.motokoAnchored} vs real ${g.motokoUnanchored} motoko fences`,
            );
        if (fc.gainers.length > 10)
            console.log(
                `  ... and ${fc.gainers.length - 10} more (see --json)`,
            );
    }

    process.exit(
        out.checks.oracle.ok && out.checks.full.ok && out.checks.fenceRegex.ok
            ? 0
            : 1,
    );
}

await main();
