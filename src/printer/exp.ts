/**
 * The expressions area printer: binary chains, and the operator layout `docs/style.md` §"Binary
 * chains" and §"`|>` pipelines" specify.
 *
 * ## The one thing this module decides: the *direction* of a chain break
 *
 * `walk.ts` prints a node it does not understand as its children with the **source's own gaps**
 * reproduced. That is byte-exact, which is why the guard's tolerance list is empty — but for a
 * binary chain it is wrong in a way no gate can see: the chain's source gaps are spaces, and spaces
 * survive flattening, so a chain that does not fit stays on one line and runs past `printWidth`
 * forever. Measured against the corpus with `.probe/_overlong2.mts`, which blanks comments, strings
 * and numeric literals so that only a break the printer could have taken is counted:
 *
 * | file                          | before | after |
 * | ----------------------------- | ------ | ----- |
 * | `test/run/explode.mo`         | 3 (max 116) | 0 |
 * | `test/run/type-compatible.mo` | 2 (max 94)  | 1 (max 83, a comment) |
 * | `gc-random-test/types.mo`     | 1 (max 148) | 0 |
 *
 * Every line in the `before` column is a chain — `explode.mo`'s 116 characters are `and`s,
 * `gc-random-test/types.mo`'s 148 are `==`/`and`. The corpus total went **3 → 1**, and the one left
 * is `test/bench/candid-subtype-cost.mo`, a shared-function arrow inside a type, which belongs to
 * the patterns-and-types area rather than this one. (`dao.mo` sits at 7 over-80 either way, but those
 * are doc-comment prose, which the printer owns by design and cannot break.)
 *
 * The rule is two-sided and the two sides disagree, so it is worth stating exactly:
 *
 * - a **binary** chain breaks **after** its operator, into **one** indented run — the plan's "no
 *   nested groups per operator" and its worked example, one indent for the run rather than one per
 *   operator;
 * - a **`|>`** pipeline breaks **before** each `|>`.
 *
 * ## Where the flat rendering comes from, and why it is not `verbatim`
 *
 * `a + b + c` flattened by this module is `operand`, `' '`, `op`, `line`, `operand`, … — and `line`
 * flattens to a single space, so the flat form is exactly `a + b + c`. That has to be true, not
 * approximately true: the guard re-parses and compares token texts, so a chain printed with the
 * wrong spacing is a guard failure, not a style difference. The `line` is therefore doing double
 * duty as both the flat space and the break, which is the standard Prettier shape — and the break
 * itself is emitted by `adjacency.ts`'s `breakAfterOperator`, whose docstring names this seam.
 *
 * ## Why some chains refuse to break at all
 *
 * Two operators may not end a line, and a chain containing one is not printed here at all — it falls
 * back to the source-gap printer and stays long on purpose. `#` is the first: a tight `#` is a variant
 * tag and a spaced one is concatenation, so the whitespace beside it is meaning and not layout.
 * §2.7's indivisible set is the second: `>>`, `**`, `+%` and friends are one token each, and keeping
 * their characters together is only structural while nothing may sit between the operator and its
 * break. `tests/adjacency.test.ts` items 6 and 7 pin both, and `mayTrail` below carries the argument
 * for why refusing beats choosing a different break.
 *
 * ## Why the flattening bails out rather than guessing
 *
 * A `bin_op` node can hold a **comment** (`a + // c\n b`). Flattening would drop it, which changes
 * the program's text — so `planChain` refuses any level whose shape is not the exact five-child form
 * it expects and `walk.ts` falls back to the source-gap printer for the whole chain. Falling back is
 * always *correct*, just unbroken; guessing is not. The refusal is total rather than per-level
 * because a chain is printed as one Doc, so a level that cannot be flattened has to take the
 * branches it nests with it.
 */

import { doc } from 'prettier';
import type { Doc } from 'prettier';

import {
    breakAfterOperator,
    coalesceOperator,
    isIndivisible,
} from './adjacency.ts';
import type { NormalBranch, NormalChild } from '../parser/normalize.ts';

const { group, indent, line } = doc.builders;

/**
 * The kinds an operator node can have, and the token it holds.
 *
 * `rel_op` is separate from `bin_op` in the grammar (the `_overlong2` samples show `==`-chains
 * among the over-long lines), but the two print identically, so they are one list here rather than
 * two branches in the printer. The parser reports the node's `kind` after alias resolution, which is
 * what the generated types are keyed by.
 */
const OP_KINDS = new Set(['bin_op', 'rel_op']);

