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

import { breakAfterOperator, isIndivisible } from './adjacency.ts';
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
