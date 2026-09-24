/**
 * The refusal corpus: inputs the compiler rejects, so the formatter rejects them too.
 *
 * These cannot live under `tests/format/`, whose harness globs every `.mo` there and asserts
 * `resolves.toMatchSnapshot()` — a fixture whose format call rejects fails that suite, and the only
 * ways out would be special-casing the area out of the glob (an edit to the file that owns the
 * shared serial snapshot) or snapshotting a throw (impossible). So they live in a sibling root that
 * the format glob never sees.
 *
 * **What is asserted is class and locatedness, not the message.** The rule the rework is preserving
 * is "the compiler's rejects are still rejected, and the error still has a location a user can act
 * on". The message and the exact line/column are the brittle part: a parser-recovery improvement can
 * legitimately move the caret, and the `}` verb is already special-cased to the words "closing
 * brace". Pinning `Unexpected input at 3:16.` would fail on an unrelated improvement while telling a
 * reader nothing the `loc` does not. The message is fully derivable from `loc` plus the verb, so
 * asserting both would be redundant as well as brittle.
 *
 * The two directories mirror the ledger's two suites, because the option is what a reader needs to
 * reproduce a case: `organize/**` runs with `motokoOrganizeImports` on, `parse/**` with the base
 * options. All ten organize throws come from the *initial parse*, before `organizeImportSection` can
 * decline, so they assert the same contract as the parse ones — they are split only so the right
 * options apply.
 *
 * Fixtures are generated from the ledger by `tools/refusal-fixtures.mjs`; that script's `--verify`
 * re-runs every input through the pinned moc and fails if the header comment changed what it does.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';
import prettier from 'prettier';

import plugin from '../src/index.ts';
import { MotokoSyntaxError } from '../src/parser/parse.ts';

/** There is no `tests/refusals/` glob helper to borrow: this file sits in `tests/`, beside it. */
const ROOT = join(import.meta.dirname, 'refusals');

/** Base options, matching `tests/format.test.ts` so a refusal here reads like a success there. */
const OPTIONS = {
    parser: 'motoko',
    plugins: [plugin],
    printWidth: 80,
    tabWidth: 2,
    trailingComma: 'none',
} as const;

/** The option each area is exercised under. The directory name is the whole configuration. */
const AREA_OPTIONS: Record<string, Record<string, unknown>> = {
    organize: { motokoOrganizeImports: true },
};

function filesIn(area: string): string[] {
    return readdirSync(join(ROOT, area))
        .filter((name) => name.endsWith('.mo'))
        .sort()
        .map((name) => join(ROOT, area, name));
}

const CASES = [
    ...filesIn('parse').map((path) => ['parse', path] as const),
    ...filesIn('organize').map((path) => ['organize', path] as const),
];

describe.each(CASES)('refusals/%s', (area, path) => {
    const name = relative(ROOT, path);

    test('rejects with a located syntax error', async () => {
        const source = readFileSync(path, 'utf8');
        const options = { ...OPTIONS, ...(AREA_OPTIONS[area] ?? {}) };

        // `toBeInstanceOf` is the class claim, and it is not interchangeable with a message match:
        // `MotokoSyntaxError` extends `SyntaxError` precisely so Prettier's own error handling
        // treats it as a parse error, which makes `instanceof SyntaxError` also true — the specific
        // class is what distinguishes a genuine parse refusal from a thrown internal guard.
        const error = await prettier.format(source, options).then(
            () => null,
            (thrown: unknown) => thrown,
        );

        expect(
            error,
            `${name} resolved; a refusal fixture must reject`,
        ).toBeInstanceOf(MotokoSyntaxError);
        expect(error).toBeInstanceOf(SyntaxError);

        // Locatedness, as a range rather than a value. "There is a loc, and it points inside this
        // file" is the property; *which* line is deliberately not pinned.
        const { loc } = error as MotokoSyntaxError;
        expect(loc.start.line).toBeGreaterThanOrEqual(1);
        expect(loc.start.line).toBeLessThanOrEqual(source.split('\n').length);
        expect(loc.start.column).toBeGreaterThanOrEqual(0);
        expect(loc.end.line).toBeGreaterThanOrEqual(loc.start.line);
    });

    test('carries a code frame built from the source', async () => {
        const source = readFileSync(path, 'utf8');
        const options = { ...OPTIONS, ...(AREA_OPTIONS[area] ?? {}) };
        const error = (await prettier.format(source, options).then(
            () => null,
            (thrown: unknown) => thrown,
        )) as MotokoSyntaxError;

        // The frame is what Prettier prints verbatim, so an empty one would be a silent regression
        // in the one part of the error a user reads. Its exact text is left to the printer.
        expect(error.codeFrame.length).toBeGreaterThan(0);
    });
});
