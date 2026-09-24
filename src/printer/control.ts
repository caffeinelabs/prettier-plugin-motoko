/**
 * The control-flow area printer: `switch`/`case`, and why the other heads need nothing.
 *
 * ## The one thing this module decides: where a broken `switch` puts its arms
 *
 * `walk.ts`'s fallback prints a node's children with the source's gaps. For `switch` that is wrong in
 * exactly the way `exp.ts`'s header describes for chains — the source gaps between arms are a space
 * and a newline, and both survive flattening — but the visible symptom here is not an over-long line.
 * It is a *break in the wrong place*, which no gate in this repo reports and which is why the module
 * header carries the measured table rather than an argument:
 *
 * ```
 * // before — `.probe/_style.mts`, width 80
 * switch (someLongScrutineeExpressionHere) { case (
 *   #alphaVariant
 * ) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambda; case (
 *   #betaVariant
 * ) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambda; case (
 *   _
 * ) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambda }
 * ```
 *
 * The arm's *pattern* is a `tup_pat`, which owns a `comma_sep` list, so the generic list printer finds
 * a group to break and breaks it — inside the `case (` — while the arms themselves never get a line
 * of their own. `docs/style.md` §"Switch / case layout" asks for the opposite: one `case` per line
 * when the switch breaks, the arm's body hugging `case p { e }` when it fits.
 *
 * ## Why only `switch` is printed here
 *
 * `if`/`while`/`for`/`loop`/`try`/`do`/`async` already print correctly, and that is a measured
 * result, not an omission — `.probe/_style.mts` shows the `if`/`else` chain and the long `if`
 * breaking at the braces, and the `while`/`for`/`loop` fixture printing one statement per line. Each
 * of those heads is `head`, gap, head-expression, gap, body (`while_exp` is 5 children, `for_exp`
 * 11 with the `for`/`in` tokens as its head), so the source-gap printer reproduces them and the only
 * group that can break is the body's own list — which is already the right break. Adding a module for
 * them would be code with no rule behind it, so this one is scoped to the construct that has a rule
 * the printer gets wrong.
 *
 * ## `do`/`do ?` and the `exp_dec` wrapper
 *
 * A `switch` in this grammar is wrapped in `exp_dec` — the probe shows `source_file > exp_dec >
 * switch_exp` for a bare `switch`, not a direct `switch_exp` child — so this module is reached
 * through that wrapper, which prints as one child and lets the arm list break as a unit.
 *
 * ## The arm separator is a token, so it is reproduced and never chosen
 *
 * `docs/style.md` says the `;` after an arm is kept in `preserve` and dropped in `moc2`, and the
 * reason the distinction is real rather than cosmetic is the guard: `.probe/_switchsemi.mts` measures
 * that `switch x { case 1 { a }; case 2 { b } }` and its `;`-free spelling have *different shapes*, so
 * the `;` is a genuine child token. Dropping it here would be a guard failure, not a style choice.
 * So the arm's separator is emitted where the source had it, exactly as `parts.ts`'s
 * `trailingSeparator` does for a list — and between arms there is nothing else, because `case` ends
 * the previous arm and the grammar requires no separator there at all.
 */

import { doc } from 'prettier';
import type { Doc } from 'prettier';

import type { NormalBranch, NormalChild } from '../parser/normalize.ts';

const { group, indent, line } = doc.builders;

/** The kinds this module owns. Only `switch_exp` has a rule the generic printer gets wrong. */
const CONTROL_KINDS = new Set(['switch_exp']);

/**
 * The Doc for a control-flow node, or `null` when this module does not own it.
 *
 * Returning `null` rather than a Doc keeps the decision at the call site in `walk.ts`, where the
 * source-gap fallback already lives — see `exp.ts`'s header on why refusing is the safe direction.
 */
export function controlDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    if (!CONTROL_KINDS.has(node.kind)) return null;
    return switchDoc(node, print);
}

/**
 * A `switch`: the head, then one arm per line when the construct breaks.
 *
 * The shape, from `.probe/_ctrl.mts`:
 *
 *     switch_exp [12]
 *       Token "switch", Text " ", par_exp, Text " ", Token "{"
 *         case [5]:  Token "case", Text " ", tup_pat, Text " ", lit_exp
 *         Token ";"                     <- the source's arm separator, a real child
 *         case [5]:  ...
 *       Text " ", Token "}"
 *
 * So the arms are `children[5 .. -1]`, the head is `children[0..4]`, and the closing brace is the
 * last child. Anything that does not fit that description refuses the whole node.
 *
 * ## Why the arms are `line`-separated inside one `indent`
 *
 * `line` is the whole trick, and it is the same one `exp.ts` uses: flat it is a single space, which
 * is exactly the one-line switch `docs/style.md` explicitly allows
 * (`switch mode { case #up { +1 } case #dn { -1 } }` — real output at
 * `doc/md/reference/style-guide.md:881`), and broken it is a newline per arm at one indent level.
 * That satisfies both halves of the rule from one Doc, with no `ifBreak` and no second group.
 *
 * An `indent` wraps the whole arm run rather than each arm, because "arms are indented one level" is
 * a property of the run: nesting one indent per arm would push arm two under arm one.
 */
