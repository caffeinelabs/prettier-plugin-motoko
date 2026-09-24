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

// A `WeakMap` rather than a field on the node, because a new field would change the shape the guard compares.
const ROOTS = new WeakMap<object, ParseResult>();

export function rememberRoot(result: ParseResult): void {
    ROOTS.set(result.root, result);
}

interface WalkOptions {
    printWidth: number;
    tabWidth: number;
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

function branchDoc(node: NormalBranch, ctx: WalkOptions): Doc {
    return node.children.map((child) => nodeDoc(child, ctx));
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
