/**
 * The M2 skeleton printer: a correct, structure-preserving walk with real list layout.
 *
 * This is step one of `docs/formatter-rework.md`'s M2 — the layer that makes every later area
 * printer a *local* change. It is deliberately shaped so that the whole file is one question: **for
 * this node, who decides the whitespace?** There are exactly three answers, and the third is the one
 * that keeps the guard green while the first two are still being written.
 *
 *  1. **A list kind decides it itself** (`parts.ts`'s table). Braces, parens, brackets and angles
 *     get a `group`: flat when it fits, one item per line with the source's own blank lines when it
 *     does not. This is where the semicolon rule lives, and it is the only place a separator is ever
 *     emitted or dropped.
 *  2. **A comment decides it** — comments are printed verbatim and force their group open, because a
 *     `//` that ends up flat on one line would swallow the rest of the list. That is a *meaning*
 *     change, so it is not a style preference; `docs/style.md` §"Comments" states it as required.
 *  3. **Otherwise the source decides it.** A node that is not a list is printed as its children in
 *     order with the gaps between them reproduced from the source. That is byte-exact for everything
 *     the printer does not yet understand, which is what keeps the guard's tolerance list empty.
 *
 * ## Why "the source decides it" is not just `verbatim`
 *
 * Emitting `node.text` for a whole subtree would be shorter, and it is what `parts.ts:verbatim`
 * does for a leaf. But it would also make the list printer unreachable: the first declaration in a
 * file is not a list, so `let a = { b = 1 }` would reproduce the record literal's *source* layout and
 * the record branch below would never run. Printing children individually lets a list deep inside an
 * otherwise-untouched declaration be re-laid out while its surroundings stay put — and because
 * `normalize.ts` builds `node.text` by concatenating children and gaps, the two agree exactly
 * wherever the list printer is not involved.
 *
 * ## Comments are printed here, not attached by Prettier
 *
 * The plugin registers no `canAttachComment`/`printComment`, so Prettier's attachment pass is inert
 * (`getSortedChildNodes` returns `[]` when `canAttachComment` is absent, and `printComments` is
 * never called without `printComment`). Comments are therefore ordinary children of the node they
 * sit in — which is what the CST gives us, in source order, already interleaved correctly. The
 * alternative, letting Prettier attach them, requires excluding comment nodes from their own
 * subtree or `decorateComment` self-attaches and `ensureAllCommentsPrinted` throws; a walk that
 * already visits `children` in order gets the correct result for free.
 */

import { doc } from 'prettier';
import type { AstPath, Doc, ParserOptions, Printer } from 'prettier';

import type { ParseResult } from '../parser/parse.ts';
import type {
    NormalBranch,
    NormalChild,
    NormalNode,
} from '../parser/normalize.ts';
import { verifyOutput } from '../verify.ts';
import { memberChainDoc } from './chain.ts';
import { controlDoc } from './control.ts';
import { binaryChainDoc } from './exp.ts';
import {
    betweenSeparator,
    hasBlankLine,
    isComment,
    isLineComment,
    listIndent,
    listItems,
    listOf,
    separatorLine,
    trailingSeparator,
    verbatim,
} from './parts.ts';
import type { ListDescriptor, ListItem } from './parts.ts';

const { breakParent, group, hardline } = doc.builders;
const { replaceEndOfLine } = doc.utils;

/**
 * The parse results, keyed by the root the printer is handed.
 *
 * The guard compares the printed output against the tree the printer was *given*, and the printer is
 * only handed the tree — so the `ParseResult` (which also carries `source`) has to be reachable from
 * the root object. A `WeakMap` rather than a property on the node: the tree is frozen as far as the
 * guard is concerned, and adding a field would change the very shape being compared.
 */
const ROOTS = new WeakMap<object, ParseResult>();

/** Remember a root's parse result so `print` can hand it to the guard. Called by the parser. */
export function rememberRoot(result: ParseResult): void {
    ROOTS.set(result.root, result);
}

