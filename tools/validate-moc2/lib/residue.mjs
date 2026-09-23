// The residue scan: walk a tree and count every construct the v2 target retires.
//
// This is the Goal 2 measurement. It runs on raw trees at a pinned revision, so it counts what the
// source *is*, independent of any rewrite. The plan lists five constructs; each gets a counter here
// and a documented rule, because "bare arm body" and friends are only unambiguous once the exact
// node shape is written down.
//
// The one genuinely non-obvious rule is spaced application/indexing. `f(x)` and `f (x)` produce the
// *identical* tree — the grammar folds both to `call_exp_object` — so the distinction does not exist
// in the tree at all. It lives only in the source gap between the callee's end and the argument's
// start. The scanner therefore takes the source text and compares the gap, which is the only place
// the information survives. The same applies to `xs[i]` vs `xs [i]` in `array_idx_exp`.
//
// Counters are reported per construct and also per *rule group* matching the plan's wording, so the
// report can be read against #6385's numbers directly.

/** True when the node is a braced body: a `block_exp`, or a `do`/`object` form used as a body. */
function isBracedBody(node) {
    return (
        node !== null &&
        (node.type === 'block_exp' || node.type === 'object_exp')
    );
}

/** The text between two child nodes, i.e. what layout the source used. `null` if not a gap. */
function gapBetween(src, left, right) {
    if (!left || !right) return null;
    if (right.startIndex < left.endIndex) return null;
    return src.slice(left.endIndex, right.startIndex);
}

/** Last non-comment child of a node, or null. */
function lastChild(node) {
    return node.childCount ? node.child(node.childCount - 1) : null;
}

/** First child with the given type, or null. */
function childOfType(node, type) {
    for (let i = 0; i < node.childCount; i += 1) {
        if (node.child(i).type === type) return node.child(i);
    }
    return null;
}

/** Zeroed counter set. Every key is a construct the plan names, plus the two group totals. */
export function zeroCounts() {
    return {
        // parenthesised heads
        parenIfHead: 0,
        parenWhileHead: 0,
        parenForHead: 0,
        // bare bodies
        bareIfBody: 0,
        bareLoopBody: 0,
        bareWhileBody: 0,
        bareForBody: 0,
        // arms
        bareCaseArm: 0,
        bareCatchArm: 0,
        bracedCaseArm: 0,
        bracedCatchArm: 0,
        // separators: `;` immediately after a case/catch arm inside its switch/try
        semiAfterBracedCaseArm: 0,
        semiAfterBareCaseArm: 0,
        semiAfterCatchArm: 0,
        // whole-pattern parens on a single case pattern
        wholePatternParensSingleCase: 0,
        // spaced application / indexing
        spacedApplication: 0,
        spacedIndexing: 0,
    };
}

/**
 * Add two counter sets. Used to aggregate per-file into per-set totals.
 */
export function addCounts(a, b) {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = (out[k] ?? 0) + b[k];
    return out;
}

/**
 * Group the fine-grained counters into the plan's wording, so the report can state
 * "bare arm bodies" and "arm separators" as single numbers comparable with #6385.
 */
export function groupCounts(c) {
    return {
        parenthesisedHeads: c.parenIfHead + c.parenWhileHead + c.parenForHead,
        bareBodies:
            c.bareIfBody + c.bareLoopBody + c.bareWhileBody + c.bareForBody,
        bareArmBodies: c.bareCaseArm + c.bareCatchArm,
        bracedArmBodies: c.bracedCaseArm + c.bracedCatchArm,
        armSeparators:
            c.semiAfterBracedCaseArm +
            c.semiAfterBareCaseArm +
            c.semiAfterCatchArm,
        armSeparatorsAfterBraced:
            c.semiAfterBracedCaseArm + c.semiAfterCatchArm,
        wholePatternParensSingleCase: c.wholePatternParensSingleCase,
        spacedApplicationOrIndexing: c.spacedApplication + c.spacedIndexing,
    };
}

/**
 * Scan one tree. `tree` is a web-tree-sitter Tree, `src` the text it was parsed from.
 *
 * Returns the fine-grained counts plus `sites`, an array of `{ construct, line, snippet }` for the
 * first `siteLimit` hits per construct, which is what the report needs to check a count against a
 * real example rather than a bare number.
 */
