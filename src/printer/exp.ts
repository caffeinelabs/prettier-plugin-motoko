import { doc } from 'prettier';
import type { Doc } from 'prettier';

import {
    breakAfterOperator,
    coalesceOperator,
    isIndivisible,
} from './adjacency.ts';
import type { NormalBranch, NormalChild } from '../parser/normalize.ts';

const { group, indent, line } = doc.builders;

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

interface Chain {
    operands: NormalChild[];
    ops: string[];
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

    let current: NormalBranch = node;
    for (;;) {
        const level = threeParts(current);
        if (level === null) return null;
        const { left, opNode, right } = level;

        const op = opText(opNode);
        if (op === null) return null;
        if (!breaksBefore(op) && !mayTrail(op)) return null;

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

    return { operands, ops };
}

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
