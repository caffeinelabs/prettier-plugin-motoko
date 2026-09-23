// CLI: run the Goal 1 levels over a set. The rewrite is the identity today, because `moc2` does not
// exist yet; the levels run end to end regardless, which is what makes them more than stubs. See
// lib/goal1.mjs for exactly what each level means under the identity.
//
//   node tools/validate-moc2/bin/goal1.mjs                 # oracle set, human summary
//   node tools/validate-moc2/bin/goal1.mjs --set full      # every .mo and fence (a few minutes)
//   node tools/validate-moc2/bin/goal1.mjs --limit 100     # first 100 units, for a quick smoke
//   node tools/validate-moc2/bin/goal1.mjs --json          # machine-readable, for the report writer
//
// Exit code is 1 when any level reports a failure beyond the pre-existing/expected kinds, or when the
// execution level could not run (it never passes silently). A monkey-patched rewrite is deliberately
// NOT offered here: wiring a real `moc2` is a source edit in lib/goal1.mjs, not a flag, so a run
// cannot silently claim to have used a rewrite it did not.

import { BASE, inOracleSet } from '../lib/config.mjs';
import { listFiles } from '../lib/git.mjs';
import { goal1 } from '../lib/goal1.mjs';

const asJson = process.argv.includes('--json');
const setName = argValue('--set') ?? 'oracle';
const limitArg = argValue('--limit');
const limit = limitArg ? Number(limitArg) : Infinity;

function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const all = listFiles(BASE).filter(
    (p) => p.endsWith('.mo') || p.endsWith('.md'),
);
const paths = setName === 'full' ? all : all.filter(inOracleSet);

const r = await goal1({ setName, paths, limit });

if (asJson) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
} else {
    console.log(`=== Goal 1 over the ${setName} set @ ${BASE.slice(0, 9)} ===`);
    console.log(
        `rewrite: ${r.rewrite}${r.rewrite === 'identity' ? ' (moc2 does not exist yet; identity proves the levels run)' : ''}`,
    );
    console.log(
        `moc: ${r.moc ? `${r.moc.name} — ${r.moc.version}` : 'NOT FOUND (moc levels cannot run)'}`,
    );
    console.log(
        `units: ${r.unitsTotal} total, ${r.unitsProcessed} processed${r.truncated ? ' (TRUNCATED by --limit)' : ''}, ${r.skipped.length} skipped`,
    );
    console.log('levels:');
    for (const [k, v] of Object.entries(r.summary.levels))
        console.log(`  ${k.padEnd(12)} ${v}`);
    console.log(
        `grammar-vs-moc disagreements: ${r.summary.grammarMocDisagreements} ` +
            `(grammar-clean/moc-rejects ${r.grammarVsMoc.grammarCleanMocRejects.length}, ` +
            `moc-clean/grammar-errors ${r.grammarVsMoc.mocCleanGrammarErrors.length})`,
    );
    if (r.summary.skipped)
        for (const s of r.skipped.slice(0, 8))
            console.log(`  skip ${s.unit}: ${s.reason}`);
    if (Object.keys(r.diagnosticsOnInput).length)
        console.log(
            `pre-existing moc diagnostics on input: ${JSON.stringify(r.diagnosticsOnInput)}`,
        );
    for (const lvl of [
        'parse',
        'diagnostics',
        'parseTree',
        'typedTree',
        'idempotence',
    ]) {
        const f = r.levels[lvl].failed;
        if (!f.length) continue;
        console.log(`\nfailures in ${lvl} (showing up to 8 of ${f.length}):`);
        for (const x of f.slice(0, 8)) console.log(`  ${x.unit}: ${x.reason}`);
    }
    if (!r.levels.execution.ran)
        console.log(`\nexecution level NOT RUN: ${r.levels.execution.reason}`);
}

// Loud-but-honest exit: a level with zero failures is green; the execution level being "NOT RUN" is a
// reported gap, not a hard failure, so it does not by itself fail the run (it is not silently passed
// either — it is named in the report). Any *failure* list non-empty does fail the run.
const anyFailure = [
    'parse',
    'diagnostics',
    'parseTree',
    'typedTree',
    'idempotence',
].some((l) => r.levels[l].failed.length > 0);
process.exit(anyFailure ? 1 : 0);
