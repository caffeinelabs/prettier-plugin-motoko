/**
 * The list contract: which kinds own a list, what counts as an item, and how separators are printed.
 *
 * The CST facts the rest relies on:
 *  - A separator is a real child `Token`, never part of a `Text` gap, and an item's span excludes it.
 *  - `Text` gaps appear only where the source had whitespace, so a gap is evidence of source layout.
 *    `{}` has no gap and `{\n\n}` has one, so an empty list can still carry a blank line.
 *  - `field` cannot find items, since tokens have none and most kinds declare no fields.
 *    So a child is an item iff it is a `Branch`, or a `Token` that is not a delimiter or separator.
 *
 * A kind missing from the table is not a list and prints its children with no separator logic, which is the safe default.
 */

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

/** How a list separates its items, and whether it permits a `;` after the last one. */
export type ListFamily =
    /** `;` between items; a trailing `;` is reproduced from the source, never added or dropped. */
    | 'semi_sep'
    /** Prints as `semi_sep`; kept to mirror the grammar's `semi_sep1`. */
    | 'semi_sep1'
    /** `,` between items; a trailing `,` is reproduced from the source, never added. */
    | 'comma_sep';

/** A list a node owns: where its items are, and what separates them. */
export interface ListDescriptor {
    family: ListFamily;
    open: string;
    close: string;
    /** Whether the flat form puts a space inside the delimiters: `{ a = 1 }` but `(1, 2)`. */
    spaced: boolean;
    /**
     * Whether the close must be glued to the last item, never preceded by a break of any kind.
     *
     * moc lexes a `>` with whitespace on both sides as `GTOP`, so a `>` pushed onto its own line is a syntax error.
     * Tree-sitter reads the broken form as the same tree, so the guard cannot catch it.
     * Breaking after the opening `<` is accepted, so only the close is glued.
     */
    closeGlued?: boolean;
}

const LISTS: Partial<Record<NodeKind, ListDescriptor>> = {
    block_exp: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    obj_body: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    obj_typ: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    obj_pat: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    source_file: { family: 'semi_sep', open: '', close: '', spaced: false },
    // `listOf` makes this `semi_sep1` per node, for the `p with …` form.
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

/** List structure; every other anonymous token (`=`, `:`, `with`, …) is content. */
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

/** One list entry; `separated` records only that a separator followed, since its spelling is the family's. */
export interface ListItem {
    node: NormalNode;
    /** The whitespace before this item, which the blank-line rules read, or `null` when the source had none. */
    gap: string | null;
    separated: boolean;
}

/** Separators are recorded on the item they follow, since how they print depends on position, which only the caller knows. */
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

/**
 * The break after a separator, given the left item's doc, the gap before the next item, and whether that item is a comment.
 *
 * A comment the source wrote on the left item's line stays there, as a literal space rather than a `line`:
 * the comment's `breakParent` would break the last `line` before it and detach the comment anyway.
 * Otherwise a left item that will break (a `//` does) forces a `hardline`, so it cannot swallow the next item.
 * A source blank line is kept as exactly one, and anything else is a soft `line`.
 */
export function separatorLine(
    left: Doc,
    gap: string | null,
    nextIsComment = false,
): Doc {
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

/**
 * The source's trailing separator, reproduced exactly, or nothing.
 *
 * Adding or dropping one would change the tokens the guard compares, so layout never decides it and `semi`/`trailingComma` are not read.
 * After a line comment the separator leads the next line, since anything appended to a `//` is inside it.
 */
export function trailingSeparator(
    family: ListFamily,
    separated: boolean,
    lastIsLineComment = false,
): Doc {
    if (!separated) return '';
    const sep = separatorChar(family);
    return lastIsLineComment ? [hardline, sep] : sep;
}

/**
 * The separator between two items, then the break after it.
 *
 * `semi: false` must never drop it: without the `;`, `func f() { a; b }` re-glues into an application with no error.
 * After a line comment the separator leads the next line, since appended text would be inside the `//`, and moc accepts that.
 * `leftIsLineComment` is passed rather than tested with `willBreak`, which is also true for an item that merely contains a comment,
 * and moving the separator off such an item would detach it.
 */
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

/** `body` is `null` for an empty list. */
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

/**
 * Whether a child is a comment: a block or doc comment `Branch`, or a line comment `Token` (or `Branch`; the grammar has had both).
 * `comment_text` is excluded: it is the inside of a block comment, and listing it would make that look like a sibling comment.
 */
export function isComment(child: NormalChild): boolean {
    if (child.nodeType === 'Text') return false;
    if (
        COMMENT_KINDS.has(child.nodeType === 'Token' ? child.type : child.kind)
    ) {
        return true;
    }
    // A comment kind the generated types do not name yet (a grammar bump ahead of `gen:node-types`).
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

/** Relative to the caller's list, because `<` and `>` are delimiters only in `typ_params`/`inst` and operators elsewhere. */
export function isDelimiter(child: NormalChild, list: ListDescriptor): boolean {
    return (
        child.nodeType === 'Token' &&
        BRACKETS.has(child.text) &&
        (child.text === list.open || child.text === list.close)
    );
}

/** `replaceEndOfLine` makes newlines `literalline`, so a multi-line node is not re-indented as if its newlines were soft. */
export function verbatim(node: NormalNode): Doc {
    return doc.utils.replaceEndOfLine(node.text);
}

export function innerBreak(list: ListDescriptor): Doc {
    return list.spaced ? line : softline;
}

/**
 * The indent-and-break inside a list's delimiters, returned whole so the opening and closing breaks cannot be mismatched.
 *
 * With `closeGlued` the close gets no break, so the `>` stays on the last item's line.
 * A trailing line comment is the one exception: glued, the `>` would land inside the `//`, so the close goes on its own line.
 * The caller passes `lastIsLineComment`, because only it has the item list.
 */
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

/** Exported so a test can assert the printer's dispatch covers the table. */
export function listKinds(): NodeKind[] {
    return Object.keys(LISTS) as NodeKind[];
}

export function tokenText(token: NormalToken): Doc {
    return token.text;
}
