import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { describe, expect, test } from 'vitest';

import { main } from '../packages/mo-fmt/src/cli.ts';

const UNFORMATTED = 'let x = f(1,2);\n';
const FORMATTED = 'let x = f(1, 2);\n';

function project(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'mo-fmt-'));
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
    }
    return dir;
}

async function run(cwd: string, args: string[], stdin = '') {
    let stdout = '';
    let stderr = '';
    const code = await main(args, {
        cwd,
        readStdin: async () => stdin,
        stdout: (text) => (stdout += text),
        stderr: (text) => (stderr += text),
    });
    return { code, stdout, stderr };
}

const read = (dir: string, path: string) =>
    readFileSync(join(dir, path), 'utf8');

describe('mo-fmt', () => {
    test('formats the .mo files under a directory in place, skipping node_modules and dot-directories', async () => {
        const dir = project({
            'src/A.mo': UNFORMATTED,
            'src/B.mo': FORMATTED,
            'src/notes.txt': UNFORMATTED,
            'node_modules/x/C.mo': UNFORMATTED,
            '.mops/core/D.mo': UNFORMATTED,
        });
        const { code, stdout } = await run(dir, ['.']);
        expect(code).toBe(0);
        expect(stdout).toBe('src/A.mo\nFormatted 1 of 2 files.\n');
        expect(read(dir, 'src/A.mo')).toBe(FORMATTED);
        expect(read(dir, 'node_modules/x/C.mo')).toBe(UNFORMATTED);
        expect(read(dir, '.mops/core/D.mo')).toBe(UNFORMATTED);
    });

    test('--check lists the files that would change and exits 1, without writing', async () => {
        const dir = project({ 'A.mo': UNFORMATTED, 'B.mo': FORMATTED });
        expect(await run(dir, ['--check', 'A.mo', 'B.mo'])).toEqual({
            code: 1,
            stdout: 'A.mo\n1 of 2 files need formatting.\n',
            stderr: '',
        });
        expect(read(dir, 'A.mo')).toBe(UNFORMATTED);
        expect((await run(dir, ['-c', 'B.mo'])).code).toBe(0);
    });

    test('reads options from .prettierrc, including motokoSyntax', async () => {
        const dir = project({
            '.prettierrc':
                '{ "motokoSyntax": "moc2", "plugins": ["prettier-plugin-motoko"] }',
            'A.mo': 'if (c) x else y;\n',
        });
        await run(dir, ['A.mo']);
        expect(read(dir, 'A.mo')).toBe('if c { x } else { y };\n');
    });

    test('skips files matched by .prettierignore or .gitignore, even when named', async () => {
        const dir = project({
            '.prettierignore': 'gen/\n',
            '.gitignore': 'out.mo\n',
            'gen/A.mo': UNFORMATTED,
            'out.mo': UNFORMATTED,
        });
        const { code, stdout } = await run(dir, ['.', 'out.mo']);
        expect({ code, stdout }).toEqual({
            code: 0,
            stdout: 'Formatted 0 of 0 files.\n',
        });
        expect(read(dir, 'gen/A.mo')).toBe(UNFORMATTED);
    });

    test('a file that fails to parse is reported with its location, exits 2, and the rest are still formatted', async () => {
        const dir = project({ 'A.mo': 'let x = ;\n', 'B.mo': UNFORMATTED });
        const { code, stderr } = await run(dir, ['A.mo', 'B.mo']);
        expect(code).toBe(2);
        expect(stripVTControlCharacters(stderr)).toMatch(
            /^A\.mo: Unexpected input at 1:7\.\n> 1 \| let x = ;/,
        );
        expect(read(dir, 'B.mo')).toBe(FORMATTED);
    });

    test('--stdin-filepath formats stdin with the options for that path', async () => {
        const dir = project({
            'sub/.prettierrc': '{ "motokoSyntax": "moc2" }',
        });
        expect(
            await run(
                dir,
                ['--stdin-filepath', 'sub/A.mo'],
                'while (c) f(1,2);\n',
            ),
        ).toEqual({ code: 0, stdout: 'while c { f(1, 2) };\n', stderr: '' });
    });

    test('usage errors exit 2', async () => {
        const dir = project({ 'notes.txt': '' });
        expect((await run(dir, [])).code).toBe(2);
        expect((await run(dir, ['--nope'])).code).toBe(2);
        expect(await run(dir, ['notes.txt', 'missing.mo'])).toMatchObject({
            code: 2,
            stderr: 'notes.txt: not a Motoko file\nmissing.mo: no such file or directory\n',
        });
    });
});
