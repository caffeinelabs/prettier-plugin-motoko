/**
 * The member-chain area printer: where a chain that does not fit puts its breaks.
 *
 * ## The one thing this module decides: which link owns the break
 *
 * `walk.ts` prints a node it does not understand as its children with the **source's own gaps**
 * reproduced. For a member chain that is wrong in the same way `exp.ts`'s header describes for binary
 * chains — the source gaps are spaces, a space never breaks, so a chain written flat on one line stays
 * on one line and runs past `printWidth` forever — and the fallback actively prefers the *wrong* break
 * when the source is not flat, because a bare call's own `par_exp` is a breakable list and becomes the
 * only break candidate under the node. Measured (`.probe/_mc_cur.mts`): a 208-character three-call
 * chain prints as one over-long line, and `x.field.someFunction(aLongArgument).bar(1)` breaks as
 * `).bar(\n  1\n)` — a break between a call and the argument list that follows it, which is neither of
 * the two shapes `docs/style.md` §"Member chains" allows.
 *
 * The rule, from that section:
 *
 * > One call per line once there are more than two calls and the chain does not fit, breaking
 * > **before** the `.` with 2-space indent.
 * >
 * > A chain with two or fewer calls does not use the chain rule at all, even when it overflows
 * > `printWidth`: it breaks at the arguments instead.
 *
 * So the break belongs to the **`.`**: one per line, the `.` leading, one indent for the whole run.
 * That is the same shape `exp.ts` gives a `|>` pipeline, and `docs/style.md`'s conflict ruling on
 * member-chain direction says the two agreeing is why the direction was ruled the way it was — the
 * plan states the threshold but not the direction, so the old test is the only evidence.
 *
 * ## The spine, measured
 *
 * Every chain in the language is the same uniformly left-leaning spine of two kinds
 * (`.probe/_mc_shape.mts`, `.probe/_mc_gap.mts`):
 *
 *     dot_exp[ recv, ".", name ]           <- a field access: three children
 *     dot_exp[ recv, Text, ".", name ]     <- the same, with the break the source wrote before `.`
 *     call_exp[ dot_exp, par_exp ]         <- a call, when the source wrote `.name(`
 *     call_exp[ dot_exp, Text, par_exp ]   <- the same call, when the source wrote `.name (`
 *
 * The two four-child spellings are the same node with a gap in it, and `planChain` takes both — see
 * the note on the arity check below for why accepting only the three-child one is a trap.
 *
 * so walking `children[0]` from the top of the chain bottoms out at the receiver. A field-only chain
 * carries no `call_exp` links at all and is the *same* walk; `x[0]` and `f()` differ only in what the
 * walk bottoms out on. That last point is why `planChain` treats the receiver as opaque and hands it to
 * the shared printer: it is the one node here whose kind varies, and printing it is not this module's
 * business.
 *
 * ## Normalising the source's own spacing, which the guard permits and this module needs
 *
 * Two of the chain's spaces are the source's and both are *droppable*, for one measured reason:
 * `shapeOf` maps every `Text` node to `null` and filters nulls out, so a gap carries no meaning to the
 * comparison at all. That licenses the two things this module does that a pure reproduction could not:
 * it emits nothing before `(` whether or not the source had a space there, and nothing before the first
 * `.`. The gap is not always flat, either: `.probe/_mc_gap.mts` measures `x.foo\n  (a)` as a third
 * `Text` child holding `"\n  "`, and reproducing that break would strand `.foo(a)` on a line of its own
 * with the indent in the wrong place. The parentheses themselves are *not* droppable — they are tokens,
 * children of the `par_exp` this module prints whole — so the printed argument list is `(`, the
 * source's own arguments, `)` and the guard sees the same tokens it started with.
 *
 * ## The threshold: two links, not two calls
 *
 * The rule above says "more than two calls", and the code does not implement that. It implements
 * **two or more links**, and the rule's own wording is not the evidence — the old test is. Read off
 * `.probe/_mc_final.mts` and `docs/style.md:548-573` together, the two counts disagree on the case the
 * style guide cites, and the citation wins:
 *
 * - The **style guide's worked example** is `x.repeat(50)` seven times: seven dots, seven links, seven
 *   calls, and it breaks. Any threshold at or below seven prints it.
 * - The **old test** is `${ident}.${ident}.${ident}` — **two** dots, **no** calls at all, and *both*
 *   dots break. The ruling at `docs/style.md:640-648` adopts that test's direction ("break before the
 *   `.`") as the concrete reading of the rule, which makes it the one case the threshold must not
 *   refuse. So the threshold cannot be a count of calls, and it cannot be "more than two `.`s" either:
 *   both readings refuse the very case the ruling rests on.
 * - What remains is the floor: refuse a chain too short to have a shape at all. `links.length < 2`
 *   refuses `x.foo` and `x.foo(a)` — which have one link and no break to make — and accepts the old
 *   test's two. That is the whole rule, and it is deliberately weaker than the prose, because a
 *   threshold that refuses the cited evidence is a threshold read off the wrong source.
 *
 * The consequence is that **the well-formed cases refused on purpose are the structural ones below,
 * not a count**: a receiver that is a call, and a chain with a projection in it. Everything else with
 * two or more links is laid out, even a chain the prose's count of calls would leave alone.
 *
 * ## The fit half of the rule, and what `group` already does with it
 *
 * "…and the chain does not fit" comes from the group this module returns, which is the same mechanism
 * `exp.ts` relies on for binary chains and for the same reason: flat the chain is its own source text
 * character for character, so a chain that fits is a fixed point. `docs/style.md`'s
 * `xs.map(func (x : Nat) : Nat { x + 1 })` example — one call, over `printWidth` — is the case the
 * style guide says must break **inside its argument list**, not at the `.`, and this module never sees
 * it: one call is one link, below the floor above, so the node goes to the fallback, whose recursion
 * reaches the `par_exp` and lets the list printer break it. Measured (`.probe/_mc_final.mts`); the
 * count and the fit therefore live in two places on purpose, and the count runs first.
 *
 * ## The refusals, and why refusing is the safe direction
 *
 * `planChain` returns `null` for a node that is not this spine and `memberChainDoc` returns `null` for
 * a chain this module declines to lay out. `null` sends the node back to the source-gap fallback, which
 * is always *correct*, just unbroken — the same trade `exp.ts` documents for chains it cannot flatten.
 * Two are mechanical (an unexpected child count, or a comment where a gap belongs, is not this shape);
 * one is a decision:
 *
 * - **A receiver that is itself a call** (`f(a).x().y().z()`). Breaking it would put `f(a)` on a line
 *   by itself and open the next line with `.x()`, so the break lands between a call and its own
 *   argument list — the shape `x.field.foo(LONG).bar(1)` is already wrong for, one level up. Both
 *   worked examples and the old test have a *plain* receiver (`x`), so there is no evidence for what
 *   the rule wants here; guessing costs a wrong layout, refusing costs one long line. Measured
 *   (`.probe/_mc_final.mts`), refusing still yields something readable, because the fallback hands the
 *   receiver's own `par_exp` to the list printer and *that* breaks: `f(\n  a\n).x().y().z()`.
 *
 * ## The projection is not a refusal, and the walk's termination is why
 *
 * **A number projection in the chain** (`x.foo(a).1`) was expected to be a refusal and is not one, so
 * the distinction is worth stating rather than leaving as a surprise. `x.1` is a `proj_exp`, not a
 * `dot_exp`, and `x.foo(a).1` lifts that projection to the *top* of the spine — so `memberChainDoc` is
 * called on the `proj_exp` (not a chain kind → `null`) and the whole node goes to the fallback, which
 * prints the `proj_exp`'s children: the inner chain, then `Text`, then `.1` with no gap between them.
 * The inner chain *is* a chain this module owns, so the fallback's child recursion reaches it, and the
 * result composes — one link per line, projection glued to the last (`.epsilonZetaEtaTheta.1`).
 *
 * That composition is correct for the guard and it is why the walk terminates on **an unknown kind**
 * rather than asserting it has reached a `var_exp`: a `dot_exp`-only walk would have consumed `x.foo(a)`
 * as a complete chain and printed it without the `.1` it never looked at, silently dropping a token.
 * Terminating on the wrong kind makes the module stop *before* the projection and leaves the node to
 * something that prints all of it. The glued `.1` is `preserve`'s answer, not the module's: a
 * `softline` there would be this module choosing the projection's layout, which is the patterns-and-
 * types area's question.
 */

