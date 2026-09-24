// Generate the refusal fixtures from the legacy ledger.
//
// `tests/format/**` cannot hold them. `tests/format.test.ts` globs every `.mo` under its root and
// asserts `resolves.toMatchSnapshot()`, so a fixture whose format call *rejects* fails the suite, and
// the only fixes are to special-case the area out of the glob (an edit to the file that owns the
// shared serial snapshot) or to snapshot a throw (impossible). The 47 legacy cases that throw
// therefore live in a sibling root, `tests/refusals/`, which the format glob never sees.
//
// The split is by *suite*, not by directory-in-the-ledger, and it is not cosmetic: `organize/**` is
// formatted under `{...OPTIONS, motokoOrganizeImports: true}` and `parse/**` under the base OPTIONS.
// All 10 organize throws come from the **initial parse**, before `organizeImportSection` can decline,
// so they assert the same contract as the parse ones — but they are kept separate because the option
// is what a reader needs to reproduce the case.
//
// Usage: node tools/refusal-fixtures.mjs [--check]

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/kamil.listopad/prettier-plugin-motoko';
const OUT = join(ROOT, 'tests/refusals');
const check = process.argv.includes('--check');
const verify = process.argv.includes('--verify');

const ledger = createRequire(import.meta.url)('../.probe/port-ledger.json');

/**
 * A legacy name to a filesystem slug. The names are suite labels, not paths: they carry spaces,
 * slashes, backticks, `*`, `@` and `:`. Slashes are the interesting ones — `variants / text
 * concatenation` is one name, not a directory and a file — so they collapse to `-` like every other
 * run of punctuation.
 */
const slug = (name) =>
    name
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();

/**
 * The ledger's throwing rows, grouped by (suite, input) because the fixtures are per *input*.
 *
 * Two inputs are shared by two cases each (`trailing comma in square brackets[4]`/`[5]` and
 * `type binding line breaks[0]`/`[1]`), and six names contribute several distinct inputs. So the
 * grouping is by content, the alias list is recorded in each file's header, and a name that supplied
 * more than one input takes an index suffix to keep the paths unique.
 */
const groups = new Map();
for (const c of ledger.cases) {
    if (!c.threw) continue;
    const key = `${c.suite}\u0000${c.input}`;
    if (!groups.has(key)) {
        groups.set(key, { suite: c.suite, input: c.input, cases: [] });
    }
    groups.get(key).cases.push(c);
}

const perName = new Map();
for (const g of groups.values()) {
    perName.set(g.cases[0].name, (perName.get(g.cases[0].name) ?? 0) + 1);
}

/** The written files, so `--check` and the summary can report without re-walking the tree. */
const written = [];

for (const g of groups.values()) {
    const name = g.cases[0].name;
    const dir = g.suite === 'organizeImports' ? 'organize' : 'parse';
    // A name with several inputs needs a suffix; the ordinal is its position among that name's rows,
    // which is stable because the ledger is generated in registration order.
    const ordinal = g.cases[0].index;
    const suffix = perName.get(name) > 1 ? `-${ordinal}` : '';
    const rel = `${dir}/${slug(name)}${suffix}.mo`;
    const aliases = g.cases.map((c) => `${c.name}[${c.index}]`).join(', ');

    // The header is a leading `//` doc-comment, the convention `tests/format/**` already uses for a
    // fixture that carries its own verdict inline. It is a real part of the program — which is why
    // `--verify` re-runs every input through the pinned moc *with* the header and fails if the
    // comment changed what the input does.
    const header = [
        `// Refusal fixture: the pinned moc rejects this input too, so the formatter rejects it.`,
        `//`,
        `// Legacy case(s): ${aliases}`,
        `//`,
        `// Contract: the parse rejects with a MotokoSyntaxError carrying a \`loc\`. The message and the`,
        `// exact line/column are deliberately NOT asserted — both move whenever parser recovery is`,
        `// improved, and neither is a rule the rework is trying to preserve. See tests/refusals.test.ts.`,
    ].join('\n');

    const body = `${header}\n${g.input}`;
    written.push({ rel, body, input: g.input });
}

let drift = 0;
for (const { rel, body } of written) {
    const path = join(OUT, rel);
    if (check) {
        const fs = await import('node:fs');
        const actual = existsSync(path) ? fs.readFileSync(path, 'utf8') : null;
        if (actual !== body) {
            console.error(`DRIFT ${rel}`);
            drift += 1;
        }
        continue;
    }
    mkdirSync(join(OUT, rel.split('/')[0]), { recursive: true });
    writeFileSync(path, body);
}

if (check) {
    console.log(
        drift === 0
            ? `${written.length} refusal fixtures reproduce the ledger`
            : `${drift} drifted`,
    );
    process.exitCode = drift === 0 ? 0 : 1;
} else {
    const parse = written.filter((w) => w.rel.startsWith('parse/')).length;
    const organize = written.length - parse;
    console.log(
        `wrote ${written.length} refusal fixtures (parse ${parse}, organize ${organize})`,
    );
    for (const { rel } of written) console.log(`  tests/refusals/${rel}`);
}

if (verify) {
    // The two claims the fixtures rest on, checked rather than asserted: (1) the body under the
    // header is exactly a legacy input, and (2) the header comment does not change what moc does
    // with it. If (2) ever fails, the fixture is asserting the comment rather than the input.
    const MOC = '/tmp/mocnow/moc';
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const scratch = mkdtempSync(join(tmpdir(), 'refusal-verify-'));

    const rejects = (source, tag) => {
        const file = join(scratch, `${tag}.mo`);
        writeFileSync(file, source);
        let out = '';
        try {
            out = execFileSync(MOC, ['-dp', file], {
                encoding: 'utf8',
                stdio: 'pipe',
            });
        } catch (error) {
            out = String(error.stdout ?? '') + String(error.stderr ?? '');
        }
        return out.includes('syntax error');
    };

    let bad = 0;
    for (const [i, { rel, body, input }] of written.entries()) {
        const bare = rejects(input, `bare-${i}`);
        const withHeader = rejects(body, `hdr-${i}`);
        if (!bare) {
            console.error(`MOC ACCEPTS ${rel} — not a refusal`);
            bad += 1;
        } else if (bare !== withHeader) {
            console.error(
                `HEADER CHANGES ${rel} — the comment alters the input`,
            );
            bad += 1;
        }
    }
    console.log(
        bad === 0
            ? `\nall ${written.length} verified: moc rejects each, header is inert`
            : `\n${bad} bad`,
    );
    process.exitCode = bad === 0 ? 0 : 1;
}
