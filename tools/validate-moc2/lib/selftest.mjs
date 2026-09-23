// The self-test: prove the harness can fail.
//
// The plan names four known-bad rewrites, each of which a *correct* harness must catch. The point is
// not that these specific rewrites are likely; it is that a level which lets any of them through is
// itself a bug. A harness that passes because it checks nothing is worse than no harness.
//
// The four, with their exact sources:
//
//   1. juxt-head     `if (f x == 0) { a }` -> `if f x == 0 { a }`
//                    The silent misparse #6385 found. Dropping the parens re-associates the head.
//   2. await-head    `if ((await f()) == true) { a }` -> `if await f() == true { a }`
//                    Same class, with `await`. Needs the operands type-correct to be a *parse* change
//                    rather than merely a type error, so the fixture uses `(await f()) == true`.
//   3. func-eq-body  `func f() : Nat = 1` -> `func f() : Nat { 1 }`
//                    Bracing a `func … = e` body. Both type-check, so only the tree levels see it.
//   4. case-or       `case (a or b) { c }` -> `case a or b { c }`
//                    Unwrapping whole-pattern parens on an alternation changes the parse entirely.
//
// For each plant, the self-test runs the level(s) it has (tree comparison via our grammar, and moc's
// `-dp`/`--check`) on both the good and the bad source, and records whether the level *observed* a
// difference. A level that observes a difference has caught the plant. The result table is printed
// and written into the report; the process exits non-zero if a level that should catch a plant does
// not, unless the level is unavailable (no moc), in which case it is reported as skipped-with-reason.
//
// `moc2` itself does not exist yet, so "the level caught it" means "the level distinguishes good from
// bad". A future `moc2` is correct exactly when it never turns a good source into a bad one; that is
// what these plants would detect.

import { createParser, shapeKey, shapeOf } from './grammar.mjs';
import {
    checkLevel,
    findMoc,
    parseTreeLevel,
    sameDiagnostics,
    typedTreeLevel,
} from './moc.mjs';

/**
 * The four plants. `good` is target-shaped; `bad` is the planted regression of it.
 *
 * Each `good` is deliberately *head-glued* — `f(x)` not `f (x)`, `(a or b)` not `a or b` — so the
 * fixture type-checks on the pinned head and the only observable difference in the plant is the
 * rewrite under test. A `bad` that additionally stops type-checking still counts as caught: a
 * rewrite that turns clean code into a type error is caught by every level.
 */
export const PLANTS = [
    {
        id: 'juxt-head',
        title: 'dropping parens of a juxtaposed-application head',
        good: 'let f = func (n : Nat) : Nat { n };\nlet x = 1;\nfunc a() : Nat { if (f x == 0) { 1 } else { 0 } };\n',
        bad: 'let f = func (n : Nat) : Nat { n };\nlet x = 1;\nfunc a() : Nat { if f x == 0 { 1 } else { 0 } };\n',
        expect: ['tree', 'dp'],
    },
    {
        id: 'await-head',
        title: 'dropping parens of an `await` comparison head',
        good: 'let f = func () : async Bool { true };\nfunc a() : async Nat { if ((await f()) == true) { 1 } else { 0 } };\n',
        bad: 'let f = func () : async Bool { true };\nfunc a() : async Nat { if await f() == true { 1 } else { 0 } };\n',
        expect: ['tree', 'dp'],
    },
    {
        id: 'func-eq-body',
        title: 'bracing a `func … = e` body',
        good: 'func f() : Nat = 1;\n',
        bad: 'func f() : Nat { 1 };\n',
        // Both type-check; only the tree levels can see it.
        expect: ['tree', 'dp'],
    },
    {
        id: 'case-or',
        title: 'unwrapping `case (a or b)`',
        good: 'func a(x : Bool) : Nat { switch x { case (true or false) { 1 } } };\n',
        bad: 'func a(x : Bool) : Nat { switch x { case true or false { 1 } } };\n',
        expect: ['tree', 'dp'],
    },
];

/**
 * Run the self-test. Returns `{ plants: [...], moc: {available, name}, summary }`.
 *
 * Each plant result carries, per level, `{ ran, caught, detail }`. A level is `ran: false` only when
 * a binary it needs is absent; that is recorded, never turned into a pass.
 */