import { doc } from 'prettier';
import type { Doc } from 'prettier';

import type { NormalBranch, NormalChild } from '../parser/normalize.ts';

const { group, indent, softline } = doc.builders;

/**
 * The link kinds, which are also the only kinds the walk may step through.
 *
 * A set rather than an inline test because the walk's termination condition is *not* "I reached a
 * `var_exp`" — it is "this kind is not a link", which is what keeps the receiver opaque. That is the
 * difference that stops `x.foo(a).1`'s `proj_exp` from being mistaken for a receiver.
 */
const CHAIN_KINDS = new Set(['call_exp', 'dot_exp']);

/** One `.`-introduced step of the chain, in source order. */
interface Link {
    /** The field or method name. Never empty — see `planChain` and the check in `memberChainDoc`. */
    name: string;
    /** The argument list to print, or `null` for a field access. */
    args: NormalChild | null;
}

/**
 * A chain taken apart: the receiver, and the links, left to right.
 *
 * The receiver is stored whole rather than reconstructed because it is the one node here whose kind
 * varies — `var_exp`, `lit_exp`, `array_idx_exp`, and combinations that carry an entire nested chain
 * inside an argument all measured as heads (`.probe/_mc_shape.mts`).
 */
interface Chain {
    head: NormalChild;
    links: Link[];
}

