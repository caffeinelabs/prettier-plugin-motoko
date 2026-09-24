// Inputs moc rejects: the formatter must reject them too, with a located error and a code frame.
// Each directory under `tests/refusals/` is formatted with the options in `AREA_OPTIONS`.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import prettier from 'prettier';
import { describe, expect, test } from 'vitest';

import plugin from '../src/index.ts';
import { MotokoSyntaxError } from '../src/parser/parse.ts';

const ROOT = join(import.meta.dirname, 'refusals');

const OPTIONS: prettier.Options = { parser: 'motoko', plugins: [plugin] };

const AREA_OPTIONS: Record<string, prettier.Options> = {
    organize: { motokoOrganizeImports: true },
};

const CASES = readdirSync(ROOT).flatMap((area) =>
    readdirSync(join(ROOT, area))
        .filter((name) => name.endsWith('.mo'))
        .sort()
        .map((name) => [`${area}/${name}`, area] as const),
);

describe.each(CASES)('refusals/%s', (name, area) => {
    test('rejects with a located syntax error and a code frame', async () => {
        const source = readFileSync(join(ROOT, name), 'utf8');
        const error = await prettier
            .format(source, { ...OPTIONS, ...AREA_OPTIONS[area] })
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
