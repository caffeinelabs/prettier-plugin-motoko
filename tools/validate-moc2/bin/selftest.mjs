// CLI: the four-plant self-test. Prints a table; exit 1 if a plant that should be caught was missed.
//
//   node tools/validate-moc2/bin/selftest.mjs          # human table
//   node tools/validate-moc2/bin/selftest.mjs --json   # machine-readable

import { selfTest } from '../lib/selftest.mjs';

const asJson = process.argv.includes('--json');
const r = await selfTest();

if (asJson) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
} else {
    console.log(
        '=== self-test: does the harness catch the four planted rewrites? ===',
    );
    console.log(
        `moc: ${r.moc.available ? `${r.moc.name} (${r.moc.version})` : 'NOT FOUND (moc levels skipped)'}`,
    );
    for (const p of r.plants) {
        console.log(`\n-- ${p.id}: ${p.title}`);
        for (const [lvl, res] of Object.entries(p.levels)) {
            const tag = !res.ran ? 'SKIP ' : res.caught ? 'CATCH' : 'MISS ';
            console.log(`   ${tag} ${lvl.padEnd(12)} ${res.detail}`);
        }
    }
    console.log('\n--- summary ---');
    console.log('caught :', r.summary.caught.join(', ') || '(none)');
    console.log('missed :', r.summary.missed.join(', ') || '(none)');
    console.log('skipped:', r.summary.skipped.join(', ') || '(none)');
}

process.exit(r.summary.missed.length === 0 ? 0 : 1);