/**
 * Flatten a member chain into `{ head, links }`, or `null` if it is not this shape.
 *
 * The walk steps `children[0]` from the top of the chain down to the receiver, collecting a link at
 * each level. Both kinds are checked for their exact measured shape, and those checks are also the
 * comment check: a comment can only appear here by displacing one of the expected children and
 * changing the arity, so a node that passes has no comment in it, and the `Text` it does carry is a
 * gap whose content `shapeOf` ignores.
 *
 * Depth is bounded by the expression, which is bounded by the file, so no explicit limit is needed.
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
            // Three children when the source wrote `x.foo`, four when it put something before the
            // `.` — measured (`.probe/_mc_arity.mts`, `.probe/_mc_cst.mts`):
            //
            //     dot_exp [3] = recv , Token"." , Token"name"
            //     dot_exp [4] = recv , Text"\n    " , Token"." , Token"name"
            //
            // Accepting only the three-child spelling is what made this printer non-idempotent, and
            // the mechanism is worth stating because the bug was invisible in every single-file
            // check: the printer's *own output* is the four-child spelling, so pass two refused the
            // chain pass one had just laid out, fell through to the source-gap fallback, and
            // reproduced the gap as `literalline` — which trims — moving the chain two columns left.
            // Pass two is the fixed point and pass one overshoots, so only `format(format(x)) ==
            // format(x)` sees it. The gap after the receiver is the one this module deliberately does
            // not reproduce: `shapeOf` maps every `Text` to `null` and filters nulls, so it carries
            // no meaning to the guard, and the `softline` each link emits replaces it.
            if (children.length !== 3 && children.length !== 4) return null;
            if (children.length === 4 && children[1].nodeType !== 'Text')
                return null;
            const recv = children[0];
            const dot = children[children.length - 2];
            const name = children[children.length - 1];
            if (dot.nodeType !== 'Token' || dot.text !== '.') return null;
            if (name.nodeType !== 'Token') return null;

            // A `dot_exp` directly beneath a `call_exp` *names that call* rather than adding a link:
            // `x.foo(a)` is `call_exp[dot_exp[x, ".", foo], par_exp]`, one step of the chain and not
            // two. `planChain` records the call first with a placeholder name, so a placeholder at the
            // end of `links` is exactly the signal that this `dot_exp` is that call's callee.
            const previous = links[links.length - 1];
            if (previous !== undefined && previous.name === '') {
                previous.name = name.text;
            } else {
                links.push({ name: name.text, args: null });
            }
            cur = recv;
            continue;
        }

        // `call_exp`. Two children when the source wrote `.name(`, three when it wrote `.name (`.
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

            // The placeholder the `dot_exp` below fills in. Reaching the receiver with a placeholder
            // still unfilled is impossible: `links` is only left with one pending when the callee was
            // not a `dot_exp`, which the check above already refused.
            links.push({ name: '', args });
            cur = callee;
            continue;
        }

        links.reverse();
        return { head: cur, links };
    }
}

/**
 * The Doc for a member chain, or `null` when the node is not one this module lays out.
 *
 * `null` rather than a Doc, so the decision stays at the call site in `walk.ts` beside the other area
 * printers — a printer that returned the source layout here would be indistinguishable from one that
 * had decided the source layout was right.
 */
export function memberChainDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    const chain = planChain(node);
    if (chain === null) return null;

    const { head, links } = chain;

    // The threshold. See the header: it is a count of `.`-links, and the evidence for it being two
    // rather than three is the old test, whose two dots both break.
    if (links.length < 2) return null;

    // A link with no name means the receiver was a call — `planChain` leaves the placeholder unfilled
    // when a `call_exp`'s callee is not a `dot_exp` — so this refuses `f(a).x().y().z()` and keeps the
    // walk's arity checks from having to know about it. Stated as a `return null` rather than a comment
    // because the alternative, emitting `.undefined`, would be a guard failure.
    for (const link of links) {
        if (link.name === '') return null;
    }

    const out: Doc[] = [print(head)];
    const rest: Doc[] = [];

    for (const link of links) {
        // `softline`, not `line`, and the difference is the whole flat rendering: `line` is a space at
        // rest and would emit `x .foo(a)`, while `softline` is the empty string — which is what the
        // source has, `.probe/_mc_cur.mts` having printed `x.repeat(50)…` with nothing before the `.`.
        // Broken, `softline` is a newline like any other, and because every one of them sits inside the
        // single `indent` each `.` lands at one level rather than stepping right per link.
        rest.push(softline, '.', link.name);
        // The argument list, printed whole: `par_exp`'s children are the source's own `(` and `)`, so
        // the guard compares the same tokens it started with. See the header on the one gap this module
        // deliberately does not reproduce.
        if (link.args !== null) rest.push(print(link.args));
    }

    out.push(indent(rest));
    return group(out);
}
