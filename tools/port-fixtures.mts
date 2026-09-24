// Generate the `tests/format/**` fixtures that port the legacy formatter suite.
//
// `docs/formatter-rework.md` requires the 0.13 suites be "ported as fixtures ... each is kept,
// changed on purpose (with a note), or deleted as a bug". `tools/port-verdicts.mjs` derives which
// cases those are; this writes the files for the ones needing a fixture.
//
// ## Why one file per *name*, with a per-case fallback
//
// A legacy name is one test with several cases, so the natural fixture is one file holding that
// name's inputs. That works for most names and not all of them: a legacy case is often a *fragment*
// (`1*1`, `? ?a`, `A\n|> B`), and two fragments can compose into a program neither one was. The
// sharpest case is the one under test — `null coalesce operator` has both `?a` and `??a` among its
// cases, and concatenating them puts a `?` and a `?` in positions the source never had, which is the
// exact token pair that family is about.
//
// So the decision is **measured, not guessed**: each name's cases are joined and run through the
// printer, and the name composes only if the join formats and is a fixed point. A name that fails
// gets one fixture per case. The generator therefore imports the plugin, which is why it is `.mts`
// and runs under `--experimental-strip-types` — the same shape as the probes beside it.
//
// ## Why the bodies are byte-identical to the ledger
//
// The point of the port is fidelity to what 0.13 was given. A body that had been reindented, or
// whose fragments were joined differently, would be a new case wearing a legacy name, and the
// snapshot would record something the legacy suite never asked about. So the body is the ledger's
// `input` verbatim (joined with a newline where a name composes), and `--check` re-derives every
// file and fails on any drift.
//
// ## What the header is
//
// The verdict, in the ledger's words: how many of the name's cases already matched 0.13, and for
// each that moved, the measured mechanism and the first line that differs. That is the "changed on
// purpose (with a note)" the plan asks for. It is a live part of the program — a `//` comment — so
// `--verify` re-runs every body through the pinned moc *with* the header and fails if the comment
// changed what the input does, exactly as `tools/refusal-fixtures.mjs` does.
//
// Usage: node --experimental-strip-types tools/port-fixtures.mts [--check] [--verify]

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import prettier from 'prettier';

import plugin from '../src/index.ts';

const ROOT = '/Users/kamil.listopad/prettier-plugin-motoko';
const OUT = join(ROOT, 'tests/format');
const check = process.argv.includes('--check');
const verify = process.argv.includes('--verify');

const ledger = createRequire(import.meta.url)('../.probe/port-ledger.json');
const { verdicts, disposition } = createRequire(import.meta.url)(
    '../.probe/port-verdicts.json',
);

if (!ledger.cases || !verdicts) {
    console.error('need .probe/port-ledger.json and .probe/port-verdicts.json');
    console.error(
        '  node tools/legacy-port.mjs && node tools/port-verdicts.mjs --write',
    );
    process.exit(2);
}

/** The options `tests/format.test.ts` formats every fixture under, so the measurement agrees. */
const OPTIONS = {
    parser: 'motoko',
    plugins: [plugin],
    printWidth: 80,
    tabWidth: 2,
    trailingComma: 'none',
} as const;

/**
 * A legacy name to a filesystem slug. Same rule as `tools/refusal-fixtures.mjs`, and for the same
 * reason: the names are suite labels, not paths — they carry spaces, slashes, backticks, `*`, `@`,
 * `:`, `.`, so every run of punctuation collapses to `-`.
 */
const slug = (name: string) =>
    name
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();

/**
 * The recorder's sentinel, which is **not** a legacy input.
 *
 * `tools/legacy-extract.mjs` stubs `prettier.format` to return `__sentinel_N__` while it replays a
 * suite, so a test that formats its own expected value records that placeholder as the input of the
 * inner call. `tests/legacy/formatter.test.ts` has one: `expectFormatted` is
 * `expect(await format(input)).toStrictEqual(input)`, so the outer call's sentinel comes back to
 * `format` as an argument. Four of the 323 recorded calls are that artifact, all under
 * `double newline after import section`.
 *
 * They cannot be fixtures: the body would be the literal text `__sentinel_273__`, which was never a
 * legacy input and asserts nothing about the printer. Dropping them is not "deleting a case" — the
 * case's real input is already in the ledger under its own index, extracted from the outer call.
 */
const isSentinel = (input: string) => /^__sentinel_\d+__$/.test(input.trim());

/** The resolved cases of each name, in ledger order — a throwing case cannot be a fixture. */
const casesByName = new Map<string, any[]>();
for (const c of ledger.cases) {
    if (c.threw) continue;
    if (isSentinel(c.input)) continue;
    if (!casesByName.has(c.name)) casesByName.set(c.name, []);
    casesByName.get(c.name)!.push(c);
}