/** The options the walk reads. Everything else Prettier passes is irrelevant to layout here. */
interface WalkOptions {
    /**
     * `semi` and `trailingComma` are **accepted but not read** in M2, and that is deliberate rather
     * than an oversight: both are instructions to *add or remove a separator*, and `preserve` may do
     * neither — the guard compares token texts and a separator is a token. They need no declaration
     * for a config naming them to resolve, because Prettier defines both itself; they are honoured in
     * `moc2` (M3), where the change is intended and the guard is told about it. `docs/style.md`'s
     * decision table documents the mechanics they will drive.
     */
    /** Handed to `printDocToString` so a nested render agrees with the outer one. */
    printWidth: number;
    tabWidth: number;
}

/**
 * A comment as a Doc: its source text, plus a forced break.
 *
 * `breakParent` is the load-bearing part. Without it a `// c` inside a flat list is emitted as a bare
 * string, the group flattens, and the next item lands on the same line — inside the comment. The
 * output then means something different from the input, which is exactly what `verify.ts` exists to
 * catch; forcing the break is what makes it not happen in the first place.
 */
function commentDoc(node: NormalNode): Doc {
    return [verbatim(node), breakParent];
}

/** Whether a comment's text is a `prettier-ignore` directive. */
function isIgnoreDirective(node: NormalNode): boolean {
    if (!isComment(node)) return false;
    const inner = node.text
        .replace(/^\/\//, '')
        .replace(/^\/\*+/, '')
        .replace(/\*+\/$/, '');
    return inner.trim() === 'prettier-ignore';
}

/** Whitespace reproduced exactly: newlines become `literalline` so the source's own indent survives. */
function gapDoc(text: string): Doc {
    return replaceEndOfLine(text);
}

/** Whether a gap holds a blank line, i.e. two or more newlines somewhere in it. */
function blankIn(gap: string | null): boolean {
    if (gap === null) return false;
    return gap.length - gap.replaceAll('\n', '').length >= 2;
}

/**
 * The document for one node.
 *
 * Order matters. A comment is checked before the list table because a comment *inside* a list is
 * itself a list "item" by `parts.ts`'s structural rule, and printing it as a nested list would be
 * wrong in a way that is hard to see: a lone block comment in a record prints the same either way,
 * but a block comment before a field would put the comment inside a group of one.
 */
function nodeDoc(node: NormalChild, ctx: WalkOptions): Doc {
    if (node.nodeType === 'Text') return gapDoc(node.text);
    if (isComment(node)) return commentDoc(node);
    if (node.nodeType === 'Token') return verbatim(node);

    const list = listOf(node);
    if (list) return listDoc(node, list, ctx);
    // Area printers, ahead of the source-gap fallback. Each returns `null` for a node it does not
    // own, so the fallback stays as wide as possible and a node nothing understands is still printed
    // byte-exactly. See `planChain`'s note on why refusing is the safe direction.
    const chain = binaryChainDoc(node as NormalBranch, (child) =>
        nodeDoc(child, ctx),
    );
    if (chain !== null) return chain;
    // A member chain is checked *after* a binary chain, and the order matters: a chain of `+`s must
    // not be examined as a chain of `.`s, and `chain.ts`'s spine walk would refuse it anyway, but
    // checking the more specific kind first is what keeps both refusals cheap.
    const member = memberChainDoc(node as NormalBranch, (child) =>
        nodeDoc(child, ctx),
    );
    if (member !== null) return member;
    const control = controlDoc(node as NormalBranch, (child) =>
        nodeDoc(child, ctx),
    );
    if (control !== null) return control;
    return branchDoc(node, ctx);
}

/**
 * A node that is not a list: its children, in order, with the source's gaps between them.
 *
 * This reproduces the node's source layout exactly — the same thing `verbatim` would produce — with
 * one difference that is the whole point: a child that *is* a list is handed to `listDoc`, so a
 * record literal or a parameter list nested anywhere in an otherwise-untouched subtree still gets
 * the real layout rules. Where no such child exists the two are identical, and the guard's empty
 * tolerance list is what proves it.
 */
function branchDoc(node: NormalBranch, ctx: WalkOptions): Doc {
    return node.children.map((child) => nodeDoc(child, ctx));
}

/**
 * A list: its delimiters, its items, and the separators the source put between them.
 *
 * The separator decision is per item, read from the source, and that is not an optimisation — it is
 * the only correct rule once comments are items. `{ a = 1; // c\n b = 2 }` has three items and only
 * one `;`, between the field and the comment; emitting `;` after every non-last item would put one
 * after the comment and then swallow `b = 2` inside it. So a separator is emitted where the source
 * had one, and a bare break where it did not.
 */
function listDoc(
    node: NormalBranch,
    list: ListDescriptor,
    ctx: WalkOptions,
): Doc {
    const items = listItems(node);

    if (items.length === 0) {
        // `{}` and `{\n\n}` are both empty lists, and the ported fixtures require the blank line to
        // survive (`docs/style.md` §"Interaction with the ported fixture expectations"). An empty
        // list has no items to carry the gap, so the node's own children are the only place it is.
        return hasBlankLine(node)
            ? [list.open, hardline, hardline, list.close]
            : [list.open, list.close];
    }

    // The close-glue decision needs to know what the *last item* is, and that is only answerable
    // here: see `listIndent`'s note on why the caller owns it. A line comment cannot have the close
    // after it on the same line, so the glue is dropped for that one case.
    const last = items[items.length - 1];
    return group([
        list.open,
        listIndent(
            listItemsDoc(items, list, ctx),
            list,
            last !== undefined && isLineComment(last.node),
        ),
        list.close,
    ]);
}

/** The joined body of a list: each item, and the separator or break the source put after it. */
function listItemsDoc(
    items: ListItem[],
    list: ListDescriptor,
    ctx: WalkOptions,
): Doc {
    const out: Doc[] = [];

    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const printed = itemDoc(item, items, i, ctx);
        out.push(printed);

        if (i === items.length - 1) {
            // The trailing separator reproduces the source's, exactly — see `trailingSeparator`,
            // which is the one place that decision is made and documents why the decision table's
            // layout-dependent column is not implementable under the runtime guard.
            out.push(
                trailingSeparator(
                    list.family,
                    item.separated,
                    isLineComment(item.node),
                ),
            );
            continue;
        }

        const next = items[i + 1];
        // Both branches hand `separatorLine` the *right* side as well as the left, because the
        // attachment rule needs it and only the caller has it: a comment the source wrote on this
        // item's own line must stay on it. `next.gap` is the source's layout, and it is what says
        // whether "on this item's own line" is what the source did.
        if (item.separated) {
            out.push(
                betweenSeparator(
                    list.family,
                    printed,
                    next.gap,
                    isLineComment(item.node),
                    isComment(next.node),
                ),
            );
        } else {
            out.push(separatorLine(printed, next.gap, isComment(next.node)));
        }
    }

    return out;
}

