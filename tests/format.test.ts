// Snapshots each `tests/format/<area>/*.mo` fixture's formatted output and asserts it is a fixed point.
// Fixtures are deliberately non-canonical inputs, and a separate idempotence check catches a printer that oscillates between passes.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';
import prettier from 'prettier';

import plugin from '../src/index.ts';

const FIXTURE_ROOT = join(import.meta.dirname, 'format');

// Spelled out so no fixture depends on Prettier's defaults.
const OPTIONS: prettier.Options = {
    parser: 'motoko',
    plugins: [plugin],
    printWidth: 80,
    tabWidth: 2,
    trailingComma: 'none',
};

// Options keyed by area directory, since a fixture is a plain `.mo` file with nowhere to carry its own.
const AREA_OPTIONS: Record<string, Record<string, unknown>> = {
    'organize-imports': { motokoOrganizeImports: true },
};

function optionsFor(path: string): prettier.Options {
    const area = relative(FIXTURE_ROOT, path).split('/')[0];
    return { ...OPTIONS, ...(AREA_OPTIONS[area] ?? {}) };
}

function format(source: string, path: string): Promise<string> {
    return prettier.format(source, optionsFor(path));
}

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

// A harness with no fixtures is indistinguishable from one that stopped working.
test('there are fixtures to check', () => {
    expect(FILES.length).toBeGreaterThan(0);
});

describe.each(
    FILES.map((path) => [relative(FIXTURE_ROOT, path), path] as const),
)('format/%s', (name, path) => {
    test('prints as snapshotted', async () => {
        const source = readFileSync(path, 'utf8');
        await expect(format(source, path)).resolves.toMatchSnapshot();
    });

    test('is a fixed point', async () => {
        const source = readFileSync(path, 'utf8');
        const once = await format(source, path);
        const twice = await format(once, path);
        // A bare `toBe` prints two whole files; the first differing line is what the reader needs.
        expect(twice, firstDifferingLine(once, twice)).toBe(once);
    });
});

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