/**
 * Where a name's fixture goes, which decides its options: `tests/format.test.ts` keys `AREA_OPTIONS`
 * off the *area directory*, so an organize-imports name has to land under `organize-imports/` to be
 * formatted with the option on. The formatter names go to `port/`, whose name says what the
 * directory is — the ported legacy suite, not a fresh area.
 */
const areaFor = (suite: string) =>
    suite === 'organizeImports' ? 'organize-imports' : 'port';

/** The verdict row for a name, from the tool that derived it rather than recomputed here. */
const rowFor = (name: string) => disposition.find((d: any) => d.name === name);

/** One `//` line per line, with a bare `//` for a blank one. The body keeps its own indent. */
const comment = (lines: string[]) =>
    lines.map((line) => (line === '' ? '//' : `// ${line}`)).join('\n');

/**
 * The header: the verdict in the ledger's words.
 *
 * Everything here is *derived* from `.probe/port-verdicts.json` — the counts, the mechanisms, the
 * first differing line — so a fixture's note cannot drift from the measurement that justified
 * writing it. The closing pointer is the only hand-written part, and only because "where a refusal
 * lives" is not a field the ledger has.
 */
function headerFor(name: string): string {
    const row = rowFor(name);
    const changed = verdicts.filter(
        (v: any) => v.name === name && v.verdict === 'change',
    );

    const lines = [
        `Ported from the 0.13.0 suite: \`${name}\` (${row.suite}).`,
        '',
    ];

    const parts: string[] = [];
    if (row.keep) parts.push(`${row.keep} already identical to 0.13`);
    if (row.change) parts.push(`${row.change} changed on purpose`);
    if (row.delete) parts.push(`${row.delete} deleted as a bug`);
    lines.push(`Verdict: ${parts.join(', ')}.`);

    // Each mechanism with its count, most common first, then the measured difference per case: the
    // first line that differs and both spellings, which is what a reviewer would otherwise have to
    // produce by hand from a diff of the whole run.
    const byMech = new Map<string, any[]>();
    for (const v of changed) {
        if (!byMech.has(v.mechanism)) byMech.set(v.mechanism, []);
        byMech.get(v.mechanism)!.push(v);
    }
    for (const [mech, vs] of [...byMech].sort(
        (a, b) => b[1].length - a[1].length,
    )) {
        lines.push('');
        lines.push(`${vs.length} × ${mech}:`);
        for (const v of vs) {
            const d = v.diff;
            const where = d ? `line ${d.line}: ` : '';
            const what = d
                ? `0.13 ${JSON.stringify(d.legacy)} → now ${JSON.stringify(d.output)}`
                : 'differs';
            lines.push(`  - [${v.index}] ${where}${what}`);
        }
    }

    if (row.delete) {
        lines.push('');
        lines.push(
            `${row.delete} case(s) of this name are refusals — the parse throws, so they cannot be`,
        );
        lines.push(
            'a fixture here. They are pinned in `tests/refusals/` (see `tests/refusals.test.ts`).',
        );
    }

    lines.push('');
    lines.push(
        'The body below is the legacy input byte-for-byte; the snapshot records what the',
    );
    lines.push(
        'printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.',
    );
    lines.push(
        'Generated by `tools/port-fixtures.mts`; edit that, not this file.',
    );
    return comment(lines);
}

/**
 * Whether a name's cases can be one fixture, decided by running the join rather than by inspecting
 * it. A name composes when the joined text formats *and* the result is a fixed point; a printer that
 * oscillated on the join would pass a structural check and still make a fixture that cannot assert
 * idempotence.
 */
async function composes(cases: any[]): Promise<boolean> {
    const joined = cases.map((c) => c.input).join('\n');
    try {
        const once = await prettier.format(joined, OPTIONS as any);
        const twice = await prettier.format(once, OPTIONS as any);
        return once === twice;
    } catch {
        return false;
    }
}

/** The written files, so `--check` and the summary can report without re-walking the tree. */
const written: { rel: string; body: string; input: string }[] = [];
/** Names whose cases could not compose, reported rather than hidden. */
const split: string[] = [];
/** Names skipped because the join is not a fixed point but each case alone is (unused today). */
const skipped: string[] = [];

for (const row of disposition as any[]) {
    if (row.needFixture === 0) continue;
    const cases = casesByName.get(row.name) ?? [];
    if (!cases.length) continue;
    const area = areaFor(row.suite);

    if (await composes(cases)) {
        written.push({
            rel: `${area}/${slug(row.name)}.mo`,
            body: `${headerFor(row.name)}\n${cases.map((c) => c.input).join('\n')}`,
            input: cases.map((c) => c.input).join('\n'),
        });
    } else {
        split.push(row.name);
        for (const c of cases) {
            written.push({
                rel: `${area}/${slug(row.name)}-${c.index}.mo`,
                body: `${headerFor(row.name)}\n${c.input}`,
                input: c.input,
            });
        }
    }
}

