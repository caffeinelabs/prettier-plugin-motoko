// Base-vs-head comparison and the divergences.json buckets.
//
// The plan's Goal 2 is "compare our output with #6385's head". The `moc2` rewrite does not exist yet,
// so there is no "our output" to compare. What CAN be compared today, honestly and without moc, is
// **base vs head at tree level**: exactly what #6385 changed in the compiler's own Motoko. That is
// the runnable projection of Goal 2, and it is what this module produces.
//
// Method: for every unit in the oracle set (the files #6385 touches), parse it at BASE and at HEAD
// with our grammar, normalise layout away (`shapeOf`), and diff the two trees. A unit whose shapes
// differ is a real edit #6385 made; each is then classified by its **node-type histogram delta** —
// the multiset of node types and token texts the edit added and removed.
//
// Bucket semantics in `divergences.json`, stated once so a reviewer can disagree with them:
//   - **intended** — the edit IS the target migration: a whole-head `par_exp` (and its paren tokens)
//                    removed, or a `block_exp`/`exp_dec` (and its braces) added around a bare arm
//                    body, and nothing else moved. A correct `moc2` must reproduce exactly these.
//   - **extra**    — an edit that is NOT the target migration: `func` wrappers around undeclared
//                    names, rewritten doc examples, new fence content, and pure comment/whitespace
//                    reshuffles (which reach the tree only as `comment`-node deltas). A rule-driven
//                    migration would not generate these, so they are listed for a human to confirm.
//   - **missed**   — a site the target migration should have reached but did not. With no `moc2`
//                    there is no "we" to miss anything, so this bucket is populated from the
//                    *head-vs-target* direction (`headResidue`): residue that survives at HEAD is a
//                    site the hand migration left, which is exactly what the sweep must catch. It
//                    must be zero before beta, per the plan.
//
// Classification uses the histogram delta rather than the first tree divergence, because a paren
// removal shows up first as a child-count drop on the *enclosing* node (`for_exp(7)->for_exp(5)`,
// `switch_exp(8)->switch_exp(6)`), which is not itself a node type. The delta sees the `par_exp` and
// its tokens underneath it, so whole-head paren removal is recognised regardless of how deep it sits.
//
// Every entry names the unit, the site (line + snippet) and a one-line reason, as the plan requires.

import { BASE, HEAD, inOracleSet } from './config.mjs';
import { git, listFiles, readerFor } from './git.mjs';
import { unitsForFile } from './units.mjs';
import { createParser, grammarInfo, shapeKey, shapeOf } from './grammar.mjs';
import { groupCounts, scanTree } from './residue.mjs';

/** Build every oracle-set unit at a revision, with its label and kind. */
function oracleUnits(rev) {
    const read = readerFor(rev);
    const out = [];
    for (const p of listFiles(rev)) {
        if (!inOracleSet(p)) continue;
        for (const u of unitsForFile(p, read)) out.push(u);
    }
    return out;
}

/**
 * Compare base vs head, unit by unit, at tree level.
 *
 * Returns `{ units, matched, changed, classified, unparseable, buckets }` where `buckets` is
 * `{ missed: [], extra: [], intended: [] }`.
 */
