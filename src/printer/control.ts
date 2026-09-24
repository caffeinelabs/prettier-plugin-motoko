/**
 * The control-flow area printer: a `switch` that breaks puts one arm per line, and one that fits stays on a single line.
 *
 * The source-gap fallback breaks inside an arm's `case (` instead, because the `tup_pat` owns the only breakable list under the arm.
 * Other heads (`if`, `while`, `for`, `loop`, ...) need nothing here: the fallback reproduces them and only their bodies' lists break.
 * The `;` after an arm is a real token that changes the tree's shape, so it is reproduced where the source had it, never chosen.
 */

import { doc } from 'prettier';
import type { Doc } from 'prettier';

import type { NormalBranch, NormalChild } from '../parser/normalize.ts';

const { group, indent, line } = doc.builders;

/** Only `switch_exp` has a rule the generic printer gets wrong. */
const CONTROL_KINDS = new Set(['switch_exp']);

/** The Doc for a control-flow node, or `null` to leave it to the source-gap fallback in `walk.ts`. */
export function controlDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    if (!CONTROL_KINDS.has(node.kind)) return null;
    return switchDoc(node, print);
}

/**
 * A `switch` is `switch`, gap, scrutinee, gap, `{`, then arms with their `;` and gaps, then `}`. Any other shape refuses the node.
 * The arms are `line`-separated in one `indent`, so flat it is a one-line switch and broken each arm gets its own line.
 */
function switchDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    const children = node.children;
    // The smallest switch, `switch x { case p e }`, is nine children counting the gap before `}`.
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
        // Gaps between arms are dropped: the break is this module's call, and a blank line between arms is neither kept nor invented.
        if (child.nodeType === 'Text') continue;

        // Attached to the arm it follows, so a broken switch leaves the `;` trailing that arm.
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

/**
 * One `case`, hugging `case p { e }` when it fits, else breaking between pattern and body.
 *
 * With a break there, the pattern's group only has to fit up to it, so `(#a)` stays flat instead of breaking inside `case (`.
 * The body hugs when `canBreak` finds a break of its own to give, nested groups like an inner `switch` included.
 * A body with none, such as a long identifier, goes down one indent level instead. Pattern parens are kept as written.
 */
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
