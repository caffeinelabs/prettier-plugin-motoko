import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import prettier from 'prettier';
import { describe, expect, test } from 'vitest';

import plugin from '../src/index.ts';
import { MotokoSyntaxError } from '../src/parser/parse.ts';

const ROOT = join(import.meta.dirname, 'refusals', 'parse');

const CASES = readdirSync(ROOT)
    .filter((name) => name.endsWith('.mo'))
    .sort();

describe.each(CASES)('refusals/parse/%s', (name) => {
    test('rejects with a located syntax error and a code frame', async () => {
        const source = readFileSync(join(ROOT, name), 'utf8');
        const error = await prettier
            .format(source, { parser: 'motoko', plugins: [plugin] })
            .then(
                () => null,
                (thrown: unknown) => thrown,
            );

        // The specific class tells a parse refusal apart from a runtime guard failure.
        expect(error, `${name} formatted; it must reject`).toBeInstanceOf(
            MotokoSyntaxError,
        );
        const { loc, codeFrame } = error as MotokoSyntaxError;
        expect(loc.start.line).toBeGreaterThanOrEqual(1);
        expect(loc.start.line).toBeLessThanOrEqual(source.split('\n').length);
        expect(codeFrame.length).toBeGreaterThan(0);
    });
});
