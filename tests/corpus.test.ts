import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';

import { MotokoSyntaxError, parse } from '../src/parser/parse.ts';
import { checkRoundTrip } from '../src/parser/normalize.ts';

const repoRoot = join(import.meta.dirname, '..');
const roots = [
    join(repoRoot, '..', 'motoko', 'test'),
    join(repoRoot, '..', 'motoko-core', 'src'),
];

const KNOWN_REJECTIONS = new Set([
    'motoko/test/run-drun/timer.mo',
    'motoko/test/perf/qr/list.mo',
]);

const SKIP_DIRS = new Set(['_out', '_build', 'node_modules', '.git']);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path, out);
        } else if (entry.name.endsWith('.mo')) {
            out.push(path);
        }
    }
    return out;
}

const files = roots.filter((r) => existsSync(r)).flatMap((r) => walk(r));
const required = Boolean(process.env.MOTOKO_CORPUS_REQUIRED);
const display = (file: string) => relative(join(repoRoot, '..'), file);

test.runIf(required)('the corpus is checked out', () => {
    expect(files.length).toBeGreaterThan(1000);
});

describe.skipIf(files.length === 0)('corpus', () => {
    test('every file parses and round-trips, or is a known rejection', async () => {
        const crashes: string[] = [];
        const mismatches: string[] = [];
        const rejected: string[] = [];

        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            try {
                const { root } = await parse(source);
                const mismatch = checkRoundTrip(root, source);
                if (mismatch) {
                    mismatches.push(
                        `${display(file)} at ${mismatch.at}: expected ${mismatch.expected}, got ${mismatch.got}`,
                    );
                }
            } catch (error) {
                if (!(error instanceof MotokoSyntaxError)) {
                    crashes.push(
                        `${display(file)}: ${(error as Error).message}`,
                    );
                } else if (!file.includes('/test/fail/')) {
                    rejected.push(display(file));
                }
            }
        }

        expect(crashes, 'the normaliser threw').toEqual([]);
        expect(mismatches, 'the round-trip lost text').toEqual([]);
        expect(rejected.sort()).toEqual([...KNOWN_REJECTIONS].sort());
    });
});