/** One item, honouring a `prettier-ignore` on the item before it. */
function itemDoc(
    item: ListItem,
    items: ListItem[],
    index: number,
    ctx: WalkOptions,
): Doc {
    const previous = index > 0 ? items[index - 1] : null;
    if (previous && isIgnoreDirective(previous.node))
        return verbatim(item.node);
    return nodeDoc(item.node, ctx);
}

/**
 * The declaration list of a file.
 *
 * Not a `group`: a file is always broken, so a group would only add a flattening pass whose answer is
 * known. The separators are `hardline` for the same reason, and the style guide's "a blank line is
 * kept, and at most one" falls out of using two of them.
 *
 * ## The trailing newline is derived, not reproduced
 *
 * A file's last character is a **gap**, and it is the one gap the walk cannot copy: `replaceEndOfLine`
 * renders a newline as `literalline`, and Prettier's line writer `trim`s `literalline` on the way out
 * — so reproducing the source's own tail emits *nothing*. (`hardline` does not trim, `.probe/_render.mts`.)
 * That is why this function does not simply return the last item's gap the way `listItemsDoc` does for
 * a list: it emits a `hardline` instead, exactly one, whenever the file has any content at all.
 *
 * One trailing newline, unconditionally, is also what Prettier's own contract requires — the newline
 * is the formatter's, not the input's; `prettier.format('let x = 1')` yields `'let x = 1\n'`, and the
 * pre-rewrite engine obeyed the same rule.
 *
 * This was a real bug, and it was **invisible to all three M2 gates**: `shapeOf` has no node for a
 * trailing gap, so the runtime guard could not see the newline; idempotence is satisfied trivially
 * once it is gone; and the churn report's whitespace tiers classify the difference as `layoutOnly`.
 * So the tests here are the *only* thing that caught it, which is the argument for asserting exact
 * output rather than asserting "no guard failure".
 *
 * The whitespace-only file is the case that looks like an exception and is not one. A file with no
 * items prints the empty string rather than a bare newline, matching Prettier's own treatment of an
 * empty document (and 0.13's) — which is also right for the right reason: `hardline` on an empty Doc
 * is a `line` that flattens to `''`, so a document that is *only* a break is not a document with a
 * trailing newline, it is an empty one.
 */
