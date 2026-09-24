import { doc } from 'prettier';
import type { Doc } from 'prettier';

import type { NormalBranch, NormalChild } from '../parser/normalize.ts';
import { isComment } from './parts.ts';

const { hardline, indent } = doc.builders;

const CONTROL_KINDS = new Set(['switch_exp']);

export function controlDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    if (!CONTROL_KINDS.has(node.kind)) return null;
    return switchDoc(node, print);
}

function switchDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    const children = node.children;
    if (children.length < 9) return null;

    const [keyword, gap1, scrutinee, gap2, open] = children;
    if (keyword.nodeType !== 'Token' || keyword.text !== 'switch') return null;
    if (open.nodeType !== 'Token' || open.text !== '{') return null;
    if (gap1.nodeType !== 'Text' || gap2.nodeType !== 'Text') return null;
    if (scrutinee.nodeType !== 'Branch') return null;

    const close = children[children.length - 1];
    if (close.nodeType !== 'Token' || close.text !== '}') return null;

    const run: Doc[] = [];
    let gap: string | null = null;
    for (const child of children.slice(5, -1)) {
        if (child.nodeType === 'Text') {
            gap = child.text;
            continue;
        }
        if (child.nodeType === 'Token' && child.text === ';') {
            if (run.length === 0) return null;
            run.push(';');
            gap = null;
            continue;
        }

        let item: Doc;
        if (isComment(child)) {
            item = print(child);
        } else {
            if (child.nodeType !== 'Branch') return null;
            const arm = armDoc(child as NormalBranch, print);
            if (arm === null) return null;
            item = arm;
        }
        if (run.length > 0) run.push(separator(gap));
        run.push(item);
        gap = null;
    }

    if (run.length === 0) return null;

    const broken = children.some(
        (c) => c.nodeType === 'Text' && c.text.includes('\n'),
    );
    const head = [keyword.text, ' ', print(scrutinee), ' ', open.text];
    return broken
        ? [head, indent([hardline, run]), hardline, close.text]
        : [head, ' ', run, ' ', close.text];
}

function separator(gap: string | null): Doc {
    if (gap === null || !gap.includes('\n')) return ' ';
    const newlines = gap.length - gap.replaceAll('\n', '').length;
    return newlines >= 2 ? [hardline, hardline] : hardline;
}

function armDoc(
    arm: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    const children = arm.children;
    if (children.length !== 5) return null;

    const [keyword, gap1, pattern, gap2, body] = children;
    if (keyword.nodeType !== 'Token' || keyword.text !== 'case') return null;
    if (gap1.nodeType !== 'Text' || gap2.nodeType !== 'Text') return null;
    if (pattern.nodeType !== 'Branch' || body.nodeType !== 'Branch')
        return null;

    const printedBody = print(body);
    const rest: Doc[] = gap2.text.includes('\n')
        ? [indent([hardline, printedBody])]
        : [' ', printedBody];

    return [keyword.text, ' ', print(pattern), ...rest];
}
