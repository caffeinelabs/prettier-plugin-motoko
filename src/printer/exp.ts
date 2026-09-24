/**
 * The expressions area printer: binary and `??` chains, which the source-gap fallback in `walk.ts` would leave on one over-long line.
 *
 * A binary chain breaks after each operator into one indented run, and a `|>` pipeline breaks before each `|>`.
 * The grammar's binary-operator precedence is flat, so chains are laid out flat and parens are never added or removed.
 * Flat, `line` prints one space, so a chain that fits reprints exactly as `a + b + c` and the guard's token texts survive.
 * A chain holding a comment, a `#`, or an indivisible operator falls back unbroken: falling back is always correct, guessing isn't.
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

/** `rel_op` is separate from `bin_op` in the grammar but prints identically. */
const OP_KINDS = new Set(['bin_op', 'rel_op']);

/** `coalesce_exp` is not one of the grammar's flat binary levels, so it has its own flattener rather than sharing `planChain`. */
const COALESCE_KIND = 'coalesce_exp';
const COALESCE_OP = '??';

/** The operator's text, or `null` when the node is not a plain one-token operator, e.g. it holds a comment. */
function opText(node: NormalChild): string | null {
    if (node.nodeType !== 'Branch') return null;
    const branch = node as NormalBranch;
    if (!OP_KINDS.has(branch.kind)) return null;
    if (branch.children.length !== 1) return null;
    const [token] = branch.children;
    if (token.nodeType !== 'Token') return null;
    return token.text.trim();
}

function breaksBefore(op: string): boolean {
    return op === '|>';
}

/**
 * Whether the operator may end a line. A chain holding one that may not is refused whole rather than broken elsewhere.
 *
 * Spaced `#` is concatenation and tight `#` is a variant tag, so a break beside it changes its role, and tree-sitter can't tell.
 * An indivisible operator like `>>` keeps its characters together only while nothing sits between it and its break.
 * `|>` is indivisible too, but breaks before itself so it never trails.
 */
function mayTrail(op: string): boolean {
    if (op === '#') return false;
    return !isIndivisible(op);
}

interface Chain {
    operands: NormalChild[];
    ops: string[];
}

/**
 * moc lexes `<`/`>` as comparisons only when spaced on both sides; otherwise they are type-argument brackets.
 * The grammar ignores this and reads `id <Nat>(1)` as `(id < Nat) > (1)`, so respacing it would turn an instantiation into a syntax error.
 * Such a chain is refused and printed as the source wrote it.
 */
const ANGLE_OPS: ReadonlySet<string> = new Set(['<', '>']);

function spacedBothSides(level: NormalBranch, opNode: NormalChild): boolean {
    const i = level.children.indexOf(opNode);
    return (
        level.children[i - 1]?.nodeType === 'Text' &&
        level.children[i + 1]?.nodeType === 'Text'
    );
}

/**
 * The operand, operator node and operand of one level, or `null` if the level holds anything else.
 *
 * The CST omits a gap where the source had no whitespace, so `1 + 1` has 5 children and `1+1` has 3.
 * Accepting every arity routes glued chains to the flat rendering, which reprints the operator with canonical spacing.
 * A comment in a gap is a `Token` or `Branch`, never `Text`, so it survives the filter and fails the length check, refusing the chain.
 */
function threeParts(
    level: NormalBranch,
): { left: NormalChild; opNode: NormalChild; right: NormalChild } | null {
    const children = level.children;
    if (children.length < 3 || children.length > 5) return null;

    const parts = children.filter((c) => c.nodeType !== 'Text');
    if (parts.length !== 3) return null;

    const [left, opNode, right] = parts;
    return { left, opNode, right };
}

/**
 * Flattens a left-leaning `bin_exp` spine, or `null` if any level has an unexpected shape.
 * A refused level takes the whole chain with it, since the chain is one Doc and the fallback prints the source exactly.
 */
function planChain(node: NormalBranch): Chain | null {
    if (node.kind !== 'bin_exp') return null;

    const operands: NormalChild[] = [];
    const ops: string[] = [];

    let current: NormalBranch = node;
    for (;;) {
        const level = threeParts(current);
        if (level === null) return null;
        const { left, opNode, right } = level;

        const op = opText(opNode);
        if (op === null) return null;
        if (!breaksBefore(op) && !mayTrail(op)) return null;
        if (ANGLE_OPS.has(op) && !spacedBothSides(current, opNode)) return null;

        // The tree leans left, so a `bin_exp` on the right is a parenthesised sub-chain. Bail out rather than mis-nest it.
        if (
            right.nodeType === 'Branch' &&
            (right as NormalBranch).kind === 'bin_exp'
        ) {
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

    // No minimum operator count: a one-operator chain still has to break when it doesn't fit, and the fallback never breaks a space.
    return { operands, ops };
}

/**
 * Flattens a `??` chain, or `null` if any level has an unexpected shape.
 *
 * Unlike `bin_exp`, the spine leans right: `a ?? b ?? c` is `coalesce_exp(a, coalesce_exp(b, c))`.
 * So the walk descends the right operand and appends where `planChain` prepends.
 * The operator is a bare `Token` rather than a `Branch` wrapping one, so `opText` doesn't apply.
 */
function planCoalesce(node: NormalBranch): Chain | null {
    if (node.kind !== COALESCE_KIND) return null;

    const lefts: NormalChild[] = [];
    const ops: string[] = [];
    let tail: NormalChild;

    let current: NormalBranch = node;
    for (;;) {
        const level = threeParts(current);
        if (level === null) return null;
        const { left, opNode, right } = level;

        if (opNode.nodeType !== 'Token') return null;
        if (opNode.text.trim() !== COALESCE_OP) return null;

        lefts.push(left);
        ops.push(COALESCE_OP);

        if (
            right.nodeType === 'Branch' &&
            (right as NormalBranch).kind === COALESCE_KIND
        ) {
            current = right as NormalBranch;
            continue;
        }
        tail = right;
        break;
    }

    return { operands: [...lefts, tail], ops };
}

/** The Doc for a binary or `??` chain, or `null` to leave the node to the source-gap fallback in `walk.ts`. */
export function binaryChainDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    const coalesce = planCoalesce(node);
    if (coalesce !== null) return coalesceDoc(coalesce, print);

    const chain = planChain(node);
    if (chain === null) return null;

    const { operands, ops } = chain;
    const out: Doc[] = [print(operands[0])];

    // One `indent` for the whole run rather than one per operator. The first operand stays outside it so the chain's start doesn't move.
    const rest: Doc[] = [];
    for (let i = 0; i < ops.length; i += 1) {
        const op = ops[i];
        const operand = print(operands[i + 1]);
        if (breaksBefore(op)) {
            rest.push(line, op, ' ', operand);
        } else {
            rest.push(' ', breakAfterOperator(op), operand);
        }
    }
    out.push(indent(rest));

    return group(out);
}

/** Breaks before each `??`, like `|>`, since `??` must not trail a line. */
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
