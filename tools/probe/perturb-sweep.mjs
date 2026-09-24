/**
 * The perturbation sweep runner: apply every perturbation in `perturbations.mjs` to real corpus files,
 * and check the printer survives each one that moc still accepts.
 *
 *     node tools/probe/perturb-sweep.mjs [--files N] [--seed-free] [--require-moc]
 *
 * Exits non-zero when the printer fails on a perturbation that moc accepts. That is the whole
 * contract: this is a gate, not a report. Failures on input moc *rejects* are counted separately and
 * do not fail the run, because the printer and moc disagreeing about what is legal is a different,
 * lesser finding than a crash on valid code — reporting them together is what would make the output
 * unactionable.
 *
 * ## What a case has to pass
 *
 * Three independent questions, and the case must satisfy all three:
 *
 *   - **guard / no crash**: the printer's own semantic guard re-parses its output and throws on any
 *     token-level change (`src/verify.ts`). A throw here is a real bug, not a layout choice.
 *   - **idempotence**: a second pass over the output must be a fixed point.
 *   - **moc**: the output must parse under moc, using the same `-dp` oracle the corpus harness uses.
 *     Not `--check` and not the exit code — see `tools/corpus/lib/moc-oracle.mjs` for why neither is
 *     usable as a validity signal. `parseTree` is the right primitive here for a second reason: it
 *     returns null for a syntax error, so it answers "is this valid" and "what tree is this" with the
 *     same call, and its banner/anonymous-name normalisation is shared with the corpus rather than
 *     reimplemented.
 *
 * ## Running it without moc
 *
 * The validity filter is what makes the numbers readable, and it needs moc. Without a moc binary the
 * run does not quietly report zero failures — it reports how many cases it could *not* check, and
 * `--require-moc` turns that absence into a failure for CI. A sweep that silently passes because its
 * oracle is missing is exactly the failure mode this file is written to avoid.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERTURBATIONS } from './perturbations.mjs';
import { findMoc, parseTree } from '../corpus/lib/moc-oracle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

// --- options ---------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name) {
    return argv.includes(name);
}
function value(name, fallback) {
    const i = argv.indexOf(name);
    return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
}

const MAX_FILES = Number(value('--files', process.env.SWEEP_FILES ?? 60));
const requireMoc = flag('--require-moc');

/**
 * The corpus roots, in the same layout `tests/corpus.test.ts` assumes: `motoko` and `motoko-core` as
 * siblings of this repo. Roots that are absent are skipped rather than failed on — a developer with a
 * partial checkout should still be able to run the sweep over the fixtures they do have.
 */
function roots() {
    const fromEnv = process.env.MOTOKO_CORPUS_ROOTS;
    if (fromEnv) return fromEnv.split(':').filter(Boolean);
    return [
        join(repoRoot, '..', 'motoko', 'test', 'run'),
        join(repoRoot, '..', 'motoko', 'test', 'repl'),
        join(repoRoot, '..', 'motoko-core', 'src'),
    ];
}

const SKIP_DIRS = new Set([
    '.git',
    'node_modules',
    'target',
    '.direnv',
    '_build',
    '_out',
]);

function walk(dir, out) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const p = join(dir, entry.name);
        let s;
        try {
            s = statSync(p);
        } catch {
            continue;
        }
        if (s.isDirectory()) walk(p, out);
        else if (entry.name.endsWith('.mo')) out.push(p);
    }
    return out;
}

// --- the sweep -------------------------------------------------------------------------------------

const moc = findMoc(join(repoRoot, '..', 'motoko'));
if (!moc) {
    const msg =
        'perturb-sweep: no moc binary found, so perturbations cannot be validity-filtered. ' +
        'Set MOC=/path/to/moc (see tools/corpus/lib/moc-oracle.mjs for the paths searched).';
    if (requireMoc) {
        console.error(msg);
        process.exit(1);
    }
    console.log(
        `${msg}\nEvery perturbation would be unchecked; reporting that rather than 0 failures.`,
    );
}

// The plugin is imported the same way the corpus harness does it: `src/` directly, so the sweep
// measures the working tree and not a stale `lib/`. Node >= 22.6 strips the types on import.
const prettier = (await import('prettier')).default;
const plugin = (
    await import(new URL('../../src/index.ts', import.meta.url).href)
).default;
const opts = {
    parser: 'motoko',
    plugins: [plugin],
    printWidth: 80,
    tabWidth: 2,
};

/** moc validity via the shared oracle: `null` means moc produced no dump, i.e. a syntax error. */
const syntaxErrors = (src) => (parseTree(moc, src, 'perturb') === null ? 1 : 0);

const files = [];
for (const root of roots()) walk(root, files);

const findings = [];
let checked = 0;
let skippedNoMoc = 0;
let skippedInvalid = 0;
let filesUsed = 0;

for (const file of files.slice(0, MAX_FILES)) {
    const original = readFileSync(file, 'utf8');
    // Only perturb files moc already accepts; otherwise a "failure" might just be the fixture.
    if (moc && syntaxErrors(original) !== 0) continue;
    filesUsed += 1;
    for (const [name, perturb] of Object.entries(PERTURBATIONS)) {
        for (const input of perturb(original)) {
            if (!moc) {
                skippedNoMoc += 1;
                continue;
            }
            if (syntaxErrors(input) !== 0) {
                skippedInvalid += 1;
                continue;
            }
            checked += 1;
            let status = null;
            let message = '';
            try {
                const once = await prettier.format(input, opts);
                const twice = await prettier.format(once, opts);
                if (once !== twice) {
                    status = 'nonidem';
                    message = 'output is not a fixed point';
                } else if (syntaxErrors(once) !== 0) {
                    status = 'output-invalid';
                    message = 'output does not parse under moc';
                }
            } catch (e) {
                status = 'throw';
                message = (e && e.message ? e.message : String(e)).split(
                    '\n',
                )[0];
            }
            if (status) {
                findings.push({
                    file: relative(repoRoot, file),
                    perturbation: name,
                    status,
                    message,
                    repro: input,
                });
            }
        }
    }
}

// --- report ----------------------------------------------------------------------------------------

console.log(
    `swept ${filesUsed} files: ${checked} perturbations checked, ${skippedInvalid} skipped ` +
        `(moc rejects the perturbed input)` +
        (moc ? '' : `, ${skippedNoMoc} UNCHECKED (no moc)`),
);

if (findings.length === 0) {
    console.log(
        moc
            ? 'no printer failures on moc-valid perturbations'
            : 'no printer failures -- but with no moc the filter did not run, so this is not evidence',
    );
} else {
    console.log(`\n${findings.length} FAILURES:`);
    const byKind = new Map();
    for (const f of findings) {
        const k = `${f.perturbation} | ${f.status} | ${f.message.slice(0, 60)}`;
        byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(n).padStart(4)}  ${k}`);
    }
    console.log('\n--- first three repros ---');
    for (const f of findings.slice(0, 3)) {
        console.log(
            `\n[${f.file}] ${f.perturbation} (${f.status})\n${f.message}\n--- input ---\n` +
                `${f.repro.slice(0, 600)}`,
        );
    }
}

process.exit(findings.length === 0 ? 0 : 1);
