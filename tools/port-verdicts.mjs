// Assign each legacy case its port verdict, from the ledger rather than from prose.
//
// The triage doc's three verdicts (`keep` / `change` / `delete`) are prose today: they name groups of
// legacy test *names* and explain why. Prose cannot be checked, and the doc's own instruction is that
// "each of those cases needs a verdict from the ledger rather than from this prose". So this tool
// derives the verdict per case and writes a machine-readable list, which the fixture writer consumes
// so the note on each fixture is the measured difference rather than a re-reading.
//
// The rules, in order:
//
//   * a case that throws is `delete` — it cannot be a `tests/format/**` fixture at all; its refusal is
//     pinned by `tests/refusals/` instead (see tools/refusal-fixtures.mjs). Recording it keeps the
//     tally honest, since "deleted as a bug" is a legitimately different disposition.
//   * a case that already matches 0.13 and is a fixed point is `keep` — nothing to reconcile.
//   * a case that differs is `change`, and its note carries the *measured* difference: the first
//     line that differs and both spellings, classified into a small set of mechanisms (spacing after
//     `??`, the semicolon rule, comment re-spelling, …), so a reviewer sees what moved instead of
//     being told to trust it.
//
// Usage: node tools/port-verdicts.mjs [--json]

import { createRequire } from 'node:module';

const ledger = createRequire(import.meta.url)('../.probe/port-ledger.json');

if (!ledger.cases) {
    console.error(
        'the ledger has no `cases`; regenerate it with `node tools/legacy-port.mjs`',
    );
    process.exit(2);
}

/**
 * The mechanism a diff is an instance of, read off the text rather than assumed.
 *
 * Ordered most-specific first: every one of these is a claim about *why* the new engine differs, and
 * a wrong label here is exactly the kind of thing this file exists to make checkable, so each is
 * narrow enough to re-measure by eye.
 */
