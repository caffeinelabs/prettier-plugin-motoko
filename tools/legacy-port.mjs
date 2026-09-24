// Run both engines over the extracted legacy corpus and produce the **port ledger**.
//
// Inputs: `.probe/legacy-golden.json` (0.13's output for each case, from `legacy-golden.mjs`).
// Output: `.probe/port-ledger.json` — per case, the new engine's output, whether it parses, whether
// it throws, whether the output is a fixed point, and a coarse classification of the difference
// against 0.13.
//
// This exists because the triage document's verdicts ("keep" / "change" / "delete") are written
// against a suite described in prose, and prose is not checkable. The measurement is what decides
// which cases are already satisfied and which encode a rule M2 deliberately altered. Nothing here
// writes fixtures; it only says what is true.
//
// One caveat the numbers make plain and the prose does not: the *inputs* are the legacy engine's
// test inputs, and roughly a third of them are not valid Motoko. The new parser is strict — it
// reports a location instead of guessing — so those cases throw where 0.13 produced output. That is
// a deliberate change, not a regression, and `tools/probe/moc-validity.py` is what tells the two
// apart: a throw on an input moc 2.0 also rejects is the new contract; a throw on an input moc
// accepts is a gap in this parser.
//
// Usage: node tools/legacy-port.mjs [--in .probe/legacy-golden.json] [--out .probe/port-ledger.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
};

const inPath = flag('--in', '.probe/legacy-golden.json');
const outPath = flag('--out', '.probe/port-ledger.json');

const prettier = (await import('prettier')).default;
const plugin = (await import(resolve(ROOT, 'src/index.ts'))).default;
const { parse: parseMotoko } = await import(
    resolve(ROOT, 'src/parser/parse.ts')
);

const data = JSON.parse(readFileSync(resolve(ROOT, inPath), 'utf8'));

/**
 * Options per suite. `organizeImports` additionally turns the pass on, matching the legacy suite's
 * own `organizeImportsOptions`.
 */
function optionsFor(c) {
    const base = {
        parser: 'motoko',
        plugins: [plugin],
        printWidth: 80,
        tabWidth: 2,
        trailingComma: 'none',
    };
    return c.suite === 'organizeImports'
        ? { ...base, motokoOrganizeImports: true }
        : base;
}

/** First differing line, for a diff summary a human can read at a glance. */
function firstDelta(a, b) {
    if (a === b) return null;
    const al = a.split('\n');
    const bl = b.split('\n');
    for (let i = 0; i < Math.max(al.length, bl.length); i += 1) {
        if (al[i] !== bl[i]) {
            return { line: i + 1, old: al[i] ?? null, now: bl[i] ?? null };
        }
    }
    return null;
}

const ledger = [];
for (const [i, c] of data.cases.entries()) {
    const record = {
        suite: c.suite,
        group: c.group,
        name: c.name,
        index: c.index,
        input: c.input,
        legacy: c.golden,
        legacyError: c.error ?? null,
    };

    try {
        const once = await prettier.format(c.input, optionsFor(c));
        record.output = once;
        record.threw = null;
        // Idempotence is a separate fact from "matches 0.13": a case can differ from 0.13 on purpose
        // and still be a fixed point, which is what the fixture suite asserts.
        const twice = await prettier.format(once, optionsFor(c));
        record.idempotent = twice === once;
    } catch (error) {
        record.output = null;
        record.threw = String(
            error && error.message ? error.message : error,
        ).split('\n')[0];
    }

    if (record.output !== null) {
        try {
            const parsed = await parseMotoko(record.output);
            record.parses = parsed.problems.length === 0;
            record.problems = parsed.problems
                .slice(0, 2)
                .map((p) => `${p.message} @${p.line}:${p.column}`);
        } catch (error) {
            record.parses = false;
            record.problems = [String(error && error.message)];
        }
    } else {
        // A throw is re-stated as a parse failure of the *input*, so the two are comparable: the
        // parser is the thing that refuses, and it refuses before the guard runs.
        try {
            const parsed = await parseMotoko(c.input);
            record.parses = parsed.problems.length === 0;
            record.problems = parsed.problems
                .slice(0, 2)
                .map((p) => `${p.message} @${p.line}:${p.column}`);
        } catch (error) {
            record.parses = false;
            record.problems = [String(error && error.message)];
        }
    }

    record.matchesLegacy = record.output !== null && record.output === c.golden;
    record.delta =
        record.output !== null && !record.matchesLegacy
            ? firstDelta(c.golden ?? '', record.output)
            : null;

    ledger.push(record);
    if ((i + 1) % 50 === 0)
        process.stderr.write(`  ${i + 1}/${data.cases.length}\n`);
}

writeFileSync(
    resolve(ROOT, outPath),
    JSON.stringify({ engine: data.engine, cases: ledger }, null, 2) + '\n',
);

const tally = (pred) => ledger.filter(pred).length;
console.error(
    [
        `${ledger.length} cases against ${data.engine}:`,
        `  throws        ${tally((r) => r.threw)}`,
        `  does not parse${String(tally((r) => r.output !== null && r.parses === false)).padStart(2)}`,
        `  not idempotent${String(tally((r) => r.idempotent === false)).padStart(2)}`,
        `  == 0.13       ${tally((r) => r.matchesLegacy)}`,
        `  differs       ${tally((r) => r.output !== null && !r.matchesLegacy)}`,
        `-> ${outPath}`,
    ].join('\n'),
);