export async function compareBaseHead({ siteLimit = 3 } = {}) {
    const baseUnits = oracleUnits(BASE);
    const headUnits = oracleUnits(HEAD);
    const parser = await createParser();

    // Index head units by the same label base units carry. Labels are stable: `<path>` for a file,
    // `<path>:<line> (fence)` for a fence. A fence whose line moved between revisions changes label,
    // so those are paired positionally *within the file* — but only when the file has the same number
    // of fences at both revisions. When the count changed (a fence was inserted or deleted, as in
    // style-guide.md, which gains 3), positional pairing would silently align fence N at base with a
    // different fence N at head and produce false "edits". So a count change disables positional
    // pairing for that file and its leftover fences are reported as `shifted`, never classified.
    const headByLabel = new Map(headUnits.map((u) => [u.label, u]));
    const headByPath = new Map();
    for (const u of headUnits) {
        if (!headByPath.has(u.repoPath)) headByPath.set(u.repoPath, []);
        headByPath.get(u.repoPath).push(u);
    }
    const baseByPath = new Map();
    for (const u of baseUnits) {
        if (!baseByPath.has(u.repoPath)) baseByPath.set(u.repoPath, []);
        baseByPath.get(u.repoPath).push(u);
    }
    /** Fence counts agree at both revisions => positional pairing within the file is meaningful. */
    const pairablePositionally = (repoPath) =>
        (baseByPath.get(repoPath)?.length ?? 0) ===
        (headByPath.get(repoPath)?.length ?? 0);

    // Head fences indexed by exact source, per file, consumed as they pair. A fence that only moved
    // lines has identical source, so this recovers it even when line numbers shifted. Duplicate
    // sources within one file are why this is a queue: take the first not-yet-used match.
    const headBySource = new Map(); // repoPath -> Map(source -> headUnit[])
    for (const u of headUnits) {
        if (!headBySource.has(u.repoPath))
            headBySource.set(u.repoPath, new Map());
        const m = headBySource.get(u.repoPath);
        const k = u.source;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(u);
    }
    const takeBySource = (repoPath, source) => {
        const m = headBySource.get(repoPath);
        const q = m?.get(source);
        return q && q.length > 0 ? q.shift() : undefined;
    };

    const result = {
        base: BASE,
        head: HEAD,
        grammar: await grammarInfo(),
        unitsInBaseOracle: baseUnits.length,
        unitsInHeadOracle: headUnits.length,
        matched: 0,
        changed: 0,
        unparseable: [],
        moved: [],
        shifted: [],
        buckets: { missed: [], extra: [], intended: [] },
    };

    try {
        for (const b of baseUnits) {
            // Pair with head: by label first (exact fence, i.e. same path and same start line), then
            // by exact source text (a fence that only moved lines still pairs), then — only when the
            // file's fence count is unchanged — positionally.
            let h = headByLabel.get(b.label);
            if (!h && b.kind === 'file') h = headByLabel.get(b.repoPath);
            if (!h) h = takeBySource(b.repoPath, b.source);
            if (!h) {
                if (!pairablePositionally(b.repoPath)) {
                    result.shifted.push({
                        unit: b.label,
                        reason:
                            'base/head fence counts differ for this file and this fence has no ' +
                            'exact-source match; not paired, so not classified (a false edit would ' +
                            'be worse than a reported gap)',
                    });
                    continue;
                }
                const list = headByPath.get(b.repoPath) ?? [];
                const idx = (baseByPath.get(b.repoPath) ?? []).indexOf(b);
                h = list[idx];
                if (h)
                    result.moved.push({ unit: b.label, pairedWith: h.label });
            }
            if (!h) {
                result.unparseable.push({
                    unit: b.label,
                    reason: 'unit present at base but not at head (deleted or not re-pairable)',
                });
                continue;
            }

            const tb = parser.parse(b.source);
            const th = parser.parse(h.source);
            try {
                const eb = tb.rootNode.hasError;
                const eh = th.rootNode.hasError;
                if (eb || eh) {
                    if (eb && eh) {
                        result.matched += 1; // both unparseable: not a tree-change signal
                        continue;
                    }
                    result.unparseable.push({
                        unit: b.label,
                        reason: eb
                            ? 'base tree has ERROR; head has none (grammar cannot diff cleanly)'
                            : 'head tree has ERROR; base has none (grammar deviation or new syntax)',
                    });
                    continue;
                }
                const kb = shapeKey(shapeOf(tb.rootNode));
                const kh = shapeKey(shapeOf(th.rootNode));
                if (kb === kh) {
                    result.matched += 1;
                    continue;
                }
                result.changed += 1;

                const entry = {
                    unit: b.label,
                    kind: b.kind,
                    reason: '',
                    delta: {},
                    sites: [],
                };
                const db = nodeHistogram(tb.rootNode);
                const dh = nodeHistogram(th.rootNode);
                entry.delta = histogramDelta(db, dh);
                entry.sites = diffSites(
                    tb.rootNode,
                    th.rootNode,
                    b.source,
                    h.source,
                    siteLimit,
                );
                const verdict = classifyDelta(b, entry.delta);
                entry.reason = verdict.reason;
                result.buckets[verdict.bucket].push(entry);
            } finally {
                tb.delete();
                th.delete();
            }
        }
    } finally {
        parser.delete();
    }

    result.buckets.counts = {
        missed: result.buckets.missed.length,
        extra: result.buckets.extra.length,
        intended: result.buckets.intended.length,
    };
    return result;
}