export function scanTree(tree, src, siteLimit = 5) {
    const counts = zeroCounts();
    const sites = [];
    const record = (construct, node, extra) => {
        counts[construct] += 1;
        const seen = sites.filter((s) => s.construct === construct).length;
        if (seen < siteLimit) {
            const snippet = src
                .slice(
                    node.startIndex,
                    Math.min(node.endIndex, node.startIndex + 60),
                )
                .replace(/\s+/g, ' ');
            sites.push({
                construct,
                line: node.startPosition.row + 1,
                snippet,
                ...(extra ? { note: extra } : {}),
            });
        }
    };

    function walk(node) {
        const t = node.type;

        if (t === 'if_exp') {
            const head = node.child(1);
            if (head && head.type === 'par_exp') record('parenIfHead', head);
            const body = lastChild(node);
            // `if … else …`: last child is the else body. Both arms are bare-or-braced together in
            // v2; counting the then-branch is enough and is what the plan's "bare if bodies" means.
            const thenIdx = 2;
            const thenBody = node.child(thenIdx);
            if (thenBody && !isBracedBody(thenBody))
                record('bareIfBody', thenBody);
            void body;
        } else if (t === 'while_exp') {
            const head = node.child(1);
            if (head && head.type === 'par_exp') record('parenWhileHead', head);
            const body = lastChild(node);
            if (body && !isBracedBody(body)) record('bareWhileBody', body);
        } else if (t === 'loop_exp') {
            const body = lastChild(node);
            if (body && !isBracedBody(body)) record('bareLoopBody', body);
        } else if (t === 'for_exp') {
            // The grammar carries explicit `(` `)` for the head; a parenthesised for-head is the
            // norm, so we only count a *removed* head, which cannot appear as `par_exp`. Recorded as
            // zero by construction; the counter exists so the report can say so explicitly.
            const body = lastChild(node);
            if (body && !isBracedBody(body)) record('bareForBody', body);
        } else if (t === 'switch_exp') {
            for (let i = 0; i < node.childCount; i += 1) {
                const c = node.child(i);
                if (c.type === 'case') {
                    const body = lastChild(c);
                    if (isBracedBody(body)) counts.bracedCaseArm += 1;
                    else record('bareCaseArm', c);
                    // Whole-pattern parens on a single case pattern: the pattern node is a `tup_pat`
                    // holding one element and no comma. `(a, b)` is a real tuple and is left alone;
                    // `(a or b)` is the `tup_pat`-wrapped `alt_pat` the plan names.
                    const pat = c.child(1);
                    if (pat && pat.type === 'tup_pat') {
                        const hasComma = childOfType(pat, ',') !== null;
                        const named = [];
                        for (let k = 0; k < pat.namedChildCount; k += 1)
                            named.push(pat.namedChild(k));
                        if (!hasComma && named.length === 1) {
                            record(
                                'wholePatternParensSingleCase',
                                pat,
                                named[0].type,
                            );
                        }
                    }
                } else if (c.type === ';') {
                    const prev = i > 0 ? node.child(i - 1) : null;
                    if (prev && prev.type === 'case') {
                        const body = lastChild(prev);
                        if (isBracedBody(body))
                            counts.semiAfterBracedCaseArm += 1;
                        else counts.semiAfterBareCaseArm += 1;
                    }
                }
            }
        } else if (t === 'try_exp') {
            for (let i = 0; i < node.childCount; i += 1) {
                const c = node.child(i);
                if (c.type === 'catch') {
                    const body = lastChild(c);
                    if (isBracedBody(body)) counts.bracedCatchArm += 1;
                    else record('bareCatchArm', c);
                } else if (c.type === ';') {
                    const prev = i > 0 ? node.child(i - 1) : null;
                    if (prev && prev.type === 'catch')
                        counts.semiAfterCatchArm += 1;
                }
            }
        }

        // Spaced application: `f (x)` folds to the same node as `f(x)`, so the gap is the signal.
        if (t === 'call_exp_object' || t === 'call_exp_block') {
            const callee = node.child(0);
            const arg = node.child(1);
            const gap = gapBetween(src, callee, arg);
            if (
                gap !== null &&
                arg &&
                arg.type === 'par_exp' &&
                /\s/.test(gap)
            ) {
                record('spacedApplication', node);
            }
        }
        if (t === 'array_idx_exp_object' || t === 'array_idx_exp_block') {
            const target = node.child(0);
            const open = childOfType(node, '[');
            const gap = gapBetween(src, target, open);
            if (gap !== null && /\s/.test(gap)) record('spacedIndexing', node);
        }

        for (let i = 0; i < node.childCount; i += 1) walk(node.child(i));
    }

    walk(tree.rootNode);
    return { counts, sites };
}
