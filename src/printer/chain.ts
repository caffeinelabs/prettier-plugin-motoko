/**
 * The member-chain area printer: a chain of two or more links that doesn't fit breaks before each `.`, one link per line, one indent.
 *
 * The source-gap fallback in `walk.ts` would keep a flat chain on one over-long line, or break in a call's arguments as `).bar(\n  1\n)`.
 * The threshold counts links, not calls, so `a.b.c` breaks too. A one-link chain like `xs.map(f)` falls back and breaks in its arguments.
 * Gaps before `.` and `(` are `Text`, which the guard ignores, so they are dropped. The parens are tokens of the `par_exp`, printed whole.
 * A receiver that is itself a call (`f(a).x().y()`) is refused, since breaking there would separate a call from its argument list.
 */

import { doc } from 'prettier';
import type { Doc } from 'prettier';

import type { NormalBranch, NormalChild } from '../parser/normalize.ts';

const { group, indent, softline } = doc.builders;

/**
 * The walk stops at any other kind rather than expecting a `var_exp`, which keeps the receiver opaque.
 * `x.foo(a).1` has a `proj_exp` on top, so it falls back whole and the fallback's recursion reaches the inner chain, keeping the `.1`.
 */
const CHAIN_KINDS = new Set(['call_exp', 'dot_exp']);

interface Link {
    /** Empty while `planChain` waits for the callee's `dot_exp` to name the call. */
    name: string;
    /** `null` for a field access. */
    args: NormalChild | null;
}

interface Chain {
    head: NormalChild;
    links: Link[];
}

/**
 * Flattens a member chain into `{ head, links }`, or `null` if it isn't one.
 * The arity checks double as the comment check: a comment displaces an expected child, so a node that passes holds only `Text` gaps.
 */
function planChain(node: NormalBranch): Chain | null {
    if (!CHAIN_KINDS.has(node.kind)) return null;

    const links: Link[] = [];
    let cur: NormalChild = node;

    for (;;) {
        if (cur.nodeType !== 'Branch') return null;
        const branch = cur as NormalBranch;
        const children = branch.children;

        if (branch.kind === 'dot_exp') {
            // Four children when the source put a gap before the `.`, which is also this printer's own broken output.
            // Accepting only three would make formatting non-idempotent: pass two would fall back and reproduce the gap two columns left.
            if (children.length !== 3 && children.length !== 4) return null;
            if (children.length === 4 && children[1].nodeType !== 'Text')
                return null;
            const recv = children[0];
            const dot = children[children.length - 2];
            const name = children[children.length - 1];
            if (dot.nodeType !== 'Token' || dot.text !== '.') return null;
            if (name.nodeType !== 'Token') return null;

            // A `dot_exp` under a `call_exp` names that call rather than adding a link, filling the placeholder the call pushed.
            const previous = links[links.length - 1];
            if (previous !== undefined && previous.name === '') {
                previous.name = name.text;
            } else {
                links.push({ name: name.text, args: null });
            }
            cur = recv;
            continue;
        }

        // Two children when the source wrote `.name(`, three when it wrote `.name (`.
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

/** The Doc for a member chain, or `null` to leave the node to the source-gap fallback in `walk.ts`. */
export function memberChainDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    const chain = planChain(node);
    if (chain === null) return null;

    const { head, links } = chain;

    if (links.length < 2) return null;

    // `planChain` fills every placeholder, but an empty name would print a bare `.`, so refuse rather than trust it.
    for (const link of links) {
        if (link.name === '') return null;
    }

    const out: Doc[] = [print(head)];
    const rest: Doc[] = [];

    for (const link of links) {
        // `softline`, not `line`: flat there is nothing before the `.`, and broken every `.` shares the one `indent`.
        rest.push(softline, '.', link.name);
        if (link.args !== null) rest.push(print(link.args));
    }

    out.push(indent(rest));
    return group(out);
}