/**
 * The first few positions where two trees' shapes differ, as `{ line, from, to, snippet }`.
 *
 * A field-by-field zip of the two shapes; the first index where they diverge names a node path, and
 * the base/head `text` at that path is the observable change. Capped at `limit` sites per unit: the
 * point is a one-line reason, not a full diff.
 */
function diffSites(baseRoot, headRoot, baseSrc, headSrc, limit) {
    const out = [];
    function walk(b, h, depth) {
        if (out.length >= limit) return;
        if (!b || !h) return;
        if (b.type !== h.type) {
            out.push({
                line: b.startPosition.row + 1,
                from: b.type,
                to: h.type,
                snippet: baseSrc
                    .slice(
                        b.startIndex,
                        Math.min(b.endIndex, b.startIndex + 50),
                    )
                    .replace(/\s+/g, ' '),
            });
            return;
        }
        const bc = b.childCount;
        const hc = h.childCount;
        if (bc !== hc) {
            out.push({
                line: b.startPosition.row + 1,
                from: `${b.type}(${bc} children)`,
                to: `${h.type}(${hc} children)`,
                snippet: baseSrc
                    .slice(
                        b.startIndex,
                        Math.min(b.endIndex, b.startIndex + 50),
                    )
                    .replace(/\s+/g, ' '),
            });
            return;
        }
        for (let i = 0; i < bc && out.length < limit; i += 1) {
            walk(b.child(i), h.child(i), depth + 1);
        }
    }
    walk(baseRoot, headRoot, 0);
    return out;
}

/**
 * A multiset of node types (leaves counted by type AND text, so `(` and `)` and identifiers are
 * distinct) over a whole tree. The delta of two histograms is the edit, independent of where in the
 * tree it sits — which is what makes it robust where a positional first-divergence walk is not.
 */
export function nodeHistogram(node, hist = new Map()) {
    const key =
        node.childCount === 0 ? `${node.type}\u0000${node.text}` : node.type;
    hist.set(key, (hist.get(key) ?? 0) + 1);
    for (let i = 0; i < node.childCount; i += 1)
        nodeHistogram(node.child(i), hist);
    return hist;
}

/** `{ key -> (head count - base count) }`, omitting zero entries. */
export function histogramDelta(base, head) {
    const keys = new Set([...base.keys(), ...head.keys()]);
    const out = {};
    for (const k of keys) {
        const d = (head.get(k) ?? 0) - (base.get(k) ?? 0);
        if (d !== 0) out[k] = d;
    }
    return out;
}

/** Strip the `\u0000text` suffix from a histogram key, leaving the node type. */
function typeOf(key) {
    const i = key.indexOf('\u0000');
    return i < 0 ? key : key.slice(0, i);
}

/**
 * Classify one base-vs-head histogram delta into `{ bucket, reason }`.
 *
 * The approach is a vocabulary test: every net change in the delta must be attributable to the target
 * migration, or the edit is reported as `extra` with the foreign node types named. The migration's
 * vocabulary, and the direction each may move in, is fixed by the two edits the plan names:
 *
 *   remove a parenthesised head / whole-pattern parens
 *      `par_exp` down, or `tup_pat` down (the grammar's whole-pattern `(...)`), with `(` `)` down.
 *   add a braced body around a bare arm
 *      `block_exp` up, `exp_dec` up, with `{` `}` up.
 *
 * Plus two bookkeeping movements that are part of the same edits and carry no other meaning:
 *   - `;` may move either way as arms gain braces,
 *   - a call/dot/binary expression may rename between its `_exp_object` and `_exp_block` spelling,
 *     which is the grammar recording the parens the object form had (`f(a)` vs `f a`), not semantics.
 *
 * A `comment` node moving is a comment/example edit — the plan's "comment-only edits", which a
 * rule-driven migration would not generate — so a delta that is *only* comments is `extra` on its
 * own line, and a comment move alongside a migration is still `intended` (the migration happened).
 *
 * The direction matters: a delta that *adds* `par_exp` or *removes* `block_exp` is the reverse of the
 * target and is `extra`, never `intended`, so the classifier cannot be satisfied by an edit that
 * undoes the migration.
 */
