import { doc } from 'prettier';
import type { AstPath, Doc, ParserOptions, Printer } from 'prettier';

import type { ParseResult } from '../parser/parse.ts';
import type {
    NormalBranch,
    NormalChild,
    NormalNode,
} from '../parser/normalize.ts';
import { verifyOutput } from '../verify.ts';
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

const { align, breakParent, group, hardline } = doc.builders;
const { replaceEndOfLine } = doc.utils;

// A `WeakMap` rather than a field on the node, because a new field would change the shape the guard compares.
const ROOTS = new WeakMap<object, ParseResult>();

export function rememberRoot(result: ParseResult): void {
    ROOTS.set(result.root, result);
}

interface WalkOptions {
    /** Source lines, to find the indentation a copied line break sat at. */
    lines: string[];
}

function indentOf(line: string | undefined): number {
    return line === undefined ? 0 : line.length - line.trimStart().length;
}

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

function gapDoc(text: string): Doc {
    return replaceEndOfLine(text);
}

function blankIn(gap: string | null): boolean {
    if (gap === null) return false;
    return gap.length - gap.replaceAll('\n', '').length >= 2;
}

function nodeDoc(node: NormalChild, ctx: WalkOptions): Doc {
    if (node.nodeType === 'Text') return gapDoc(node.text);
    if (isComment(node)) return commentDoc(node);
    if (node.nodeType === 'Token') return verbatim(node);

    const list = listOf(node);
    if (list) return listDoc(node, list, ctx);
    const chain = binaryChainDoc(node as NormalBranch, (child) =>
        nodeDoc(child, ctx),
    );
    if (chain !== null) return chain;
    const control = controlDoc(node as NormalBranch, (child) =>
        nodeDoc(child, ctx),
    );
    if (control !== null) return control;
    return branchDoc(node, ctx);
}

/**
 * A node with no layout of its own: children with the source's gaps.
 * After a copied line break, the rest sits at its source column relative to the node's first line,
 * so a list nested inside indents from where the author put it.
 */
function branchDoc(node: NormalBranch, ctx: WalkOptions): Doc {
    const base = indentOf(ctx.lines[node.startPosition.row]);
    const out: Doc[] = [];
    let segment: Doc[] = out;
    for (const child of node.children) {
        if (child.nodeType === 'Text' && child.text.includes('\n')) {
            const newlines = child.text.split('\n').length - 1;
            const column = child.text.length - child.text.lastIndexOf('\n') - 1;
            const inner: Doc[] = [];
            const breaks = newlines >= 2 ? [hardline, hardline] : [hardline];
            out.push(align(Math.max(0, column - base), [...breaks, inner]));
            segment = inner;
            continue;
        }
        segment.push(nodeDoc(child, ctx));
    }
    return out;
}

function listDoc(
    node: NormalBranch,
    list: ListDescriptor,
    ctx: WalkOptions,
): Doc {
    const items = listItems(node);

    if (items.length === 0) {
        return hasBlankLine(node)
            ? [list.open, hardline, hardline, list.close]
            : [list.open, list.close];
    }

    const last = items[items.length - 1];
    // The author's layout decides, not the width: a list with a line break breaks one item per line, any other stays on one line.
    const flat = !node.children.some(
        (c) => c.nodeType === 'Text' && c.text.includes('\n'),
    );
    const closeIndex = node.children.findLastIndex(
        (c) => c.nodeType === 'Token' && c.text === list.close,
    );
    const beforeClose = node.children[closeIndex - 1];
    const blankAfterOpen = !flat && blankIn(items[0].gap);
    const blankBeforeClose =
        !flat && beforeClose?.nodeType === 'Text' && blankIn(beforeClose.text);
    return group(
        [
            list.open,
            listIndent(
                [
                    blankAfterOpen ? hardline : '',
                    listItemsDoc(items, list, ctx, flat),
                    blankBeforeClose ? hardline : '',
                ],
                list,
                last !== undefined && isLineComment(last.node),
                flat,
            ),
            list.close,
        ],
        { shouldBreak: !flat },
    );
}

function listItemsDoc(
    items: ListItem[],
    list: ListDescriptor,
    ctx: WalkOptions,
    flat: boolean,
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
        if (item.separated) {
            out.push(
                betweenSeparator(
                    list.family,
                    printed,
                    next.gap,
                    isLineComment(item.node),
                    isComment(next.node),
                    flat,
                ),
            );
        } else {
            // A block comment stays on the line of the item it annotates, as in `/* x = */ one`.
            const inlineComment =
                isComment(item.node) &&
                !isLineComment(item.node) &&
                !(next.gap ?? '').includes('\n');
            out.push(
                flat || inlineComment
                    ? ' '
                    : separatorLine(printed, next.gap, isComment(next.node)),
            );
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

function sourceFileDoc(node: NormalBranch, ctx: WalkOptions): Doc {
    const items = listItems(node);
    if (items.length === 0) return '';

    const out: Doc[] = [];
    const importEnd = importSectionEnd(items);
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        out.push(itemDoc(item, items, i, ctx));

        const isLast = i === items.length - 1;

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

    // Prettier's line writer trims `literalline`, so the source's own tail gap would print nothing.
    out.push(hardline);
    return out;
}

function declarationBreak(next: ListItem, endsImportSection: boolean): Doc {
    const commentOnThisLine =
        isComment(next.node) && (next.gap === null || !next.gap.includes('\n'));
    if (commentOnThisLine) return ' ';
    if (endsImportSection) return [hardline, hardline];
    return blankIn(next.gap) ? [hardline, hardline] : hardline;
}

function importSectionEnd(items: ListItem[]): number {
    let sawImport = false;
    let end = -1;
    for (let i = 0; i < items.length; i += 1) {
        if (isImport(items[i].node)) {
            sawImport = true;
            end = i;
        } else if (isComment(items[i].node)) {
            // A blank line ends the section, so a comment after it belongs to the code below.
            if (sawImport && blankIn(items[i].gap)) break;
            if (sawImport) end = i;
        } else {
            break;
        }
    }
    return sawImport ? end : -1;
}

// Without `canAttachComment`/`printComment` Prettier's attach pass is inert; the CST already interleaves comments.
export function createPrinter(): Printer<NormalChild> {
    return {
        // `[]` for non-branches, or Prettier would yield `Text` gaps as nodes and cursor targets.
        getVisitorKeys: (node: NormalChild) =>
            node.nodeType === 'Branch' ? ['children'] : [],

        print: (path: AstPath<NormalChild>, options: ParserOptions) => {
            const ctx: WalkOptions = {
                lines: options.originalText.split('\n'),
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
                return built;
            }

            // Prettier awaits the root print call, so the async guard can run here; nested calls never return a Promise.
            return guard(result, built, options) as unknown as Doc;
        },
    };
}

// The full options, because `printDocToString` reads `endOfLine`, which its declared options type omits.
async function guard(
    result: ParseResult,
    built: Doc,
    options: ParserOptions,
): Promise<Doc> {
    const rendered = doc.printer.printDocToString(built, options).formatted;
    await verifyOutput(result.root, rendered);
    return built;
}
