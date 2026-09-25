import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import prettier from 'prettier';

import pkg from '../../../package.json' with { type: 'json' };
import plugin from '../../../src/index.ts';

export interface Io {
    cwd: string;
    readStdin: () => Promise<string>;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
}

const USAGE = `Usage: mo-fmt [--check] <file or directory>...
       mo-fmt --stdin-filepath <path> < input.mo

Formats Motoko files in place with the options in .prettierrc and .editorconfig.
Files matched by .gitignore or .prettierignore are skipped.

  -c, --check                  list the files that would change, and exit 1 if any would
      --stdin-filepath <path>  format stdin as the file at <path>, and print the result
  -h, --help
  -v, --version
`;

/** Exit codes: 0 done, 1 `--check` found unformatted files, 2 usage error or a file failed to format. */
export async function main(args: string[], io: Io): Promise<number> {
    let parsed;
    try {
        parsed = parseArgs({
            args,
            allowPositionals: true,
            options: {
                check: { type: 'boolean', short: 'c' },
                'stdin-filepath': { type: 'string' },
                help: { type: 'boolean', short: 'h' },
                version: { type: 'boolean', short: 'v' },
            },
        });
    } catch (error) {
        io.stderr(`${(error as Error).message}\n\n${USAGE}`);
        return 2;
    }
    const { values, positionals } = parsed;

    if (values.help) {
        io.stdout(USAGE);
        return 0;
    }
    if (values.version) {
        io.stdout(`${pkg.version}\n`);
        return 0;
    }

    const ignorePath = ['.gitignore', '.prettierignore'].map((f) =>
        join(io.cwd, f),
    );
    const ignored = async (file: string) =>
        (await prettier.getFileInfo(file, { ignorePath })).ignored;

    const stdinPath = values['stdin-filepath'];
    if (stdinPath !== undefined) {
        const file = resolve(io.cwd, stdinPath);
        const source = await io.readStdin();
        try {
            io.stdout(
                (await ignored(file)) ? source : await format(file, source),
            );
            return 0;
        } catch (error) {
            io.stderr(`${stdinPath}: ${(error as Error).message}\n`);
            return 2;
        }
    }

    if (positionals.length === 0) {
        io.stderr(USAGE);
        return 2;
    }

    let failed = false;
    const files: string[] = [];
    for (const path of positionals) {
        const absolute = resolve(io.cwd, path);
        let isDirectory: boolean;
        try {
            isDirectory = (await stat(absolute)).isDirectory();
        } catch {
            io.stderr(`${path}: no such file or directory\n`);
            failed = true;
            continue;
        }
        if (isDirectory) {
            files.push(...(await motokoFiles(absolute)));
        } else if (extname(absolute) === '.mo') {
            files.push(absolute);
        } else {
            io.stderr(`${path}: not a Motoko file\n`);
            failed = true;
        }
    }

    let checked = 0;
    const changed: string[] = [];
    for (const file of new Set(files)) {
        if (await ignored(file)) continue;
        checked += 1;
        const name = relative(io.cwd, file);
        try {
            const source = await readFile(file, 'utf8');
            const output = await format(file, source);
            if (output === source) continue;
            changed.push(name);
            if (!values.check) await writeFile(file, output);
            io.stdout(`${name}\n`);
        } catch (error) {
            io.stderr(`${name}: ${(error as Error).message}\n`);
            failed = true;
        }
    }

    const noun = checked === 1 ? 'file' : 'files';
    if (values.check) {
        io.stdout(
            changed.length === 0
                ? `All ${checked} ${noun} are formatted.\n`
                : `${changed.length} of ${checked} ${noun} need formatting.\n`,
        );
    } else {
        io.stdout(`Formatted ${changed.length} of ${checked} ${noun}.\n`);
    }
    if (failed) return 2;
    return values.check && changed.length > 0 ? 1 : 0;
}

async function format(file: string, source: string): Promise<string> {
    const config = await prettier.resolveConfig(file, { editorconfig: true });
    // The bundled plugin replaces any `plugins` in the config, which name packages mo-fmt can't load.
    return prettier.format(source, {
        ...config,
        filepath: file,
        plugins: [plugin],
    });
}

/** The `.mo` files under `dir`, skipping `node_modules` and dot-directories such as `.git` and `.mops`. */
async function motokoFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && !entry.name.startsWith('.'))
                out.push(...(await motokoFiles(path)));
        } else if (entry.isFile() && extname(entry.name) === '.mo') {
            out.push(path);
        }
    }
    return out.sort();
}