function sourceFileDoc(node: NormalBranch, ctx: WalkOptions): Doc {
    const items = listItems(node);
    // No items means no content — including for `\n\n`, where the blank line is the *only* thing in
    // the file. Emitting it would produce a file holding a lone newline, which is not what an empty
    // list prints. See the paragraph above on why this is not an exception.
    if (items.length === 0) return '';

    const out: Doc[] = [];
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        out.push(itemDoc(item, items, i, ctx));

        const isLast = i === items.length - 1;

        // The source's own separator, and nothing else. A file is a `semi_sep` list like any other,
        // so `trailingSeparator`'s rule applies unchanged: the guard compares token texts, so an
        // inter-declaration `;` the source omitted must stay omitted. Emitting one "because the
        // grammar requires it between two declarations" would be *safe* for the parser and still
        // wrong for the guard, which reports a child-count change rather than a parse failure.
        //
        // A declaration is never a comment, but a *comment* can be a source-file item in its own
        // right, and `let o = 1 // c` / `;` makes exactly that true: the `;` is the comment's own
        // separator, so it falls to `trailingSeparator` and to the leading-separator rule there.
        out.push(
            trailingSeparator(
                'semi_sep',
                item.separated,
                isLineComment(item.node),
            ),
        );

        if (isLast) continue;
        out.push(declarationBreak(items[i + 1]));
    }

    // The one hardline the file does not get from its own source. See the header: the source's tail
    // gap cannot survive `literalline`'s trim, so this is emitted rather than reproduced.
    out.push(hardline);
    return out;
}

/**
 * The break between two declarations in a file: the source's blank line if it had one, otherwise one
 * newline — unless a comment followed on the same line, which the seam must then stay on.
 *
 * A declaration list is always broken, so this is normally the `hardline` the paragraph above
 * describes. It is not a `separatorLine` call, and deliberately so: that function's answer is a soft
 * `line` in the ordinary case, which a flat group would collapse into a space and run two
 * declarations together. A file has no group around it, so a soft `line` here would print
 * `let a = 1 let b = 2`.
 *
 * The exception is the same one `separatorLine` documents, and it is checked here rather than
 * delegated for that reason. `let o = 1; // c` newline `let p = 2` puts the comment at the end of
 * the first declaration's line, and the source's blank-line rule cannot speak to it: the comment is
 * *between* the declarations, so it is `next`, and its own `breakParent` supplies the break before
 * `let p`. All this seam owes is the space that keeps the comment off its own line.
 */