/**
 * `??`'s node kind, and the operator spelling it prints as.
 *
 * Named rather than inlined because the kind shows up in three places in `planCoalesce` alone, and
 * because `coalesce_exp` is deliberately *not* in `OP_KINDS`: it is not one of the grammar's
 * no-precedence binary levels, so it has its own flattener below rather than sharing `planChain`'s.
 */
const COALESCE_KIND = 'coalesce_exp';
const COALESCE_OP = '??';

/**
 * The operator a node prints as, or `null` if it is not a plain operator.
 *
 * A comment inside the operator node itself means the node is not the simple `bin_op` the chain
 * printer can take apart, so it reports `null` and the caller falls back.
 */
function opText(node: NormalChild): string | null {
    if (node.nodeType !== 'Branch') return null;
    const branch = node as NormalBranch;
    if (!OP_KINDS.has(branch.kind)) return null;
    if (branch.children.length !== 1) return null;
    const [token] = branch.children;
    if (token.nodeType !== 'Token') return null;
    return token.text.trim();
}

/** A `|>`-style operator, which breaks *before* rather than after (`docs/style.md` §"`|>` pipelines"). */
function breaksBefore(op: string): boolean {
    return op === '|>';
}

/**
 * Whether a break may be placed *after* this operator — i.e. whether the operator may end a line.
 *
 * This is the correction the adjacency checklist forced, and it is worth stating why the rule is
 * about the operator's *position* rather than its spelling. Two operators must not trail a line, and
 * they are refused for two different reasons:
 *
 * - **`#`** (concat `P2`, `B5`): `tests/adjacency.test.ts` item 6 pins that the spacing around a
 *   concat `#` survives a width too narrow to fit the line. `#` is the one character in the language
 *   whose meaning is decided by the whitespace around it — a *tight* `#` is a variant tag (P1) and a
 *   *spaced* `#` is concatenation — so a break beside it is a role change, not a layout change. moc
 *   2.0's `TIGHT_HASH` rule is exactly this test, and tree-sitter is blind to it (`.probe/_seam.mts`
 *   reports `SAME` for all three spellings).
 * - **§2.7's indivisible set** (`>>`, `**`, `+%`, …): item 7 pins that a shift is never split across
 *   a line. Breaking *after* `>>` does not split the token today — moc 1.16.0 and tree-sitter both
 *   accept `a >>\n b` (also `SAME` in the probe) — but the module emits operators as opaque strings,
 *   and the rule that keeps the two `>` characters together is only structural for as long as
 *   nothing is allowed to sit between the operator and its line break.
 *
 * `|>` is in `INDIVISIBLE_OPERATORS` and is deliberately exempt: it breaks *before* itself, so it
 * never trails a line in the first place. `mayTrail` asks about the *after* position only.
 *
 * When any operator in a chain fails this test, `planChain` refuses the whole chain rather than
 * choosing a different break. That is the same call the module header describes for an unflattenable
 * level: refusing is always *correct*, just unbroken, and the fixtures are within `printWidth`
 * almost everywhere — the corpus measurement put genuine code over-longs at 2 lines in 1828 files
 * *after* this rule, so the cost of refusing is one long line and the cost of guessing is a program
 * that means something else.
 */
function mayTrail(op: string): boolean {
    if (op === '#') return false;
    return !isIndivisible(op);
}

/**
 * A flattened chain: the operands left to right, and the operators between them (so `ops.length` is
 * `operands.length - 1`).
 */
interface Chain {
    operands: NormalChild[];
    ops: string[];
}

/**
 * Flatten a `bin_exp` spine into a flat chain, or `null` if any level has an unexpected shape.
 *
 * The grammar is left-associative with **no precedence**, so `a + b * c - d` is a spine of `bin_exp`
 * nodes leaning left and the flattening is a walk down `children[0]`. Each level must be exactly
 * `[left, Text, op, Text, right]`; anything else — a comment in place of a gap, an operator holding
 * more than its token — returns `null`, because the safe answer to "I do not recognise this" is to
 * print it exactly as the source had it.
 *
 * Depth is bounded by the expression, which is bounded by the file, so no explicit limit is needed;
 * the recursion is the same one the watcher in `normalize.ts` already walks.
 */