let drift = 0;
for (const { rel, body } of written) {
    const path = join(OUT, rel);
    if (check) {
        const actual = existsSync(path) ? readFileSync(path, 'utf8') : null;
        if (actual !== body) {
            console.error(`DRIFT ${rel}`);
            drift += 1;
        }
        continue;
    }
    mkdirSync(join(OUT, rel.split('/')[0]), { recursive: true });
    writeFileSync(path, body);
}

if (check) {
    console.log(
        drift === 0
            ? `${written.length} port fixtures reproduce the ledger`
            : `${drift} drifted`,
    );
    process.exitCode = drift === 0 ? 0 : 1;
} else {
    const byArea: Record<string, number> = {};
    for (const { rel } of written) {
        const area = rel.split('/')[0];
        byArea[area] = (byArea[area] ?? 0) + 1;
    }
    console.log(`wrote ${written.length} port fixtures`);
    for (const [area, n] of Object.entries(byArea))
        console.log(`  tests/format/${area}  ${n}`);
    if (skipped.length)
        console.log(`\nskipped (never a fixed point): ${skipped.join(', ')}`);
    if (split.length) {
        console.log(
            `\n${split.length} names did not compose; each case is its own fixture:`,
        );
        for (const n of split) console.log(`  ${n}`);
    }
}

if (verify) {
    // What this checks, and what it deliberately does not.
    //
    // The claim a generated fixture rests on is that its **header comment is inert** — that the
    // note describing the verdict does not change what moc does with the body. That is the failure
    // worth catching, because a header that mattered would make the fixture assert the comment
    // rather than the input. It is checked by comparing moc's diagnostics for the bare input against
    // its diagnostics for the file, with the header's line count added to the bare input's line
    // numbers: the two must name the same error at the same *body* position.
    //
    // It does **not** check that moc accepts the body, because several legacy cases are deliberately
    // not valid programs. A legacy case can be a *fragment*, and some are context-dependent ones — a
    // bare `case x => y` needs the `switch` around it, a top-level `return` needs a function, and a
    // `let (fst, snd) = ` needs its right-hand side. `docs/fixture-triage.md` already records that
    // the legacy suite formatted fragments, so requiring moc to accept them would demand exactly the
    // rewriting the port is supposed to avoid. The count of these is reported rather than hushed: a
    // number that grows unexpectedly is a signal, and a number pinned at today's value is a fact.
    const MOC = '/tmp/mocnow/moc';
    const scratch = mkdtempSync(join(tmpdir(), 'port-verify-'));

    /** moc's syntax errors as `line:col` pairs. Exit code is 0 for valid and invalid alike. */
    const errors = (source: string, tag: string): string[] => {
        const file = join(scratch, `${tag}.mo`);
        writeFileSync(file, source);
        let out = '';
        try {
            out = execFileSync(MOC, ['-dp', file], {
                encoding: 'utf8',
                stdio: 'pipe',
            });
        } catch (error) {
            out =
                String((error as any).stdout ?? '') +
                String((error as any).stderr ?? '');
        }
        return [
            ...out.matchAll(/(\d+)\.(\d+)-(\d+)\.(\d+): syntax error/g),
        ].map((m) => `${m[1]}.${m[2]}`);
    };

    let altered = 0;
    let fragments = 0;
    const fragmentNames: string[] = [];
    for (const [i, { rel, body, input }] of written.entries()) {
        const headerLines = body.split('\n').length - input.split('\n').length;
        const bareErrors = errors(input, `bare-${i}`);
        const fileErrors = errors(body, `hdr-${i}`);
        // Shift the bare input's lines down by the header's height to compare body positions.
        const shifted = bareErrors.map((e) => {
            const [line, col] = e.split('.');
            return `${Number(line) + headerLines}.${col}`;
        });
        if (shifted.join(' ') !== fileErrors.join(' ')) {
            console.error(
                `HEADER CHANGES ${rel} — bare ${shifted.join(' ') || '(none)'}` +
                    ` vs fixture ${fileErrors.join(' ') || '(none)'}`,
            );
            altered += 1;
        }
        if (bareErrors.length) {
            fragments += 1;
            fragmentNames.push(rel);
        }
    }

    if (fragmentNames.length) {
        console.log(
            `\n${fragments} of ${written.length} bodies are fragments moc rejects on their own:`,
        );
        for (const n of fragmentNames) console.log(`  ${n}`);
    }
    console.log(
        altered === 0
            ? `\nall ${written.length} verified: every header is inert`
            : `\n${altered} altered by their header`,
    );
    process.exitCode = altered === 0 ? 0 : 1;
}