function switchDoc(
    node: NormalBranch,
    print: (child: NormalChild) => Doc,
): Doc | null {
    const children = node.children;
    // The smallest well-formed switch: `switch x { case p e }` — nine children, measured with
    // `.probe/_swcount.mts`: `switch`, gap, scrutinee, gap, `{`, gap, case, gap, `}`. Anything
    // shorter is not the shape this module takes apart. (The first draft of this line said ten, on
    // the reasoning that one more arm must mean one more child — but the gap before the closing brace
    // is part of the count, not extra, so ten rejected *every* one-arm switch and silently sent it to
    // the fallback.)
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
        // A gap between arms is layout, not content: the break is this module's decision, so the
        // source's own spacing here is deliberately dropped rather than reproduced. The blank-line
        // rule for arms is not stated in `docs/style.md`, so nothing is preserved and nothing invented.
        if (child.nodeType === 'Text') continue;

        // The source's own arm separator. It is a token, so it is reproduced exactly — see this
        // module's header. Attached to the arm it follows so that a broken switch leaves it trailing
        // that arm, which is the shape `docs/style.md`'s worked example shows.
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

    // A switch with no arms is not a construct this module has a rule for; the fallback is right.
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
 * One `case`: `case`, the pattern, the body — hugging on one line when it fits.
 *
 * ## Why the break between pattern and body is the fix, not decoration
 *
 * The defect in this module's header is that a broken switch put its break *inside* `case (` — the
 * `tup_pat` around the pattern owns a `comma_sep` list and was therefore the only break candidate
 * under the arm. `docs/style.md` names the answer: "the arm's body is indented one more level if it
 * breaks, and hugs `case p { e }` on one line if it fits." So the arm's own break belongs between
 * the pattern and the body, and the pattern stops being the only thing that can give.
 *
 * The mechanic is worth stating because it is not obvious that adding a break *here* stops a break
 * *there*: with a break present, the pattern's group is measured only as far as the next break in the
 * broken arm — `(#a)` — so it fits and stays flat. Without one, the nested group's fit check runs on
 * to the end of the arm's line, sees the long body, fails, and breaks itself. Both spellings have
 * identical tokens, so `verify.ts` is blind to the difference; the fixture is the only witness.
 *
 * ## Why the hug is decided by `canBreak` and not by "is it a list"
 *
 * "Hugs `case p { e }`" is the guide's phrasing, and the test for it is *whether the body has a break
 * of its own to give* — because a body that can break takes the break itself and leaves the arm's
 * line intact. That is `doc.utils.canBreak`, which recurses into nested groups, and it is the right
 * predicate rather than an approximation of one: the first draft tested `listOf(body) !== null`,
 * which catches a block or record but misses every other breakable body — most visibly a nested
 * `switch`, which printed as `case p` / `switch …` with the inner switch orphaned onto its own line
 * instead of hugging the arm. A body with genuinely no break point (a bare identifier, a long
 * literal) has nothing to give, so the arm's own break is the only move and the body goes down a
 * level: the "indented one more level" half of the rule.
 *
 * The tie is settled in the body's favour deliberately: a long call body breaks its arguments
 * (`case (#alphaVariant) someFunction(\n …\n)`) rather than the pattern, which is the ordering the
 * defect was about.
 *
 * ## What is *not* changed here
 *
 * The patterns the style guide lists as needing no parentheses (`case null`, `case ?n`, `case #leaf`)
 * are untouched, for the same reason the `moc2` rules are: this is `preserve`, and §"Case patterns:
 * parentheses" says the source's parens are kept as written. The `tup_pat` around a pattern is
 * printed as the source had it; only its *break behaviour* is overridden by this group.
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
    // A body that owns a break takes it and hugs; one that does not has to go down a level.
    const rest: Doc[] = doc.utils.canBreak(printedBody)
        ? [' ', printedBody]
        : [indent([line, printedBody])];

    return group([keyword.text, ' ', print(pattern), ...rest]);
}
