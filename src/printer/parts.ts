import { doc } from 'prettier';
import type { Doc } from 'prettier';

import type {
    NormalBranch,
    NormalChild,
    NormalNode,
    NormalToken,
} from '../parser/normalize.ts';
import type { NodeKind } from '../parser/nodes.generated.ts';
import { glue } from './adjacency.ts';

const { hardline, line, softline, indent, join } = doc.builders;
const { willBreak } = doc.utils;

export type ListFamily = 'semi_sep' | 'semi_sep1' | 'comma_sep';

export interface ListDescriptor {
    family: ListFamily;
    open: string;
    close: string;
    spaced: boolean;
    // moc lexes a spaced `>` as `GTOP`, so a `>` on its own line is a syntax error the guard cannot see.
    closeGlued?: boolean;
}

const LISTS: Partial<Record<NodeKind, ListDescriptor>> = {
    block_exp: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    obj_body: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    obj_typ: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    obj_pat: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    source_file: { family: 'semi_sep', open: '', close: '', spaced: false },
    object_exp: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    variant_typ: { family: 'semi_sep1', open: '{', close: '}', spaced: true },

    par_exp: { family: 'comma_sep', open: '(', close: ')', spaced: false },
    array_exp: { family: 'comma_sep', open: '[', close: ']', spaced: false },
    tup_typ: { family: 'comma_sep', open: '(', close: ')', spaced: false },
    tup_pat: { family: 'comma_sep', open: '(', close: ')', spaced: false },
    typ_params: {
        family: 'comma_sep',
        open: '<',
        close: '>',
        spaced: false,
        closeGlued: true,
    },
    inst: {
        family: 'comma_sep',
        open: '<',
        close: '>',
        spaced: false,
        closeGlued: true,
    },
};

export function listOf(node: NormalBranch): ListDescriptor | null {
    const base = LISTS[node.kind];
    if (!base) return null;
    if (node.kind === 'object_exp' && hasToken(node, 'with')) {
        return { ...base, family: 'semi_sep1' };
    }
    return base;
}

export function hasToken(node: NormalBranch, text: string): boolean {
    return node.children.some((c) => c.nodeType === 'Token' && c.text === text);
}

const SEPARATORS: ReadonlySet<string> = new Set([';', ',']);
const DELIMITERS: ReadonlySet<string> = new Set([
    '{',
    '}',
    '(',
    ')',
    '[',
    ']',
    '<',
    '>',
]);

export function isItem(child: NormalChild): boolean {
    if (child.nodeType === 'Text') return false;
    if (child.nodeType === 'Branch') return true;
    return !SEPARATORS.has(child.text) && !DELIMITERS.has(child.text);
}

export function isSemi(child: NormalChild): boolean {
    return child.nodeType === 'Token' && child.text === ';';
}

export function isComma(child: NormalChild): boolean {
    return child.nodeType === 'Token' && child.text === ',';
}

export interface ListItem {
    node: NormalNode;
    gap: string | null;
    separated: boolean;
}

export function listItems(node: NormalBranch): ListItem[] {
    const out: ListItem[] = [];
    let gap: string | null = null;

    for (const child of node.children) {
        if (child.nodeType === 'Text') {
            gap = child.text;
            continue;
        }
        if (isItem(child)) {
            out.push({ node: child, gap, separated: false });
            gap = null;
            continue;
        }
        if ((isSemi(child) || isComma(child)) && out.length > 0) {
            out[out.length - 1].separated = true;
        }
        gap = null;
    }

    return out;
}

export function hasBlankLine(node: NormalBranch): boolean {
    return node.children.some(
        (c) =>
            c.nodeType === 'Text' &&
            c.text.length - c.text.replaceAll('\n', '').length >= 2,
    );
}

export function separatorLine(
    left: Doc,
    gap: string | null,
    nextIsComment = false,
): Doc {
    // A `line` here would break under the comment's `breakParent` and detach it from its item.
    if (nextIsComment && (gap === null || !gap.includes('\n'))) return ' ';
    if (left !== '' && willBreak(left)) return hardline;
    if (gap !== null && gap.length - gap.replaceAll('\n', '').length >= 2) {
        return [hardline, hardline];
    }
    return line;
}

function separatorChar(family: ListFamily): Doc {
    return family === 'comma_sep' ? ',' : ';';
}

export function trailingSeparator(
    family: ListFamily,
    separated: boolean,
    lastIsLineComment = false,
): Doc {
    if (!separated) return '';
    const sep = separatorChar(family);
    return lastIsLineComment ? [hardline, sep] : sep;
}

// Passed in rather than tested with `willBreak`, which is also true for an item that merely contains a comment.
export function betweenSeparator(
    family: ListFamily,
    left: Doc,
    gap: string | null,
    leftIsLineComment = false,
    rightIsComment = false,
): Doc {
    const sep = separatorChar(family);
    if (leftIsLineComment)
        return [hardline, sep, separatorLine(left, gap, rightIsComment)];
    return [sep, separatorLine(left, gap, rightIsComment)];
}

export function delim(open: string, close: string, body: Doc | null): Doc {
    if (body === null) return [open, close];
    return [open, body, close];
}

export function isSourceFile(node: NormalBranch | null | undefined): boolean {
    return node !== null && node !== undefined && node.kind === 'source_file';
}

const COMMENT_KINDS: ReadonlySet<string> = new Set([
    'line_comment',
    'block_comment',
    'doc_comment',
]);

export function isComment(child: NormalChild): boolean {
    if (child.nodeType === 'Text') return false;
    if (
        COMMENT_KINDS.has(child.nodeType === 'Token' ? child.type : child.kind)
    ) {
        return true;
    }
    // A comment kind the generated types do not name yet, after a grammar bump ahead of `gen:node-types`.
    return COMMENT_KINDS.has(child.type);
}

export function isImport(child: NormalChild): boolean {
    return child.nodeType === 'Branch' && child.kind === 'import';
}

const BRACKETS: ReadonlySet<string> = new Set([
    '{',
    '}',
    '(',
    ')',
    '[',
    ']',
    '<',
    '>',
]);

export function isDelimiter(child: NormalChild, list: ListDescriptor): boolean {
    return (
        child.nodeType === 'Token' &&
        BRACKETS.has(child.text) &&
        (child.text === list.open || child.text === list.close)
    );
}

export function verbatim(node: NormalNode): Doc {
    return doc.utils.replaceEndOfLine(node.text);
}

export function innerBreak(list: ListDescriptor): Doc {
    return list.spaced ? line : softline;
}

export function listIndent(
    joined: Doc,
    list: ListDescriptor,
    lastIsLineComment = false,
): Doc {
    const b = innerBreak(list);
    if (list.closeGlued && lastIsLineComment)
        return [indent([b, joined]), hardline];
    if (list.closeGlued) return [indent([b, joined]), glue()];
    return [indent([b, joined]), b];
}

export function isLineComment(node: NormalChild): boolean {
    if (node.nodeType === 'Text') return false;
    if (node.nodeType === 'Token') return node.type === 'line_comment';
    return node.kind === 'line_comment';
}

export function listKinds(): NodeKind[] {
    return Object.keys(LISTS) as NodeKind[];
}

export function tokenText(token: NormalToken): Doc {
    return token.text;
}