export function classifyDelta(unit, delta) {
    const keys = Object.keys(delta);
    if (keys.length === 0) {
        return {
            bucket: 'extra',
            reason: 'layout-only; shapes differ but no node-type delta (should not happen)',
        };
    }

    let sawMigration = false;
    let sawComment = false;
    let sawSeparatorDrop = false;
    const foreign = [];
    // Human-readable summary of what moved, in one line, for the entry's reason.
    const removed = new Set();
    const added = new Set();

    for (const [k, d] of Object.entries(delta)) {
        const t = typeOf(k);
        if (t === '(' || t === ')' || t === 'par_exp' || t === 'tup_pat') {
            if (d < 0) {
                sawMigration = true;
                removed.add(t);
            } else {
                foreign.push(t);
            }
            continue;
        }
        if (t === 'block_exp' || t === 'exp_dec' || t === '{' || t === '}') {
            if (d > 0) {
                sawMigration = true;
                added.add(t);
            } else {
                foreign.push(t);
            }
            continue;
        }
        if (t === ';') {
            // A dropped separator is part of the migration's brace discipline only when it falls;
            // a `;` that *rises* is not the target, so it is not allowed to earn `intended` alone.
            if (d < 0) sawSeparatorDrop = true;
            continue;
        }
        if (t.endsWith('_exp_object') || t.endsWith('_exp_block')) continue; // same-source respelling
        if (t === 'comment' || t === 'line_comment' || t === 'block_comment') {
            sawComment = true;
            continue;
        }
        foreign.push(t);
    }

    if (foreign.length > 0) {
        return {
            bucket: 'extra',
            reason: `edit not covered by the target rules (added: ${[...added].join(', ') || 'none'}; removed: ${[...removed].join(', ') || 'none'}; foreign: ${[...new Set(foreign)].join(', ')})`,
        };
    }
    if (sawMigration) {
        const parts = [];
        if (removed.size) parts.push(`removed ${[...removed].join('/')}`);
        if (added.size) parts.push(`added ${[...added].join('/')}`);
        return {
            bucket: 'intended',
            reason: `migration: ${parts.join(', ')} (v2 brace/paren discipline)`,
        };
    }
    if (sawSeparatorDrop && !sawComment) {
        return {
            bucket: 'intended',
            reason: 'migration: dropped arm separator(s) (v2 brace discipline)',
        };
    }
    if (sawComment) {
        return {
            bucket: 'extra',
            reason: 'comment-only edit; no migration effect',
        };
    }
    return {
        bucket: 'extra',
        reason: 'no migration movement observed (separator/structural respelling only)',
    };
}

/**
 * Residue that survives at HEAD, over the oracle set: the sites the hand migration left. These are
 * the "missed" sites in the head-vs-target direction and the report's zero-residue target.
 */
export async function headResidue() {
    const read = readerFor(HEAD);
    const parser = await createParser();
    const sites = [];
    let totals = null;
    let parsed = 0;
    let unparsed = 0;
    try {
        for (const p of listFiles(HEAD)) {
            if (!inOracleSet(p)) continue;
            for (const u of unitsForFile(p, read)) {
                if (!u.source.trim()) continue;
                const t = parser.parse(u.source);
                try {
                    if (t.rootNode.hasError) {
                        unparsed += 1;
                        continue;
                    }
                    parsed += 1;
                    const { counts, sites: s } = scanTree(t, u.source, 5);
                    totals = totals ? add(totals, counts) : counts;
                    for (const x of s) sites.push({ unit: u.label, ...x });
                } finally {
                    t.delete();
                }
            }
        }
    } finally {
        parser.delete();
    }
    return {
        parsed,
        unparsed,
        residue: totals,
        grouped: groupCounts(totals),
        sites,
    };
}

function add(a, b) {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = (out[k] ?? 0) + b[k];
    return out;
}

/** `git diff --name-only BASE HEAD`, filtered to `.mo`/`.md`. */
export function changedUnitPaths() {
    return git('diff', '--name-only', BASE, HEAD)
        .split('\n')
        .filter((p) => p.endsWith('.mo') || p.endsWith('.md'));
}