function classify(input, legacy, output) {
    // The `??` family: the same token confusion, in whichever direction 0.13 got it wrong.
    //
    //   * 0.13 dropped the space *after* the operator (`a ?? b` -> `a ??b`), which moc cannot lex,
    //     because the `??` token's trailing whitespace is part of the token.
    //   * and for `? ?a` it did the reverse: it *joined* two separate option tokens into one `??`,
    //     which is a different token sequence and so a different program.
    //
    // Both are the same mistake about what `??` is; the new engine preserves what the source wrote,
    // which is correct in both directions. This is the only cluster where 0.13's output is not
    // merely a different layout but a different (or unparseable) program.
    const legacyCoalesces = /[^?\s]\s*\?\?\S/.test(legacy);
    const outputCoalesces = /[^?\s]\s*\?\?\S/.test(output);
    const legacyJoins = /\?\?/.test(legacy.replace(/\?\?\s/g, ' '));
    const outputKeepsApart = /\?\s+\?/.test(output);
    if (legacyCoalesces && !outputCoalesces) {
        return {
            kind: '`??` spacing',
            note: '`??` spacing (0.13 emitted `a ??b`, a syntax error)',
        };
    }
    if (legacyJoins && outputKeepsApart) {
        return {
            kind: '`??` spacing',
            note: '`??` spacing (0.13 joined `? ?` into one `??`, a different program)',
        };
    }

    // Each tier below is a *weaker* claim than the one above it: it erases more of the difference
    // and, if the two sides then agree, says what the difference was. Taking the first tier that
    // matches gives the strongest true statement about the diff — which is the point, since a label
    // like "layout" on 59 cases tells a reviewer nothing.
    //
    // Order matters and whitespace-erasure must come *late*: it is such a weak claim that it swallows
    // almost every pretty-printing diff into one bucket, which is the "no single cause dominates"
    // trap this whole file exists to avoid. So the two separator rules are tested on their own
    // first, then the token stream, and only then do the layout tiers get to speak — and then they
    // say *which direction* the layout moved, because "0.13 expanded a group that fits" and "0.13
    // collapsed a group the source had spread" are different behaviours with different fixes.
    //
    // Both separator rules are two-directional — 0.13 added a `;` the source lacked and also dropped
    // one, and it added a `,` before a closer and also dropped one — so each note says which way,
    // and carries the count, because the magnitude is what a reviewer wants to see.
    const count = (s, re) => (s.match(re) ?? []).length;
    const semis = (s) => count(s, /;/g);
    const delims = (s) => count(s, /,(\s*[)\]])/g);
    const stripSemis = (s) => s.replace(/;/g, '');
    const stripDelims = (s) => s.replace(/,(\s*[)\]])/g, '$1');

    const semisNote = () => {
        const n = semis(legacy) - semis(output);
        if (n === 0) return '';
        return n > 0
            ? `the semicolon rule (0.13 added ${n} trailing \`;\`)`
            : 'the semicolon rule (0.13 dropped a `;`)';
    };
    const delimsNote = () => {
        const n = delims(legacy) - delims(output);
        if (n === 0) return '';
        return n > 0
            ? 'the trailing-delimiter rule (0.13 added a `,` before a closer)'
            : 'the trailing-delimiter rule (0.13 dropped a `,` before a closer)';
    };
    const separatorNotes = () => [semisNote(), delimsNote()].filter(Boolean);

    // Exact agreement once a separator is erased: that separator is the whole difference.
    if (semisNote() && stripSemis(legacy) === stripSemis(output)) {
        return { kind: 'the semicolon rule', note: semisNote() };
    }
    if (delimsNote() && stripDelims(legacy) === stripDelims(output)) {
        return { kind: 'the trailing-delimiter rule', note: delimsNote() };
    }
    if (
        separatorNotes().length &&
        stripSemis(stripDelims(legacy)) === stripSemis(stripDelims(output))
    ) {
        return {
            kind: 'the separator rules',
            note: separatorNotes().join('; '),
        };
    }

    // Tokens equal (modulo separators): the difference is purely where the breaks went.
    const stripTok = (s) => stripSemis(stripDelims(s)).replace(/\s+/g, '');
    if (stripTok(legacy) === stripTok(output)) {
        const lines = (s) => s.trimEnd().split('\n').length;
        const detail = `${lines(legacy)} lines vs ${lines(output)}`;
        const note = [...separatorNotes(), detail].join('; ');
        if (lines(legacy) > lines(output)) {
            return {
                kind: '0.13 expanded groups that fit',
                note: `0.13 expanded groups that fit — ${note}`,
            };
        }
        if (lines(legacy) < lines(output)) {
            return {
                kind: '0.13 collapsed groups the source had spread',
                note: `0.13 collapsed groups the source had spread — ${note}`,
            };
        }
        return {
            kind: 'breaks placed differently',
            note: `breaks placed differently — ${note}`,
        };
    }

    // Comments printed verbatim, so the only thing left to differ may be *which spelling* of a
    // comment they are: 0.13 converted `//` to `/* */` (inside `<…>`, where a line comment would
    // swallow the rest of the generic list), which the rework forbids. Both directions are worth
    // naming — this is the one place the two engines disagree about a token's spelling rather than
    // its position. Erasing the comments entirely and finding the tokens agree is what makes it a
    // claim about the spelling rather than a catch-all.
    const noComments = (s) =>
        s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (stripTok(noComments(legacy)) === stripTok(noComments(output))) {
        return {
            kind: 'comments re-spelled',
            note: 'comments re-spelled (0.13 converted `//` to `/* */`)',
        };
    }

    // The blank-line rules: at most one kept, never invented.
    const squash = (s) => s.replace(/\n{3,}/g, '\n\n');
    if (
        squash(legacy) === squash(output) ||
        squash(legacy).trim() === squash(output).trim()
    ) {
        return {
            kind: 'blank lines',
            note: 'blank lines (at most one kept, never invented)',
        };
    }

    // Operator/operand spacing generally (`1-1` vs `1 - 1`, `a  ??  b` kept as written): white space
    // inside a line that both sides otherwise agree on.
    const despace = (s) => s.replace(/[ \t]+/g, ' ');
    if (
        despace(legacy).replace(/ ?([-+*/<>=|&^.,;(){}[\]]|[?!]+) ?/g, '$1') ===
        despace(output).replace(/ ?([-+*/<>=|&^.,;(){}[\]]|[?!]+) ?/g, '$1')
    ) {
        return {
            kind: "the source's own spacing kept",
            note: "the source's own spacing kept (the `preserve` contract)",
        };
    }

    return { kind: 'layout', note: 'layout' };
}

/** The first line whose text differs, as `line N: legacy | new`, or null when they agree. */
function firstDiff(legacy, output) {
    const a = legacy.split('\n');
    const b = output.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if (a[i] !== b[i]) {
            return {
                line: i + 1,
                legacy: (a[i] ?? '<none>').trim(),
                output: (b[i] ?? '<none>').trim(),
            };
        }
    }
    return null;
}