function planChain(node: NormalBranch): Chain | null {
    if (node.kind !== 'bin_exp') return null;

    const operands: NormalChild[] = [];
    const ops: string[] = [];

    let current: NormalBranch = node;
    for (;;) {
        const children = current.children;
        // The expected level: operand, gap, operator, gap, operand.
        if (children.length !== 5) return null;
        const [left, g1, opNode, g2, right] = children;
        // The gaps must be plain whitespace. A comment here is the case the header describes: the
        // text would be dropped by flattening, so this chain is not one this module may touch.
        if (g1.nodeType !== 'Text' || g2.nodeType !== 'Text') return null;
        const op = opText(opNode);
        if (op === null) return null;
        // An operator that may not end a line takes the whole chain with it — see `mayTrail`. This is
        // checked at plan time rather than at Doc-build time because the refusal is total: a chain is
        // one Doc, so an operator that cannot break after itself cannot be printed from this module.
        if (!breaksBefore(op) && !mayTrail(op)) return null;

        // The right operand is never a chain spine, because the tree leans left. If it is a
        // `bin_exp` it is a parenthesised sub-chain, which prints as its own group.
        if (
            right.nodeType === 'Branch' &&
            (right as NormalBranch).kind === 'bin_exp'
        ) {
            // Only a sub-chain that needs parens can appear here, and those carry their own
            // delimiters, so this is not a flattening case — bail out rather than mis-nest.
            return null;
        }

        ops.unshift(op);
        operands.unshift(right);

        if (
            left.nodeType === 'Branch' &&
            (left as NormalBranch).kind === 'bin_exp'
        ) {
            current = left as NormalBranch;
            continue;
        }
        operands.unshift(left);
        break;
    }

    // No minimum operator count, and that is a correction rather than an omission: a single-operator
    // chain still has to break when it does not fit. The first draft required two, reasoning that a
    // one-operator chain "reads the same either way" — which was wrong, because the fallback it would
    // have returned to reproduces the source's *spaces*, and a space never breaks. `dao.mo` is the
    // counter-example and it was found by measuring: `let refunded = account.amount_e8s +
    // system_params.proposal_submission_deposit.amount_e8s;` is 101 chars at 12 spaces of indent, one
    // operator, and it stayed over `printWidth` until this line was removed.
    return { operands, ops };
}

/**
 * Flatten a `??` chain, or `null` if any level has an unexpected shape.
 *
 * ## Why this is not `planChain` with a different kind set
 *
 * `coalesce_exp` is its own grammar node, not a `bin_exp`, so `planChain` never sees a `??` chain and
 * the whole thing falls through to the source-gap printer — which reproduces the source's *spaces*,
 * and a space never breaks. A `??` chain that does not fit therefore stayed over `printWidth`
 * forever. Measured before this function existed:
 *
 *     let x = aaaaaaaaaaaaaaa ?? bbbbbbbbbbbbbbb ?? ccccccccccccccc ?? …   // 101 chars at width 80
 *
 * Two structural differences from `planChain`, both of which are why it is a separate walk rather
 * than a branch inside it:
 *
 *  - **The spine leans right, not left.** `a ?? b ?? c` is `coalesce_exp(a, coalesce_exp(b, c))` —
 *    probed with `.probe/_coalshape.mts`, and the opposite of the grammar's no-precedence binary
 *    levels, which lean left. So the walk descends the **right** operand, where `planChain` descends
 *    the left — and that in turn is why this walk *appends* its operands where `planChain` prepends:
 *    a left-leaning walk meets its operands back to front, a right-leaning one meets them in order.
 *  - **The node has four children, not five**, and the operator is a bare `Token` rather than a
 *    `Branch` wrapping one: `[left, Text, op, right]`.
 *
 * ## The trailing space in the operator token, which is the whole hazard
 *
 * The lexer's rule is `alias(token(/\?\?[ \t\r\n]/), "??")` — **the trailing whitespace is part of
 * the token** — and `shapeOf` compares a token's `text` exactly. So the guard sees `"?? "` when a
 * space follows and something else when anything else does. Measured on all four spellings
 * (`.probe/_coalverify.mts`):
 *
 * | form                | tree-sitter | moc      | guard vs `a ?? b` |
 * | ------------------- | ----------- | -------- | ----------------- |
 * | `a ?? b`            | parses      | 0 errors | —                 |
 * | `a\n?? b`           | parses      | 0 errors | **matches**       |
 * | `a ??\nb`           | parses      | 0 errors | differs           |
 * | `a ?? \nb`          | parses      | 0 errors | **matches**       |
 *
 * The break must therefore go **before** the operator, never after — which is what this module
 * emits, and what `coalesceOperator` restates from the token's own side.
 */
