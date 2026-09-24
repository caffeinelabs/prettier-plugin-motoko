// The `docs/style.md` semicolon claims, measured against the real 0.13.0 engine and the in-tree printer.
//
// `docs/style.md` argues the `preserve`/`moc2` split by naming three inputs and what each engine does
// with them. Those rows are load-bearing — they are the worked examples a reader checks the table
// against — and two of the three are **not** in the ported ledger:
//
//   `{\n}`        never appears as a legacy `format()` input on its own. Every ledger case that opens
//                 this way continues (`{\n}\nA\n`, `{\n}\n.A`, …), so the row's expectation cannot be
//                 read off `.probe/port-ledger.json` the way the rest of the triage can.
//   `{\n}\nA\n`   *is* the ledger's `automatic semicolons[0]` — but the ledger records the input and
//                 the two engines' outputs only for the **plugin**, and 0.13's column there comes
//                 from replaying it, not from the suite's literal `expect`.
//
// So this probe measures all three, in both engines, and asserts the pairs `docs/style.md` states. It
// exists to keep those rows honest: if a printer change moves one, this fails with the row that moved
// rather than leaving the doc to be re-derived by hand. Same shape as `tools/probe/semi-shape.mts`,
// and for the same reason — a claim in a doc is a claim about behaviour, and behaviour is measurable.
//
// Usage: node --experimental-strip-types tools/probe/semicolon-cells.mts
//
// Needs the pinned 0.13.0 install, which `tools/legacy-golden.mjs` documents how to create:
//   CHURN_OLD_HOME=/tmp/churn013  (or /tmp/legacy-engine)

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const prettier = (await import('prettier')).default;
const plugin = (await import('../../src/index.ts')).default;

const OLD_HOME = process.env.LEGACY_HOME ?? '/tmp/legacy-engine';

/**
 * The 0.13 engine, or null when it is not installed.
 *
 * The assertions are still worth running without it — the `preserve` column is this repo's own
 * printer — so a missing engine downgrades the 0.13 column to a warning rather than failing the probe.
 * That is the same call `tools/legacy-port.mjs` makes, and it keeps the probe runnable in a fresh
 * checkout where `/tmp` has been cleared.
 */
const old = (() => {
    if (!existsSync(`${OLD_HOME}/package.json`)) return null;
    const req = createRequire(`${OLD_HOME}/package.json`);
    return { prettier: req('prettier'), plugin: req('prettier-plugin-motoko') };
})();

const BASE = { printWidth: 80, tabWidth: 2, trailingComma: 'none' } as const;

/** 0.13 registers `motoko-tt-parse`; the in-tree plugin's `motoko` name does not exist there. */
const formatOld = (input: string) =>
    old!.prettier.format(input, {
        ...BASE,
        parser: 'motoko-tt-parse',
        plugins: [old!.plugin],
    });

const formatNow = (input: string) =>
    prettier.format(input, { ...BASE, parser: 'motoko', plugins: [plugin] });

/**
 * The three rows of `docs/style.md` §"Interaction with the ported fixture expectations", with the
 * engine outputs the doc states. `ledger` records which input is also a ported case, so the doc can
 * cite a measured source for each row.
 */
const ROWS = [
    {
        input: '{\n}',
        doc: { old: '{};\n', now: '{}\n' },
        ledger: null,
        cell: 'broken → `;` (the `ifBreak` `preserve` does not emit)',
    },
    {
        input: '{\n}\nA\n',
        doc: { old: '{};\nA;\n', now: '{}\nA\n' },
        ledger: 'automatic semicolons[0]',
        cell: 'broken → `;`, twice: the block and the top-level decl',
    },
    {
        input: '{\n\n}',
        doc: { old: '{\n\n};\n', now: '{\n\n}\n' },
        ledger: null,
        cell: 'blank line held by `listDoc`; the `;` is the broken cell again',
    },
] as const;

let failures = 0;
const report: string[] = [];

for (const row of ROWS) {
    const now = await formatNow(row.input);
    const nowOk = now === row.doc.now;
    if (!nowOk) failures += 1;

    let oldCell = 'skipped (no 0.13 engine)';
    if (old) {
        let got: string | null = null;
        try {
            got = await formatOld(row.input);
        } catch (error) {
            got = `THREW ${(error as Error).message.split('\n')[0]}`;
        }
        const oldOk = got === row.doc.old;
        if (!oldOk) failures += 1;
        oldCell = `${oldOk ? 'ok  ' : 'FAIL'} 0.13 ${JSON.stringify(got)}`;
    }

    report.push(
        `${nowOk ? 'ok  ' : 'FAIL'} preserve ${JSON.stringify(now)}` +
            `  |  ${oldCell}` +
            `  |  ${JSON.stringify(row.input)}` +
            (row.ledger ? `  [${row.ledger}]` : '  [not a ledger case]'),
    );
}

console.log('docs/style.md semicolon rows:');
for (const line of report) console.log(`  ${line}`);

if (!old) {
    console.log(
        `\n  note: no 0.13.0 engine at ${OLD_HOME}; the 0.13 column was not checked.` +
            '\n  create one with the documented install (see tools/legacy-golden.mjs).',
    );
}

console.log(
    failures === 0
        ? `\n${ROWS.length} rows agree with docs/style.md`
        : `\n${failures} row(s) disagree with docs/style.md`,
);
process.exitCode = failures === 0 ? 0 : 1;