const verdicts = [];
for (const c of ledger.cases) {
    if (c.threw) {
        verdicts.push({
            ...pick(c),
            verdict: 'delete',
            reason: 'refused by the compiler; pinned by tests/refusals/',
        });
        continue;
    }
    if (c.matchesLegacy) {
        verdicts.push({ ...pick(c), verdict: 'keep', reason: null });
        continue;
    }
    const diff = firstDiff(c.legacy ?? '', c.output ?? '');
    verdicts.push({
        ...pick(c),
        verdict: 'change',
        ...(() => {
            const m = classify(c.input, c.legacy ?? '', c.output ?? '');
            return { mechanism: m.kind, note: m.note };
        })(),
        diff,
    });
}

/** Only the fields a writer needs; the ledger's own copy of the text is already on disk. */
function pick(c) {
    return {
        suite: c.suite,
        name: c.name,
        index: c.index,
        idempotent: c.idempotent,
    };
}

const counts = {};
for (const v of verdicts) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;

if (process.argv.includes('--json')) {
    console.log(JSON.stringify(verdicts, null, 1));
} else {
    console.log(`cases ${verdicts.length}`);
    for (const [k, n] of Object.entries(counts))
        console.log(`  ${k.padEnd(7)} ${n}`);
    console.log(
        '\n=== change mechanisms (grouped; `note` on each case carries the numbers) ===',
    );
    const mech = {};
    for (const v of verdicts) {
        if (v.verdict !== 'change') continue;
        (mech[v.mechanism] ??= []).push(v.note);
    }
    for (const [m, notes] of Object.entries(mech).sort(
        (a, b) => b[1].length - a[1].length,
    )) {
        console.log(`  ${String(notes.length).padStart(3)}  ${m}`);
    }
    console.log('\n=== delete by name ===');
    const del = {};
    for (const v of verdicts)
        if (v.verdict === 'delete') del[v.name] = (del[v.name] ?? 0) + 1;
    for (const [n, k] of Object.entries(del).sort((a, b) => b[1] - a[1]))
        console.log(`  ${String(k).padStart(3)}  ${n}`);

    // The disposition, per legacy *name* — which is the unit the triage doc speaks in ("the group
    // verdicts below are per name"), and the unit a fixture is written for. A name whose cases are
    // all `keep` needs nothing; a name with `change` cases needs a fixture; a name that is all
    // `delete` is a pointer at `tests/refusals/`.
    //
    // `work` is deliberately *not* the change count. A name whose only difference is the semicolon
    // rule needs no fixture: the rule is pinned once in `semicolons.md`'s own fixtures and is
    // applied uniformly by the printer, so re-encoding 35 cases of it would be 35 copies of one
    // assertion. The number a reviewer wants is cases needing *a distinct fixture*, so that is what
    // the column reports, with the arithmetic in the columns beside it.
    const WORK = new Set([
        'breaks placed differently',
        '0.13 expanded groups that fit',
        '0.13 collapsed groups the source had spread',
        '`??` spacing',
        'the trailing-delimiter rule',
        'comments re-spelled',
        'the separator rules',
    ]);
    console.log(
        '\n=== disposition by name (name  total  keep chg del  need-fixture  mechanisms) ===',
    );
    const byName = new Map();
    for (const v of verdicts) {
        if (!byName.has(v.name)) {
            byName.set(v.name, {
                total: 0,
                keep: 0,
                change: 0,
                delete: 0,
                work: 0,
                mechs: new Set(),
            });
        }
        const r = byName.get(v.name);
        r.total += 1;
        r[v.verdict] += 1;
        if (v.verdict !== 'change') continue;
        r.mechs.add(v.mechanism);
        if (WORK.has(v.mechanism)) r.work += 1;
    }
    const rows = [...byName.entries()].sort(
        (a, b) =>
            b[1].work - a[1].work ||
            b[1].total - a[1].total ||
            a[0].localeCompare(b[0]),
    );
    for (const [name, r] of rows) {
        console.log(
            `  ${name.padEnd(56)} ${String(r.total).padStart(3)} ${String(r.keep).padStart(3)}` +
                ` ${String(r.change).padStart(4)} ${String(r.delete).padStart(4)}` +
                ` ${String(r.work).padStart(4)}     ${[...r.mechs].join(' / ')}`,
        );
    }
    const totalWork = rows.reduce((n, [, r]) => n + r.work, 0);
    const noWork = rows.filter(([, r]) => r.work === 0).length;
    console.log(
        `\n  ${rows.length} names; ${noWork} need no fixture; ${totalWork} cases across ` +
            `${rows.length - noWork} names do.`,
    );
}
