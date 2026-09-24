import { doc } from 'prettier';
import type { Doc } from 'prettier';

import type { NormalBranch, NormalChild } from '../parser/normalize.ts';

const { group, indent, line } = doc.builders;

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

    const arms: Doc[] = [];
    for (const child of children.slice(5, -1)) {
        if (child.nodeType === 'Text') continue;

        if (child.nodeType === 'Token' && child.text === ';') {
            if (arms.length === 0) return null;
            arms[arms.length - 1] = [arms[arms.length - 1], ';'];
            continue;
        }

        if (child.nodeType !== 'Branch') return null;
        const arm = armDoc(child as NormalBranch, print);
        if (arm === null) return null;
        arms.push(arm);
    }

    if (arms.length === 0) return null;

    const run: Doc[] = [];
    for (let i = 0; i < arms.length; i += 1) {
        if (i > 0) run.push(line);
        run.push(arms[i]);
    }

    return group([
        keyword.text,
        ' ',
        print(scrutinee),
        ' ',
        open.text,
        indent([line, run]),
        line,
        close.text,
    ]);
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
    const rest: Doc[] = doc.utils.canBreak(printedBody)
        ? [' ', printedBody]
        : [indent([line, printedBody])];

    return group([keyword.text, ' ', print(pattern), ...rest]);
}
