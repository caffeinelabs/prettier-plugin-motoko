/**
 * Measure the `docs/style.md:114-130` rule exactly as written:
 *
 *   "If a file has imports, print exactly one blank line after the last import, before the first
 *    declaration. If the file has no imports, print no leading blank line."
 *
 * So the question is about the LAST import of a run, not about every import — an import block is
 * contiguous, and only its end meets a declaration. Measured on the source, since the source is what
 * the rule will be applied to.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const roots = [
    join(repoRoot, '..', 'motoko', 'test'),
    join(repoRoot, '..', 'motoko-core', 'src'),
    join(repoRoot, 'tests', 'fixtures'),
];
const SKIP = new Set(['_out', '_build', 'node_modules', '.git']);
const files: string[] = [];
for (const root of roots)
    (function w(d: string) {
        let es;
        try {
            es = readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of es) {
            const p = join(d, e.name);
            if (e.isDirectory()) {
                if (!SKIP.has(e.name)) w(p);
            } else if (e.name.endsWith('.mo')) files.push(p);
        }
    })(root);
// Top-level import lines: source-order scan, stopping the import run at the first non-import,
// non-blank, non-comment line.
let withImports = 0,
    lastImportGlued = 0,
    lastImportTwoPlus = 0,
    noImportsLeading = 0;
const glued: string[] = [],
    extra: string[] = [];
for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    let i = 0,
        last = -1;
    // skip leading blanks/comments to the first import run
    for (; i < lines.length; i++) {
        const t = lines[i];
        if (t.trim() === '' || /^\s*(\/\/|\/\*|\*)/.test(t)) continue;
        if (/^\s*import\b/.test(t)) {
            last = i;
            i++;
            break;
        }
        break;
    }
    if (last >= 0) {
        // continue the run: imports, blanks and comments between them
        for (let j = last + 1; j < lines.length; j++) {
            const t = lines[j];
            if (/^\s*import\b/.test(t)) {
                last = j;
                continue;
            }
            if (t.trim() === '' || /^\s*(\/\/|\/\*|\*)/.test(t)) continue;
            break;
        }
        withImports++;
        const after = lines.slice(last + 1);
        const k = after.findIndex(
            (l) => l.trim() !== '' && !/^\s*(\/\/|\/\*|\*)/.test(l),
        );
        if (k >= 0) {
            const blank = after
                .slice(0, k)
                .filter((l) => l.trim() === '').length;
            if (blank === 0) {
                lastImportGlued++;
                if (glued.length < 10)
                    glued.push(
                        f.replace(repoRoot + '/', '').replace('../', ''),
                    );
            } else if (blank > 1) {
                lastImportTwoPlus++;
                if (extra.length < 5)
                    extra.push(
                        `${f.replace(repoRoot + '/', '').replace('../', '')} (${blank})`,
                    );
            }
        }
    } else if (
        lines[0] !== undefined &&
        lines[0].trim() === '' &&
        lines.some((l) => l.trim() !== '')
    ) {
        noImportsLeading++;
    }
}
console.log(`files whose first declaration run is imports: ${withImports}`);
console.log(
    `  last import NOT followed by a blank line (rule wants one): ${lastImportGlued}`,
);
console.log(
    `  last import followed by 2+ blank lines (rule wants one):  ${lastImportTwoPlus}`,
);
console.log(
    `files with no imports and a leading blank line: ${noImportsLeading}`,
);
console.log('\nglued samples:');
glued.forEach((s) => console.log('  - ' + s));
console.log('\n2+ samples:');
extra.forEach((s) => console.log('  - ' + s));
