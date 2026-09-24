import { doc } from 'prettier';
import type { Doc } from 'prettier';

import { isIndivisible } from './adjacency.ts';
import type { NormalBranch, NormalChild } from '../parser/normalize.ts';

const { hardline, indent } = doc.builders;

const OP_KINDS = new Set(['bin_op', 'rel_op']);

const COALESCE_KIND = 'coalesce_exp';
const COALESCE_OP = '??';

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

// Spaced `#` is concatenation and glued `#` a variant tag, so a break beside it changes its role.
function mayTrail(op: string): boolean {
    if (op === '#') return false;
    return !isIndivisible(op);
}

type Break = 'before' | 'after' | null;

interface Chain {
    operands: NormalChild[];
    ops: string[];
    /** Where the source broke the line around each operator. */
    breaks: Break[];
    /** Source column each broken line started at. */
    columns: number[];
}

function column(node: NormalChild): number {
    return node.nodeType === 'Text' ? -1 : node.startPosition.column;
}

function lineStart(
    brk: Break,
    opNode: NormalChild,
    right: NormalChild,
): number {
    if (brk === 'before') return column(opNode);
    if (brk === 'after') return column(right);
    return -1;
}

function sourceBreak(level: NormalBranch, opNode: NormalChild): Break {
    const i = level.children.indexOf(opNode);
    const before = level.children[i - 1];
    const after = level.children[i + 1];
    if (before?.nodeType === 'Text' && before.text.includes('\n'))
        return 'before';
    if (after?.nodeType === 'Text' && after.text.includes('\n')) return 'after';
    return null;
}

// moc lexes `<`/`>` as comparisons only when spaced on both sides, else as type-argument brackets.
const ANGLE_OPS: ReadonlySet<string> = new Set(['<', '>']);

// In a control head moc reads `a -1` (spaced before, glued after) as a prefix starting the branch; the grammar reads a subtraction.
const PREFIX_SHAPED_OPS: ReadonlySet<string> = new Set(['-', '+', '^']);

function prefixShaped(level: NormalBranch, opNode: NormalChild): boolean {
    const i = level.children.indexOf(opNode);
    return (
        level.children[i - 1]?.nodeType === 'Text' &&
        level.children[i + 1]?.nodeType !== 'Text'
    );
}

function spacedBothSides(level: NormalBranch, opNode: NormalChild): boolean {
    const i = level.children.indexOf(opNode);
    return (
        level.children[i - 1]?.nodeType === 'Text' &&
        level.children[i + 1]?.nodeType === 'Text'
    );
}

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

function planChain(node: NormalBranch): Chain | null {
    if (node.kind !== 'bin_exp') return null;

    const operands: NormalChild[] = [];
    const ops: string[] = [];
    const breaks: Break[] = [];
    const columns: number[] = [];

    let current: NormalBranch = node;
    for (;;) {
        const level = threeParts(current);
        if (level === null) return null;
        const { left, opNode, right } = level;

        const op = opText(opNode);
        if (op === null) return null;
        if (!breaksBefore(op) && !mayTrail(op)) return null;
        if (ANGLE_OPS.has(op) && !spacedBothSides(current, opNode)) return null;
        if (PREFIX_SHAPED_OPS.has(op) && prefixShaped(current, opNode)) {
            return null;
        }

        if (
            right.nodeType === 'Branch' &&
            (right as NormalBranch).kind === 'bin_exp'
        ) {
            return null;
        }

        ops.unshift(op);
        operands.unshift(right);
        breaks.unshift(sourceBreak(current, opNode));
        columns.unshift(lineStart(breaks[0], opNode, right));

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

    return { operands, ops, breaks, columns };
}

function planCoalesce(node: NormalBranch): Chain | null {
    if (node.kind !== COALESCE_KIND) return null;

    const lefts: NormalChild[] = [];
    const ops: string[] = [];
    const breaks: Break[] = [];
    const columns: number[] = [];
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
        breaks.push(sourceBreak(current, opNode));
        columns.push(lineStart(breaks[breaks.length - 1], opNode, right));

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

    return { operands: [...lefts, tail], ops, breaks, columns };
}

/** A binary or `??` chain that breaks only where the source did, or `null` to leave it to the source-gap fallback. */
export function binaryChainDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    const chain = planCoalesce(node) ?? planChain(node);
    if (chain === null) return null;

    const { operands, ops, breaks, columns } = chain;
    const first = column(operands[0]);
    const aligned = breaks.every((b, i) => b === null || columns[i] === first);
    const rest: Doc[] = [];
    for (let i = 0; i < ops.length; i += 1) {
        const operand = print(operands[i + 1]);
        if (breaks[i] === 'before') rest.push(hardline, ops[i], ' ', operand);
        else if (breaks[i] === 'after')
            rest.push(' ', ops[i], hardline, operand);
        else rest.push(' ', ops[i], ' ', operand);
    }
    return [print(operands[0]), aligned ? rest : indent(rest)];
}