export async function selfTest() {
    const parser = await createParser();
    const moc = findMoc();
    const plants = [];

    try {
        for (const plant of PLANTS) {
            const row = {
                id: plant.id,
                title: plant.title,
                expect: plant.expect,
                levels: {},
            };

            // Tree level: shape(good) vs shape(bad), both parsed with our grammar. A difference is
            // the catch. An ERROR on either side also counts (the grammar rejected the bad source).
            {
                const tg = parser.parse(plant.good);
                const tb = parser.parse(plant.bad);
                try {
                    const eg = tg.rootNode.hasError;
                    const eb = tb.rootNode.hasError;
                    const sameShape =
                        !eg &&
                        !eb &&
                        shapeKey(shapeOf(tg.rootNode)) ===
                            shapeKey(shapeOf(tb.rootNode));
                    const caught = !sameShape;
                    row.levels.tree = {
                        ran: true,
                        caught,
                        detail: eg
                            ? 'good source has a grammar ERROR (fixture is wrong)'
                            : eb
                              ? 'bad source rejected by grammar'
                              : sameShape
                                ? 'identical shape — level did NOT catch it'
                                : 'shapes differ',
                    };
                } finally {
                    tg.delete();
                    tb.delete();
                }
            }

            // moc levels, when a binary exists.
            if (moc) {
                const dpG = parseTreeLevel(moc, plant.good);
                const dpB = parseTreeLevel(moc, plant.bad);
                // The level "catches" when it observably distinguishes good from bad. A bad side
                // that fails to parse at all is a difference — the rewrite produced a bad source, and
                // the level noticed. Only a good side that fails means the fixture itself is wrong.
                row.levels.dp = {
                    ran: true,
                    caught: dpG.ok && (dpB.ok ? dpG.dump !== dpB.dump : true),
                    detail: !dpG.ok
                        ? 'moc -dp failed on good (fixture is wrong)'
                        : !dpB.ok
                          ? 'bad source rejected by moc -dp (caught)'
                          : dpG.dump === dpB.dump
                            ? 'identical -dp dump — level did NOT catch it'
                            : 'dumps differ',
                };

                const ckG = checkLevel(moc, plant.good);
                const ckB = checkLevel(moc, plant.bad);
                const ckDiff = !sameDiagnostics(ckG, ckB);
                row.levels.diagnostics = {
                    ran: true,
                    caught: ckDiff,
                    detail: ckDiff
                        ? `codes differ: good ${JSON.stringify(ckG.counts)} vs bad ${JSON.stringify(ckB.counts)}`
                        : `same codes ${JSON.stringify(ckG.counts)}`,
                };

                const dtG = typedTreeLevel(moc, plant.good);
                const dtB = typedTreeLevel(moc, plant.bad);
                // Same rule as `dp`: a bad side that stops type-checking is itself the catch, since
                // it means the rewrite turned clean code into code moc rejects.
                row.levels.typedTree = {
                    ran: true,
                    caught: dtG.ok && (dtB.ok ? dtG.dump !== dtB.dump : true),
                    detail: !dtG.ok
                        ? 'good side failed to type-check (fixture is wrong)'
                        : dtB.ok
                          ? dtG.dump === dtB.dump
                              ? 'identical -dt dump — level did NOT catch it'
                              : 'dumps differ'
                          : 'bad source failed to type-check (caught)',
                };
            } else {
                for (const lvl of ['dp', 'diagnostics', 'typedTree']) {
                    row.levels[lvl] = {
                        ran: false,
                        caught: false,
                        detail: 'requires moc; not found (see RESULTS.md)',
                    };
                }
            }
            plants.push(row);
        }
    } finally {
        parser.delete();
    }

    const summary = {
        mocAvailable: Boolean(moc),
        mocName: moc ? moc.name : null,
        // A plant is "caught" if every level it `expect`s ran and caught it.
        caught: plants
            .filter((p) =>
                p.expect.every((l) => p.levels[l]?.ran && p.levels[l]?.caught),
            )
            .map((p) => p.id),
        missed: plants
            .filter(
                (p) =>
                    p.expect.every((l) => p.levels[l]?.ran) &&
                    !p.expect.every((l) => p.levels[l]?.caught),
            )
            .map((p) => p.id),
        skipped: plants
            .filter((p) => p.expect.some((l) => !p.levels[l]?.ran))
            .map((p) => p.id),
    };
    return {
        plants,
        moc: moc
            ? {
                  available: true,
                  name: moc.name,
                  path: moc.path,
                  version: moc.version,
              }
            : { available: false },
        summary,
    };
}
