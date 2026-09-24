import { doc } from 'prettier';
import type { Doc } from 'prettier';

import type { NormalBranch, NormalChild } from '../parser/normalize.ts';

const { group, indent, softline } = doc.builders;

const CHAIN_KINDS = new Set(['call_exp', 'dot_exp']);

interface Link {
    name: string;
    args: NormalChild | null;
}

interface Chain {
    head: NormalChild;
    links: Link[];
}

function planChain(node: NormalBranch): Chain | null {
    if (!CHAIN_KINDS.has(node.kind)) return null;

    const links: Link[] = [];
    let cur: NormalChild = node;

    for (;;) {
        if (cur.nodeType !== 'Branch') return null;
        const branch = cur as NormalBranch;
        const children = branch.children;

        if (branch.kind === 'dot_exp') {
            // Four children is also this printer's own broken output, so rejecting it would make formatting non-idempotent.
            if (children.length !== 3 && children.length !== 4) return null;
            if (children.length === 4 && children[1].nodeType !== 'Text')
                return null;
            const recv = children[0];
            const dot = children[children.length - 2];
            const name = children[children.length - 1];
            if (dot.nodeType !== 'Token' || dot.text !== '.') return null;
            if (name.nodeType !== 'Token') return null;

            const previous = links[links.length - 1];
            if (previous !== undefined && previous.name === '') {
                previous.name = name.text;
            } else {
                links.push({ name: name.text, args: null });
            }
            cur = recv;
            continue;
        }

        if (branch.kind === 'call_exp') {
            if (children.length !== 2 && children.length !== 3) return null;
            const [callee, ...tail] = children;
            const args = tail[tail.length - 1] ?? null;
            if (tail.length === 2 && tail[0].nodeType !== 'Text') return null;
            if (callee === undefined || callee.nodeType !== 'Branch')
                return null;
            if ((callee as NormalBranch).kind !== 'dot_exp') return null;
            if (args === null || args.nodeType !== 'Branch') return null;
            if ((args as NormalBranch).kind !== 'par_exp') return null;

            links.push({ name: '', args });
            cur = callee;
            continue;
        }

        links.reverse();
        return { head: cur, links };
    }
}

export function memberChainDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    const chain = planChain(node);
    if (chain === null) return null;

    const { head, links } = chain;

    if (links.length < 2) return null;

    for (const link of links) {
        if (link.name === '') return null;
    }

    const out: Doc[] = [print(head)];
    const rest: Doc[] = [];

    for (const link of links) {
        rest.push(softline, '.', link.name);
        if (link.args !== null) rest.push(print(link.args));
    }

    out.push(indent(rest));
    return group(out);
}
