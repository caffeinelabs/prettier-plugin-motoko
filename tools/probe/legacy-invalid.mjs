// Where the new engine differs from 0.13, does 0.13's output even compile?
//
// The port ledger's `differs from 0.13` column (139 of 323 cases) reads like a regression count, and
// `docs/fixture-triage.md` reads it that way when it files the operator clusters under "expected
// `preserve` behaviour". Some of those diffs are not behaviour changes at all: 0.13 emitted code the
// compiler cannot parse, and the new engine's difference is a fix.
//
// The `??` family is the proven instance. 0.13 turns `a ?? b` into `a ??b`, and `docs/adjacency.md`
// §2.4 row C2 records `a ??b` as **never** valid (its `coalesce-trail` probe line reads
// `SYNTAX SYNTAX SYNTAX`), because the `??` token is `alias(token(/\?\?[ \t\r\n]/), "??")` — the
// trailing whitespace is part of the token, so moc 2.0's lexer splits a bare `??` into two `?`.
//
// So this probe asks the question per differing case rather than assuming an answer: for every case
// in the ledger where the new engine's output differs from 0.13's, run **both** outputs through the
// pinned moc and report the four-way split. That turns "116 formatter cases differ, no single cause
// dominates" into "N of them are diffs where 0.13's side does not compile", which is the fact the
// verdicts need.
//
// Remember the two traps this file exists to keep people out of:
//
//   * `moc`'s exit code is 0 for valid and invalid alike, so validity is the presence of
//     `syntax error` in `-dp` output — nothing else signals it.
//   * `/tmp` holds a pile of self-reporting-1.16.1 dev builds that disagree on grammar. Use the
//     pinned oracle below (`MOC` in `tools/probe/moc-validity.py`), never `which moc`.
//
// Usage: node tools/probe/legacy-invalid.mjs [--verbose]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

/** The pinned oracle: `MOC` in `tools/probe/moc-validity.py`. 2.0.0-beta.1. */
const MOC = '/tmp/mocnow/moc';

const ledger = createRequire(import.meta.url)('../../.probe/port-ledger.json');
const verbose = process.argv.includes('--verbose');

if (!ledger.cases) {
    console.error(
        'the ledger has no `cases`; regenerate it with `node tools/legacy-port.mjs`',
    );
    process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), 'legacy-invalid-'));

/**
 * Whether the pinned moc accepts `source`, and the diagnostic when it does not.
 *
 * `-dp` stops after parsing, which is the level that matters here: the legacy cases are often
 * fragments that would fail typecheck (unbound variables are everywhere) but are grammatically
 * fine, and a type error is not what this probe is about. Only `syntax error` counts as invalid.
 */
function compile(source, tag) {
    const file = join(scratch, `${tag}.mo`);
    writeFileSync(file, source);
    let out = '';
    try {
        out = execFileSync(MOC, ['-dp', file], {
            encoding: 'utf8',
            stdio: 'pipe',
        });
    } catch (error) {
        // A non-zero exit is not itself the signal, but its output still is.
        out = String(error.stdout ?? '') + String(error.stderr ?? '');
    }
    const bad = out.includes('syntax error');
    const detail = out
        .split('\n')
        .find((line) => line.includes('syntax error'));
    return { valid: !bad, detail: (detail ?? '').trim().slice(0, 130) };
}

/** Cases where the new engine ran and its output differs from 0.13's. */
const differing = ledger.cases.filter(
    (c) => !c.threw && c.matchesLegacy === false && c.legacy !== null,
);

const buckets = {
    'new-valid   legacy-INVALID': [],
    'new-INVALID legacy-valid': [],
    'both valid': [],
    'both INVALID': [],
};

for (const [i, c] of differing.entries()) {
    const next = compile(c.output, `new-${i}`);
    const legacy = compile(c.legacy, `old-${i}`);
    const input = compile(c.input, `in-${i}`);
    const key =
        next.valid && !legacy.valid
            ? 'new-valid   legacy-INVALID'
            : !next.valid && legacy.valid
              ? 'new-INVALID legacy-valid'
              : next.valid
                ? 'both valid'
                : 'both INVALID';
    buckets[key].push({ ...c, next, legacy, input });
}

console.log(`moc: ${MOC}`);
console.log(`differing cases checked: ${differing.length}\n`);
for (const [key, rows] of Object.entries(buckets)) {
    console.log(`${String(rows.length).padStart(4)}  ${key}`);
}

const fixes = buckets['new-valid   legacy-INVALID'];
if (fixes.length > 0) {
    console.log(
        `\n=== ${fixes.length} case(s) where 0.13's output does not compile and the new engine's does ===`,
    );
    console.log(
        'These need no reconciliation against adjacency.md — the compiler already ruled.',
    );
    const byName = {};
    for (const c of fixes) (byName[c.name] ??= []).push(c);
    for (const [name, rows] of Object.entries(byName).sort(
        (a, b) => b[1].length - a[1].length,
    )) {
        console.log(`  ${String(rows.length).padStart(3)}  ${name}`);
        if (verbose) {
            for (const c of rows) {
                console.log(`         in    ${JSON.stringify(c.input)}`);
                console.log(`         0.13  ${JSON.stringify(c.legacy)}`);
                console.log(`         new   ${JSON.stringify(c.output)}`);
                console.log(`         why   ${c.legacy.detail}`);
            }
        }
    }
}

// The alarming direction: a case where the new engine emits something the compiler refuses and 0.13
// did not. That is only a formatter bug when the **input** was valid to begin with — otherwise the
// new engine is faithfully preserving a file that was already unparseable, which is the deliberate
// strict contract (`import with missing semicolon at end`: moc rejects the input too, 0.13 "repaired"
// it by guessing a `;`, and this engine declines instead of inventing one). Splitting on the input's
// own validity is what keeps this bucket meaningful; without it, the honest refusal reads as a bug.
const refusals = buckets['new-INVALID legacy-valid'];
const regressions = refusals.filter((c) => c.input.valid);
const faithful = refusals.filter((c) => !c.input.valid);

if (faithful.length > 0) {
    console.log(
        `\n=== ${faithful.length} case(s) where the INPUT is already invalid, so preserving it is the contract ===`,
    );
    for (const c of faithful) {
        console.log(`  ${c.name}#${c.index}`);
        console.log(
            `    in    ${JSON.stringify(c.input)}   <- moc: ${c.input.detail}`,
        );
        console.log(
            `    0.13  ${JSON.stringify(c.legacy)}   <- 0.13 guesses a repair`,
        );
        console.log(
            `    new   ${JSON.stringify(c.output)}   <- preserved as written`,
        );
    }
    console.log(
        'Not a regression: 0.13 rewrote a file the compiler refuses, and the new engine does not.',
    );
}

if (regressions.length > 0) {
    console.log(
        `\n=== ${regressions.length} case(s) where the input is VALID and the NEW output is not ===`,
    );
    for (const c of regressions) {
        console.log(`  ${c.name}#${c.index}`);
        console.log(`    in    ${JSON.stringify(c.input)}   <- moc: valid`);
        console.log(`    0.13  ${JSON.stringify(c.legacy)}`);
        console.log(`    new   ${JSON.stringify(c.output)}`);
        console.log(`    why   ${c.next.detail}`);
    }
    console.log(
        '\nEach of these is a formatter bug in the strict contract, not a triage verdict.',
    );
}

process.exitCode = regressions.length === 0 ? 0 : 1;
