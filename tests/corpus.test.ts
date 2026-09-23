/**
 * The corpus round-trip: the M1 exit criterion is "100% of the corpus parses and round-trips".
 *
 * This is the check that proves the normaliser loses nothing at a scale no hand-written fixture can
 * reach. It is gated behind `MOTOKO_CORPUS` so a normal `npm test` stays fast, and it runs as its
 * own CI job where a checkout of `motoko` is available as a sibling directory.
 *
 * Two invariants, and they fail differently on purpose:
 *
 * - **No crash.** Every `.mo` file must either parse or raise `MotokoSyntaxError`. Any other throw
 *   is a bug in our code — the normaliser disagreeing with the tree — and fails the run.
 * - **Exact round-trip.** Every file that parses must reconstruct byte for byte. A mismatch is
 *   always our bug, never the grammar's.
 *
 * Files the grammar cannot parse are counted and reported, not failed on: the grammar has known
 * deviations from moc (`docs/grammar-deviations.md`), and the negative fixtures under `test/fail`
 * are *supposed* to be rejected. What must never happen is a file moc accepts being rejected when it
 * is not on the documented deviation list — that is what `MOTOKO_CORPUS_STRICT` checks.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';

import { MotokoSyntaxError, parse } from '../src/parser/parse.ts';
import { checkRoundTrip } from '../src/parser/normalize.ts';

/** Roots scanned for `.mo` files, overridable so the CI job can point at its own checkout. */
function corpusRoots(): string[] {
    const fromEnv = process.env.MOTOKO_CORPUS_ROOTS;
    if (fromEnv) return fromEnv.split(':').filter(Boolean);
    // The default is the layout the plan assumes: a `motoko` and a `motoko-core` sibling of this
    // repo, which is what CI sets up and what a developer has after following the README. The
    // third root is this repo's own fixtures, which live next to this file.
    const repoRoot = join(import.meta.dirname, '..');
    return [
        join(repoRoot, '..', 'motoko', 'test'),
        join(repoRoot, '..', 'motoko-core', 'src'),
        join(import.meta.dirname, 'fixtures'),
    ];
}

/**
 * Directories that never contain source worth scanning.
 *
 * `lib` is deliberately absent: `motoko/test/**\/lib/` holds real fixture modules that other tests
 * import, and skipping it silently drops 24 files. `_out` and `_build` are the compiler's own build
 * output, which is where duplicated generated sources would come from.
 */
const SKIP_DIRS = new Set(['_out', '_build', 'node_modules', '.git']);

function walk(dir: string, out: string[] = []): string[] {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path, out);
        } else if (entry.name.endsWith('.mo')) {
            out.push(path);
        }
    }
    return out;
}

/**
 * Files we expect the grammar to reject.
 *
 * `test/fail` is moc's own negative-fixture directory: every file there is meant to be a syntax or
 * type error, so a grammar rejection is the grammar working. (A few are type errors only and so do
 * parse; that is fine — this list is an expectation about *most* of the directory, and the test
 * below asserts the aggregate rather than each file.)
 */
function isNegativeFixture(path: string): boolean {
    return path.includes('/test/fail/');
}

/** A deviation is not a failure, but it is not allowed to grow silently either. */
interface Sample {
    file: string;
    message: string;
}

const roots = corpusRoots();
const available = roots.filter((r) => existsSync(r));
const files = available.flatMap((r) => walk(r));

describe.skipIf(files.length === 0)('corpus round-trip', () => {
    test('every corpus file parses or raises a MotokoSyntaxError', async () => {
        const crashes: Sample[] = [];
        const syntaxErrors: Sample[] = [];
        const mismatches: Sample[] = [];
        let roundTripped = 0;

        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            let root;
            try {
                ({ root } = await parse(source));
            } catch (error) {
                if (error instanceof MotokoSyntaxError) {
                    syntaxErrors.push({ file, message: error.message });
                } else {
                    // Not a syntax error: the normaliser disagreed with a tree the grammar produced.
                    // This is our bug, and it is the reason this test exists.
                    crashes.push({
                        file,
                        message: `${(error as Error).name}: ${(error as Error).message}`,
                    });
                }
                continue;
            }

            const mismatch = checkRoundTrip(root, source);
            if (mismatch) {
                mismatches.push({
                    file,
                    message: `at ${mismatch.at}: expected ${mismatch.expected} got ${mismatch.got}`,
                });
            } else {
                roundTripped += 1;
            }
        }

        const report = [
            `scanned ${files.length} .mo files under ${available.length} root(s)`,
            `round-trip exact:     ${roundTripped}`,
            `round-trip mismatch:  ${mismatches.length}`,
            `normaliser crash:     ${crashes.length}`,
            `grammar syntax error: ${syntaxErrors.length}`,
        ].join('\n');

        // Group the crashes by message before reporting: one normaliser bug usually shows up on
        // dozens of files, and the distinct messages are what a reader needs.
        const summarise = (
            label: string,
            samples: Sample[],
            limit = 8,
        ): string => {
            if (!samples.length) return '';
            const byMessage = new Map<string, string[]>();
            for (const s of samples) {
                const files = byMessage.get(s.message) ?? [];
                files.push(s.file);
                byMessage.set(s.message, files);
            }
            const lines = [...byMessage.entries()]
                .slice(0, limit)
                .map(([message, group]) => {
                    const shown = group
                        .slice(0, 3)
                        .map((f) => `      ${relative(process.cwd(), f)}`);
                    const more =
                        group.length > 3
                            ? `\n      … and ${group.length - 3} more`
                            : '';
                    return `    ${group.length}× ${message}\n${shown.join('\n')}${more}`;
                });
            return `\n\n--- ${label} ---\n${lines.join('\n')}`;
        };

        // A crash is the sharper failure, so report those details first.
        expect(
            crashes.length,
            `${report}${summarise('NORMALISER CRASHES (bugs in our code, must be 0)', crashes)}`,
        ).toBe(0);

        expect(
            mismatches.length,
            `${report}${summarise('ROUND-TRIP MISMATCHES (bugs in our code, must be 0)', mismatches)}`,
        ).toBe(0);

        // Syntax errors are expected — but only on the negative fixtures and the documented
        // deviations. Anything else means the grammar lost coverage, which is a real regression.
        const unexpected = syntaxErrors.filter(
            (s) => !isNegativeFixture(s.file),
        );
        if (process.env.MOTOKO_CORPUS_STRICT) {
            const allowed = new Set(
                (process.env.MOTOKO_CORPUS_ALLOWED ?? '')
                    .split(':')
                    .filter(Boolean)
                    .map((p) => relative(process.cwd(), p)),
            );
            const notAllowed = unexpected.filter(
                (s) => !allowed.has(relative(process.cwd(), s.file)),
            );
            expect(
                notAllowed.length,
                `${report}\n\n${summarise('UNEXPECTED SYNTAX ERRORS (not on the deviation list)', notAllowed)}`,
            ).toBe(0);
        }

        // Log the aggregate either way, so the numbers are visible in CI output rather than only
        // implied by the assertions passing.
        console.log(
            `${report}\n  (${unexpected.length} syntax error(s) outside test/fail — see docs/grammar-deviations.md)`,
        );
    });

    test('the corpus is actually being scanned', () => {
        // Guards the guard: if the roots resolved to nothing, every assertion above would pass
        // vacuously. `describe.skipIf` covers the local case; this covers a CI job whose checkout
        // landed somewhere unexpected.
        expect(files.length).toBeGreaterThan(100);
    });
});