function declarationBreak(next: ListItem): Doc {
    const commentOnThisLine =
        isComment(next.node) && (next.gap === null || !next.gap.includes('\n'));
    if (commentOnThisLine) return ' ';
    return blankIn(next.gap) ? [hardline, hardline] : hardline;
}

/**
 * Build the Prettier printer for `AST_FORMAT`.
 *
 * The returned object registers no comment hooks, and that is a decision rather than an omission:
 * see this module's header. The only hooks it does register are the ones Prettier cannot infer —
 * `print`, the visitor keys (the default would walk `startPosition`/`fields`, which are not nodes),
 * and the location accessors, which live on the *parser* in Prettier 3 and are re-read from there.
 */
export function createPrinter(): Printer<NormalChild> {
    return {
        /**
         * The child key, for the traversal Prettier does itself: cursor location, embedded-language
         * discovery, and comment attachment (which is inert here).
         *
         * `['children']` for a branch and `[]` for everything else, because `getChildren` yields
         * each element of an array-valued key *individually* when it is an object — so a `Text` gap
         * would be yielded as a node. That matters even with attachment inert: `getCursorLocation`
         * walks the same keys, and a `Text` gap has no children but does have a span, so it would
         * become the cursor node for any offset inside it.
         */
        getVisitorKeys: (node: NormalChild) =>
            node.nodeType === 'Branch' ? ['children'] : [],

        /**
         * Print a node, and — at the root — prove the result still means the same thing.
         *
         * The guard runs here rather than in a wrapper because the root is the one call whose Doc
         * covers the whole file, so it is the one place the printed text is a complete program.
         *
         * It renders a *copy* for the guard and returns the original Doc, rather than returning the
         * rendered string. Handing the string back would be simpler and is what an earlier draft did,
         * but a bare string has no `cursor` placeholders and no line suffixes, so cursor-offset
         * formatting would silently stop working. The extra render costs one pass over a Doc that is
         * already built, and it is rendered with the very options Prettier is about to use — so the
         * two renders agree, and `propagateBreaks`' mutations are idempotent between them.
         */
        print: (path: AstPath<NormalChild>, options: ParserOptions) => {
            const ctx: WalkOptions = {
                printWidth: options.printWidth ?? 80,
                tabWidth: options.tabWidth ?? 2,
            };

            const node = path.node;
            if (!path.isRoot || node.nodeType !== 'Branch') {
                return nodeDoc(node, ctx);
            }

            const root: NormalBranch = node;
            const built = group(
                listOf(root) ? sourceFileDoc(root, ctx) : nodeDoc(root, ctx),
            );

            const result = ROOTS.get(root) ?? null;
            if (result === null) {
                // The tree did not come through `parse`, so there is nothing to compare against.
                return built;
            }

            // `Printer.print` is declared to return `Doc`, but Prettier awaits the *root* call
            // (`printAstToDoc` in `prettier/index.mjs` does `await callPluginPrintFunction(...)`),
            // and a re-parse cannot be done synchronously. The cast states that the declared type is
            // narrower than the contract Prettier actually honours; no nested call returns a Promise,
            // so the un-awaited `mainPrintInternal` path never sees one.
            return guard(result, built, options) as unknown as Doc;
        },
    };
}

/**
 * Render a copy of the root's Doc, check it, and return the original.
 *
 * `verifyOutput` needs the text, so the copy is rendered here; what the caller keeps is `built`,
 * which is what Prettier will emit. The options are passed through whole rather than rebuilt: the
 * declared `printDocToString` options type omits `endOfLine`, but the implementation reads it
 * (`const newLine = convertEndOfLineToChars(options.endOfLine)`) and would splice `undefined` into
 * every newline in the output. Spreading the real options avoids both the type lie and that hazard,
 * and it makes the checked text and the emitted text the same text.
 */
async function guard(
    result: ParseResult,
    built: Doc,
    options: ParserOptions,
): Promise<Doc> {
    const rendered = doc.printer.printDocToString(built, options).formatted;
    await verifyOutput(result.root, rendered);
    return built;
}
