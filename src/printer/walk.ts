/**
 * The printer walk: lists get real layout, comments force breaks, and everything else reproduces the source's gaps.
 *
 * A non-list node prints its children with the source's gaps rather than `verbatim(node)`,
 * so a list nested inside an otherwise untouched declaration is still laid out.
 * The two agree wherever no list is involved, because `normalize.ts` builds `node.text` from the children and gaps.
 *
 * Comments are printed as ordinary children rather than through Prettier's attachment.
 * Without `canAttachComment`/`printComment` Prettier's attach pass is inert, and the CST already interleaves comments in source order.
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
    isImport,
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

// The printer is only handed the tree, so the guard's `ParseResult` is looked up by root.
// A `WeakMap` rather than a field on the node, because a new field would change the shape the guard compares.
const ROOTS = new WeakMap<object, ParseResult>();

export function rememberRoot(result: ParseResult): void {
    ROOTS.set(result.root, result);
}

interface WalkOptions {
    // `semi` and `trailingComma` are deliberately not read: adding or dropping a separator changes the tokens the guard compares.
    printWidth: number;
    tabWidth: number;
}

/** `breakParent`, because a `//` flattened onto one line would swallow the code after it. */
function commentDoc(node: NormalNode): Doc {
    return [verbatim(node), breakParent];
}

function isIgnoreDirective(node: NormalNode): boolean {
    if (!isComment(node)) return false;
    const inner = node.text
        .replace(/^\/\//, '')
        .replace(/^\/\*+/, '')
        .replace(/\*+\/$/, '');
    return inner.trim() === 'prettier-ignore';
}

/** Newlines become `literalline`, so the source's own indent survives. */
function gapDoc(text: string): Doc {
    return replaceEndOfLine(text);
}

function blankIn(gap: string | null): boolean {
    if (gap === null) return false;
    return gap.length - gap.replaceAll('\n', '').length >= 2;
}

/** Comments are checked first, so a comment `Token` or `Branch` never prints without its `breakParent`. */
function nodeDoc(node: NormalChild, ctx: WalkOptions): Doc {
    if (node.nodeType === 'Text') return gapDoc(node.text);
    if (isComment(node)) return commentDoc(node);
    if (node.nodeType === 'Token') return verbatim(node);

    const list = listOf(node);
    if (list) return listDoc(node, list, ctx);
    // Area printers return `null` for a node they do not own, so anything unrecognised falls through to the source-gap fallback.
    const chain = binaryChainDoc(node as NormalBranch, (child) =>
        nodeDoc(child, ctx),
    );
    if (chain !== null) return chain;
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

/** The source layout, like `verbatim`, except that a nested list still gets real layout. */
function branchDoc(node: NormalBranch, ctx: WalkOptions): Doc {
    return node.children.map((child) => nodeDoc(child, ctx));
}

/**
 * A list, with a separator wherever the source had one and a bare break elsewhere.
 * A `;` after every non-last item would be wrong once comments are items: in `{ a = 1; // c\n b = 2 }` it would land inside the comment.
 */
function listDoc(
    node: NormalBranch,
    list: ListDescriptor,
    ctx: WalkOptions,
): Doc {
    const items = listItems(node);

    if (items.length === 0) {
        // `{\n\n}` keeps its blank line, and with no items to carry the gap it is read off the node.
        return hasBlankLine(node)
            ? [list.open, hardline, hardline, list.close]
            : [list.open, list.close];
    }

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
        // The right side is passed too: only `next.gap` says whether a comment sat on this item's line and must stay there.
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
 * The file's declaration list, always broken, so `hardline`s rather than a flattening pass.
 *
 * The trailing newline is emitted, not reproduced: Prettier's line writer trims `literalline`,
 * so copying the source's tail gap would print nothing.
 * A file with no items, even `\n\n`, prints `''`, as Prettier does for an empty document.
 */
function sourceFileDoc(node: NormalBranch, ctx: WalkOptions): Doc {
    const items = listItems(node);
    if (items.length === 0) return '';

    const out: Doc[] = [];
    const importEnd = importSectionEnd(items);
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        out.push(itemDoc(item, items, i, ctx));

        const isLast = i === items.length - 1;

        // Only the source's own `;`: the guard compares tokens, so an omitted inter-declaration `;` stays omitted.
        // A comment item can own the `;` (`let o = 1 // c` then `;`), which `trailingSeparator` moves onto the next line.
        out.push(
            trailingSeparator(
                'semi_sep',
                item.separated,
                isLineComment(item.node),
            ),
        );

        if (isLast) continue;
        out.push(declarationBreak(items[i + 1], i === importEnd));
    }

    out.push(hardline);
    return out;
}

/**
 * The break between two declarations: the source's blank line if any, else one newline, or a space before a same-line comment.
 *
 * Not `separatorLine`, whose soft `line` could flatten and run two declarations together.
 * The one blank line the printer invents is after the import section, even when the source had none (`import A "A"; actor {}`).
 */
function declarationBreak(next: ListItem, endsImportSection: boolean): Doc {
    const commentOnThisLine =
        isComment(next.node) && (next.gap === null || !next.gap.includes('\n'));
    if (commentOnThisLine) return ' ';
    if (endsImportSection) return [hardline, hardline];
    return blankIn(next.gap) ? [hardline, hardline] : hardline;
}

/**
 * The index of the last item in the leading run of imports and comments, or `-1` when the file has no imports.
 * Comments in the run belong to the section, so a commented-out import does not get the blank line before it.
 */
function importSectionEnd(items: ListItem[]): number {
    let sawImport = false;
    let end = -1;
    for (let i = 0; i < items.length; i += 1) {
        if (isImport(items[i].node)) {
            sawImport = true;
            end = i;
        } else if (isComment(items[i].node)) {
            if (sawImport) end = i;
        } else {
            break;
        }
    }
    return sawImport ? end : -1;
}

/** The Prettier printer; it registers no comment hooks, see the module header. */
export function createPrinter(): Printer<NormalChild> {
    return {
        // `[]` for non-branches, or Prettier would yield `Text` gaps as nodes and they would become cursor targets.
        getVisitorKeys: (node: NormalChild) =>
            node.nodeType === 'Branch' ? ['children'] : [],

        // At the root the guard checks a rendered copy, and the Doc is returned rather than the string so cursor placeholders survive.
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
                // Not from `parse`, so there is nothing to compare against.
                return built;
            }

            // Prettier awaits the root print call and the guard re-parses asynchronously; the declared `Printer` type is narrower.
            // Nested calls never return a Promise.
            return guard(result, built, options) as unknown as Doc;
        },
    };
}

/**
 * Renders a copy of the root's Doc, checks it, and returns the original.
 * The full options are passed because `printDocToString` reads `endOfLine`, which its declared options type omits.
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
