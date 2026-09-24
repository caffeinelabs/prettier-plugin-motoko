/**
 * The fixture harness: `tests/format/<area>/*.mo` in, snapshot out, plus idempotence.
 *
 * `docs/formatter-rework.md:71-75` fixes the directory contract —
 *
 *     tests/
 *       format/<area>/*.mo               input fixtures, snapshot output
 *
 * — and line 146 fixes what the files mean: "`tests/format/**` and `tests/rewrite/**` use Vitest
 * snapshots. Every fixture also asserts idempotence."
 *
 * ## Why a fixture is an *input*
 *
 * The snapshots are not asserts that the fixture text is canonical. A fixture's whole job is to be
 * non-canonical in a specific way, so the snapshot records what the printer did to it and a diff
 * shows exactly what an area printer changed. That is the reviewable artefact of the per-area PRs:
 * one area's diff should move that area's fixtures and no others.
 *
 * ## Why idempotence is asserted separately
 *
 * `toMatchSnapshot` pins "the output is what it was". Idempotence pins something the snapshot cannot:
 * that the output is a **fixed point**. Those come apart in exactly the interesting failure — a
 * printer that moves a line one way on the first pass and back on the second passes every snapshot
 * and still oscillates, and `--check` in CI would report a file that is clean only on even runs. The
 * two assertions are cheap and they catch different bugs, so both are here.
 *
 * ## Why the guard is not re-implemented here
 *
 * `format` runs `src/verify.ts`'s guard internally and throws on a rewrite. So every case below is
 * simultaneously a layout assertion and a proof that the layout preserves the program. A case whose
 * fixture the printer would have to *change the meaning of* to format fails with a guard error, not
 * a snapshot diff, and the failure says which.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';
import prettier from 'prettier';

import plugin from '../src/index.ts';

/** Where the fixtures live, relative to this file's directory. */
const FIXTURE_ROOT = join(import.meta.dirname, 'format');

/**
 * The options every fixture is formatted under, spelled out for the same reason
 * `tests/printer.test.ts` spells them out: an output is a function of its options, so a fixture
 * relying on defaults would really be asserting that Prettier's defaults have not moved.
 */
const OPTIONS = {
    parser: 'motoko',
    plugins: [plugin],
    printWidth: 80,
    tabWidth: 2,
    trailingComma: 'none',
} as const;

function format(source: string): Promise<string> {
    return prettier.format(source, OPTIONS);
}

/** Every `.mo` file under `tests/format`, as `<area>/<file>.mo` so a failure names its area. */
function fixtures(dir: string = FIXTURE_ROOT, out: string[] = []): string[] {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) fixtures(path, out);
        else if (entry.name.endsWith('.mo')) out.push(path);
    }
    return out.sort();
}

const FILES = fixtures();

/**
 * A harness with no fixtures is indistinguishable from a harness that stopped working, and an area
 * PR that forgets to add its fixtures would then pass silently. The count is asserted rather than
 * assumed.
 */
test('there are fixtures to check', () => {
    expect(FILES.length).toBeGreaterThan(0);
});

describe.each(
    FILES.map((path) => [relative(FIXTURE_ROOT, path), path] as const),
)('format/%s', (name, path) => {
    test('prints as snapshotted', async () => {
        const source = readFileSync(path, 'utf8');
        await expect(format(source)).resolves.toMatchSnapshot();
    });

    test('is a fixed point', async () => {
        const source = readFileSync(path, 'utf8');
        const once = await format(source);
        const twice = await format(once);
        // A bare `toBe` here prints two 100-line blobs and leaves the reader to diff them. The
        // first differing line is the whole content of the failure.
        expect(twice, firstDifferingLine(once, twice)).toBe(once);
    });
});

/** A one-line "line N: expected / actual" note, or a note that the outputs differ only in length. */
function firstDifferingLine(a: string, b: string): string {
    if (a === b) return 'identical';
    const [la, lb] = [a.split('\n'), b.split('\n')];
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
        if (la[i] !== lb[i]) {
            return `first difference at line ${i + 1}: ${JSON.stringify(la[i])} vs ${JSON.stringify(lb[i])}`;
        }
    }
    return 'outputs differ only in trailing newline';
}