function planCoalesce(node: NormalBranch): Chain | null {
    if (node.kind !== COALESCE_KIND) return null;

    // The left operands are collected **in the order they are met**, and the final right operand
    // closes the run. `planChain` prepends instead, because it descends a left-leaning spine and so
    // meets its operands back to front; here the spine leans right, so the outermost level is met
    // first and the walk already reads left to right. Prepending in this direction is what produced
    // a reversed `a ?? b ?? c` — caught by the guard, not by review.
    const lefts: NormalChild[] = [];
    const ops: string[] = [];
    let tail: NormalChild;

    let current: NormalBranch = node;
    for (;;) {
        const children = current.children;
        // The expected level: operand, gap, operator, operand — four children, no gap after the
        // operator, because the operator's own token text carries the trailing space.
        if (children.length !== 4) return null;
        const [left, gap, opNode, right] = children;
        // The gap must be plain whitespace. A comment here is `planChain`'s case for the same
        // reason: flattening would drop the text, so this is not a chain the module may touch.
        if (gap.nodeType !== 'Text') return null;
        // The operator is a **bare `Token`**, not a `Branch` wrapping one — the one place this walk
        // parts company with `opText`, which requires `nodeType === 'Branch'` and so reports `null`
        // here. Measured with `.probe/_coalshape.mts`; a `bin_exp` level by contrast holds
        // `Branch bin_op → Token "+"`.
        if (opNode.nodeType !== 'Token') return null;
        if (opNode.text.trim() !== COALESCE_OP) return null;

        lefts.push(left);
        ops.push(COALESCE_OP);

        if (
            right.nodeType === 'Branch' &&
            (right as NormalBranch).kind === COALESCE_KIND
        ) {
            // The spine leans right, so the chain continues into the *right* operand.
            current = right as NormalBranch;
            continue;
        }
        tail = right;
        break;
    }

    return { operands: [...lefts, tail], ops };
}

/**
 * The Doc for a binary chain, or `null` when the node is not one this module handles.
 *
 * Returning `null` rather than a Doc keeps the decision at the call site in `walk.ts`, where the
 * fallback already exists — a printer that returned `verbatim` here would be indistinguishable from
 * a printer that had decided the source layout was right.
 */
export function binaryChainDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    // `coalesce_exp` first: it is not a `bin_exp`, so `planChain` would refuse it below.
    const coalesce = planCoalesce(node);
    if (coalesce !== null) return coalesceDoc(coalesce, print);

    const chain = planChain(node);
    if (chain === null) return null;

    const { operands, ops } = chain;
    const out: Doc[] = [print(operands[0])];

    // One `indent` around the whole run, which is the "exactly one level" the style guide calls for.
    // The operators and operands go inside it; the first operand stays outside so the chain's own
    // start is not pushed right when it breaks.
    //
    // The break itself comes from `adjacency.ts`'s `breakAfterOperator`, which is where the module
    // that owns the whitespace-sensitive pairs put it — its docstring names this exact seam, and
    // keeping the emit in one place is what lets `comparisonOp` and this share a rule. It returns
    // `[op, line]`, so the `' '` before the operator is this module's half of the pair: flat gives
    // ` + `, broken leaves `+` trailing the line.
    const rest: Doc[] = [];
    for (let i = 0; i < ops.length; i += 1) {
        const op = ops[i];
        const operand = print(operands[i + 1]);
        if (breaksBefore(op)) {
            // `line` then the operator: flat gives ` |> `, broken puts `|>` at the line's start.
            rest.push(line, op, ' ', operand);
        } else {
            rest.push(' ', breakAfterOperator(op), operand);
        }
    }
    out.push(indent(rest));

    return group(out);
}

/**
 * The Doc for a flattened `??` chain.
 *
 * The break goes **before** the operator, matching `|>` rather than the binary levels: the operator
 * cannot trail a line (see `planCoalesce`), and `coalesceOperator` — the module that owns this
 * whitespace-sensitive token — already emits exactly that shape. Its `' '` after the operator is the
 * mandatory trailing space the lexer requires, so this consumes the pair rather than re-deriving it.
 *
 * The run is wrapped in its **own** `group` even when it is the outermost chain. That `group` is
 * load-bearing on the flat path: `indent` is a no-op while the enclosing group stays flat, so the
 * flat rendering is `a ?? b ?? c` exactly as the source spelled it and the guard's token texts are
 * preserved. If an enclosing group breaks and this one does not, the doc flattens regardless of
 * width, which is why the `??` chain's own width is decided here rather than by its parent.
 */
function coalesceDoc(chain: Chain, print: (child: NormalChild) => Doc): Doc {
    const { operands, ops } = chain;
    const out: Doc[] = [print(operands[0])];
    const rest: Doc[] = [];
    for (let i = 0; i < ops.length; i += 1) {
        rest.push(coalesceOperator(ops[i]), print(operands[i + 1]));
    }
    out.push(indent(rest));
    return group(out);
}
