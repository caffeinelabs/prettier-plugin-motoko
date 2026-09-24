/**
 * The list contract: where the separators are, what counts as an item, and which `;` may be dropped.
 *
 * Every area printer needs the same four things, and all four are answered here so that the
 * semicolon rule — the highest-risk rule in the rework (`docs/semicolons.md`) — exists in exactly
 * one place.
 *
 * ## What the CST actually looks like (probed, `.probe/_semi-gaps.mts`)
 *
 * This is the part that is not guessable from the node names, so it is stated once, with the probe
 * that established it:
 *
 *   - **A separator is a real child `Token`, never part of a gap.** `{ a = 1; b = 2 }` has the
 *     shape `{`,`Text(" ")`,`exp_field`,`;`,`Text(" ")`,`exp_field`,`Text(" ")`,`}` — the `;` is a
 *     sibling of the fields. The normaliser's `Text` gaps are asserted whitespace-only
 *     (`normalize.ts:307`), so this had to be true or M2 could not proceed at all.
 *   - **An item's span excludes its separator.** The `exp_field` for `a = 1` ends before the `;`.
 *   - **`Text` gaps appear only where source whitespace existed.** `(1,2)` has no gap between `,`
 *     and `2`; `(1, 2)` has `Text(" ")` there. So a gap is *evidence of source layout*, which is
 *     what the blank-line rules read.
 *   - **A delimiter pair with nothing between has no gap at all.** `{}` is `{`,`}`; `{\n\n}` is
 *     `{`,`Text("\n\n")`,`}`. An "empty" list can therefore still carry a gap, and that gap is a
 *     blank line the fixture expects to survive (`docs/style.md` §"Interaction with the ported
 *     fixture expectations").
 *   - **`field` cannot be used to find items.** `NormalToken` has no `field` property at all
 *     (`undefined`), and only 16 of the grammar's 125 kinds declare any fields
 *     (`NODE_KINDS`), so the list children of `block_exp`, `par_exp`, `obj_typ`, … have
 *     `field === null` even when they are genuine items. Item/delimiter classification is therefore
 *     **structural**: a child is an item iff it is a `Branch`, or a `Token` that is not one of the
 *     delimiter/separator spellings below.
 *
 * ## Why the classification is a table and not a predicate
 *
 * The three list families in `docs/style.md` differ only in their separator and their trailing
 * behaviour, so one descriptor per kind keeps the decision table and the code adjacent. The table is
 * keyed by `kind` and is consulted only for nodes that own a list; anything unknown is not a list,
 * which is the safe default (an unknown node prints its children with no separator logic).
 *
 * A grammar bump that adds a list kind will not silently acquire the wrong rule: `listOf` returns
 * `null` and the caller falls back to item-per-child printing, and `tests/printer/parts.test.ts`
 * asserts the table's coverage against `NODE_KINDS`.
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
    /** As `semi_sep` in every printed respect; kept because the table names it. */
    | 'semi_sep1'
    /** `,` between items; a trailing `,` is reproduced from the source, never added. */
    | 'comma_sep';

/** A list a node owns: where its items are, and what separates them. */
export interface ListDescriptor {
    family: ListFamily;
    /** The opening delimiter token text, for `leftDelim`. */
    open: string;
    /** The closing delimiter token text, for `rightDelim`. */
    close: string;
    /**
     * Whether the flat form puts a space inside the delimiters.
     *
     * Not derivable from `open`: `{ … }` and `( … )` differ only by how `docs/style.md` wants them
     * spelled flat, and that difference is exactly the kind of thing that must be stated rather
     * than guessed. A brace list is `{ a = 1; b = 2 }`; a paren list is `(1, 2)`.
     */
    spaced: boolean;
    /**
     * Whether the closing delimiter must be glued to the last item's last token — never preceded by
     * a break of any kind, not even a `softline` that flattens to nothing.
     *
     * Set for the two angle families, and it is a **correctness** rule rather than a layout taste.
     * moc's lexer emits `GTOP` for a `>` that has whitespace on both sides (`| Parser.GT when
     * leading_ws () && trailing_ws () -> Parser.GTOP`), so a `>` that has been pushed onto its own
     * line stops being a closing angle bracket:
     *
     *     type F<
     *       A
     *     > = A;          syntax error [M0001], unexpected token '>'
     *
     * This is a syntax error on **every** moc from 0.16.3 through 2.0.0-beta.1, and — this is the
     * part that makes it worth a descriptor field — the runtime guard **cannot see it**, because
     * tree-sitter reads the broken form as the same tree. So there is no gate behind the printer
     * here; this flag is the only thing standing between an author and an unparseable file.
     * `.probe/_angles2.mts` and `.probe/_angles4.mts` are the measurements.
     *
     * The seam is one-sided, which is why it is a flag on the descriptor and not a `glue()` around
     * the whole list: breaking *after* the opening `<` is accepted on all three compilers
     * (`type F<\n  A,\n  B> = A;`), so only the close is glued. The opening `<` needs no rule of
     * its own precisely because it is always safe.
     */
    closeGlued?: boolean;
}

/**
 * Which kinds own a list, and of which family.
 *
 * The family assignments are `docs/style.md`'s decision table, row for row. `semi_sep1` and
 * `semi_sep` print identically — the distinction is documented at the table and only shows up in a
 * grammar-level difference for a single-item list — so the family is kept for fidelity to the table
 * rather than because the printer branches on it.
 */
const LISTS: Partial<Record<NodeKind, ListDescriptor>> = {
    // --- semi_sep: `;` between items, and a trailing `;` reproduced from the source ---
    block_exp: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    obj_body: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    obj_typ: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    obj_pat: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    source_file: { family: 'semi_sep', open: '', close: '', spaced: false },
    // `object_exp` is listed once: it is our form when the source had `p with …`, which is
    // `semi_sep1`. The plain form is `semi_sep`. `listOf` picks between them per node, because the
    // distinction is a property of the instance (does it carry a `with` token), not of the kind.
    object_exp: { family: 'semi_sep', open: '{', close: '}', spaced: true },
    variant_typ: { family: 'semi_sep1', open: '{', close: '}', spaced: true },

    // --- comma_sep: `,` between items, and a trailing `,` reproduced from the source ---
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

/**
 * The list a node owns, or `null` if it owns none.
 *
 * `object_exp` is resolved by instance because the same kind covers both of the decision table's
 * record-literal rows: the presence of a `with` child is what distinguishes them. Both print the
 * same trailing `;`, so only the prelude differs and callers read that from the children.
 */
export function listOf(node: NormalBranch): ListDescriptor | null {
    const base = LISTS[node.kind];
    if (!base) return null;
    if (node.kind === 'object_exp' && hasToken(node, 'with')) {
        return { ...base, family: 'semi_sep1' };
    }
    return base;
}

/** Whether `node` has a direct token child whose text is exactly `text`. */
export function hasToken(node: NormalBranch, text: string): boolean {
    return node.children.some((c) => c.nodeType === 'Token' && c.text === text);
}

/**
 * The separator spellings, and the delimiters, that are structure rather than content.
 *
 * `;`, `,` and the bracket family are the only tokens that appear as list structure. Every other
 * anonymous token — `=`, `:`, `with`, `case`, `func` — is content and must be printed with the
 * spacing the adjacency rules give it, so treating them as items would lose them.
 */
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

/** Whether a child is a list item rather than a separator or a delimiter. */
export function isItem(child: NormalChild): boolean {
    if (child.nodeType === 'Text') return false;
    if (child.nodeType === 'Branch') return true;
    return !SEPARATORS.has(child.text) && !DELIMITERS.has(child.text);
}

/** Whether a child is a `;` separator token. */
export function isSemi(child: NormalChild): boolean {
    return child.nodeType === 'Token' && child.text === ';';
}

/** Whether a child is a `,` separator token. */
export function isComma(child: NormalChild): boolean {
    return child.nodeType === 'Token' && child.text === ',';
}

/**
 * One entry of a list: the item, whether a separator followed it, and the `Text` gap before it.
 *
 * `separated` says only that the source put a separator *here*; which character that is, is the
 * family's business and is decided at print time by `betweenSeparator`. Both `;` and `,` set it.
 * That distinction is load-bearing rather than pedantic: a list's separator is not always the one
 * its family would choose, because a `,` inside `(1,2)` is a *token* the printer must reproduce from
 * the source, and a printer that inferred it from the family alone would silently drop it from any
 * list whose items happened to be adjacent in the tree.
 *
 * `gap` is the whitespace *before* the item, which is what the blank-line rules read.
 */
export interface ListItem {
    node: NormalNode;
    /** The gap text immediately before this item, or `null` when the source had none. */
    gap: string | null;
    /** Whether the source put a separator (`,` or `;`) after this item. */
    separated: boolean;
}

/**
 * Decompose a list node into its items.
 *
 * Delimiters and gaps are dropped: the caller prints them from the descriptor. The separator is
 * *recorded* on the item it follows rather than emitted here, because the printing decision (always
 * between items; `ifBreak` after the last) depends on position, which only the caller knows.
 *
 * A trailing `;` therefore attaches to the last item. It is *not* a layout decision in `preserve`:
 * the guard compares token texts (`docs/formatter-rework.md:147`) and a trailing separator is a real
 * child of the list in `shapeOf` (`.probe/_semi-shape.mts`), so the source's own trailing separator
 * is reproduced and never added or dropped. See `trailingSeparator`.
 */
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
        // A delimiter is structure the descriptor already accounts for.
        gap = null;
    }

    return out;
}

/**
 * Whether the source had a blank line somewhere in this node's direct children.
 *
 * Used for the "a blank line forces the group to break" rule: a blank line between items is a hard
 * break of the construct's own, so the construct may not be flattened even when it would fit.
 */
export function hasBlankLine(node: NormalBranch): boolean {
    return node.children.some(
        (c) =>
            c.nodeType === 'Text' &&
            c.text.length - c.text.replaceAll('\n', '').length >= 2,
    );
}

/**
 * The separator between two items, given the item on the left.
 *
 * Three rules, in order, and the order matters:
 *
 *  1. **A comment forces a break.** If the left item's doc cannot be flattened — which is how a
 *     line comment presents itself, since a `//` swallows the rest of the line — a `line` here would
 *     be flattened into a space and the comment would eat the next item. `docs/style.md`
 *     §"Comments" states this as required behaviour.
 *  2. **A source blank line is kept**, as exactly one blank line and never more.
 *  3. **Otherwise a soft `line`**, which the enclosing group flattens to a space or breaks to a
 *     newline.
 *
 * `willBreak` is called with the *left* item's doc because the question is whether the left item
 * already contains a hard break; a hard break to its right does not affect this seam.
 */
export function separatorLine(left: Doc, gap: string | null): Doc {
    if (left !== '' && willBreak(left)) return hardline;
    if (gap !== null && gap.length - gap.replaceAll('\n', '').length >= 2) {
        return [hardline, hardline];
    }
    return line;
}

/**
 * The trailing separator after the last item: the source's, reproduced exactly, or nothing.
 *
 * ## Why this reproduces rather than decides
 *
 * `docs/style.md`'s decision table wants this cell to follow *layout* — no trailing `;` on one line,
 * `ifBreak(";")` when broken — and its worked examples go further, asserting `format('{\n}')` is
 * `'{};\n'`. That rule is not implementable in `preserve`, and the reason is the guard, not taste:
 *
 *  - `docs/formatter-rework.md:147` requires the guard to compare **token texts**, and
 *    `.probe/_semi-shape.mts` shows a trailing separator is a real child of the list in `shapeOf`
 *    for *every* family — `{ a = 1; }` is 4 children against `{ a = 1 }`'s 3, `(1,)` against `(1)`,
 *    `let a = 1;` against `let a = 1`. So the guard's tree differs whenever the printer adds or
 *    drops one, and `TOLERATED_KINDS` cannot express the difference: it forgives *kinds*, and a `;`
 *    is a token inside an otherwise identical kind.
 *  - An `ifBreak` is therefore doubly wrong here. Flat, it emits nothing and drops a separator the
 *    source had; broken, it emits one the source may not have had. Both throw.
 *
 * `preserve`'s invariant is "changes layout only" (`docs/formatter-rework.md:7`), and a separator
 * token is source text rather than layout. So the printer reproduces it, and the layout-dependent
 * column of the decision table belongs to `moc2` (M3), where the trailing `;` is an intended rewrite
 * and the guard is told about it through the tolerance list.
 *
 * This is why `semi` and `trailingComma` are inert in M2: both are *instructions to add or remove a
 * separator*, and the guard admits neither. They are Prettier's own core options rather than ones
 * this plugin declares (`index.ts` registers neither), so a config naming them resolves without
 * error and the walk simply never reads them. They are honoured in M3 — on the same footing as
 * `motokoSyntax: moc2`, which is declared here, accepted, and also inert today.
 *
 * The one thing this must never do is *infer* the character. `separated` records that a separator
 * stood here, and the family says which spelling it was — `;` for the brace lists, `,` for the
 * bracket ones. Reading `node.text` instead would be equivalent for these two and would quietly
 * print the wrong character if a future grammar let a list admit both.
 */
export function trailingSeparator(family: ListFamily, separated: boolean): Doc {
    if (!separated) return '';
    return family === 'comma_sep' ? ',' : ';';
}

/**
 * The separator printed *between* two items. Always present for `semi_sep`/`semi_sep1`, and this is
 * the one that `semi: false` must never touch (`docs/semicolons.md` §4's negative control:
 * `func f() { a; b }` → `a b` re-glues into an application with no error).
 */
export function betweenSeparator(
    family: ListFamily,
    left: Doc,
    gap: string | null,
): Doc {
    const sep = family === 'comma_sep' ? ',' : ';';
    return [sep, separatorLine(left, gap)];
}

/**
 * Print a list's delimiter pair around an already-printed body.
 *
 * `body` is `null` for an empty list, which is the case worth naming: `{}` and `{\n\n}` are *both*
 * empty lists, and the second one carries a blank line that the ported fixtures require to survive.
 * So the empty case falls back to the node's own gap rather than printing a bare pair.
 */
export function delim(open: string, close: string, body: Doc | null): Doc {
    if (body === null) return [open, close];
    return [open, body, close];
}

/**
 * Whether a child is the file node itself.
 *
 * `source_file` owns a `semi_sep` list, so it is in `LISTS` like any other — but its `open`/`close`
 * are both `''` and its items are top-level declarations, not statements. A caller that wants "the
 * declaration list of a file" asks here rather than matching the kind inline.
 */
export function isSourceFile(node: NormalBranch | null | undefined): boolean {
    return node !== null && node !== undefined && node.kind === 'source_file';
}

/** Comment-bearing kinds, as `NODE_KINDS` names them. See `isComment`. */
const COMMENT_KINDS: ReadonlySet<string> = new Set([
    'line_comment',
    'block_comment',
    'doc_comment',
]);

/**
 * Whether a child is a comment.
 *
 * Three spellings, and missing any one of them means the printer prints a comment twice or not at
 * all:
 *
 *  - `block_comment` and `doc_comment` are **Branches** wrapping one `comment_text` token.
 *  - a line comment is a **named Token** (or a Branch — the grammar has had both shapes).
 *
 * `comment_text` is deliberately absent: it is the *inside* of a block comment, a leaf that the
 * normaliser treats as source text (`SOURCE_TEXT_KINDS`), and listing it here would make a nested
 * block comment look like a sibling comment.
 */
export function isComment(child: NormalChild): boolean {
    if (child.nodeType === 'Text') return false;
    if (
        COMMENT_KINDS.has(child.nodeType === 'Token' ? child.type : child.kind)
    ) {
        return true;
    }
    // A `doc_comment`- or `line_comment`-shaped node whose kind the generated types do not name yet
    // (a grammar bump ahead of `gen:node-types`): fall back to the raw type string.
    return COMMENT_KINDS.has(child.type);
}

/** The bracket spellings that are ever list structure. Angles are included; see `isDelimiter`. */
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

/**
 * Whether a child is the opening or closing delimiter of the list **it belongs to**.
 *
 * The list is a parameter rather than inferred, and angles are the reason: `<` and `>` are
 * delimiters inside `typ_params`/`inst` and comparison operators everywhere else, so "is this token
 * a delimiter" is only answerable relative to the descriptor the caller already looked up. Taking
 * the list makes that dependency explicit instead of leaving the caller to remember it.
 */
export function isDelimiter(child: NormalChild, list: ListDescriptor): boolean {
    return (
        child.nodeType === 'Token' &&
        BRACKETS.has(child.text) &&
        (child.text === list.open || child.text === list.close)
    );
}

/**
 * A node printed exactly as the source spelled it.
 *
 * This is the printer's safety valve and the skeleton's fallback: until an area printer handles a
 * kind, the node is reproduced byte for byte. Two details make it correct rather than merely easy:
 *
 *  - `replaceEndOfLine` turns the source's newlines into `literalline`, which is how Prettier is
 *    told "these are not break opportunities" — without it, a multi-line fallback would be
 *    re-indented as if its newlines were soft, changing the layout of the *inside* of the node while
 *    claiming to preserve it.
 *  - the text is taken from `node.text`, which the normaliser reconstructed from the children, so a
 *    fallback cannot drift from the tree it claims to represent.
 *
 * `docs/m1-architecture.md`'s module layout expects every fallback to be replaced by a real printer
 * during M2; the runtime guard (`src/verify.ts`) is what makes that replacement safe one kind at a
 * time, because a wrong replacement is caught by the re-parse rather than by review.
 */
export function verbatim(node: NormalNode): Doc {
    return doc.utils.replaceEndOfLine(node.text);
}

/**
 * The break that sits inside a list's delimiters, flat vs broken.
 *
 * The whole reason brace and paren lists look different flat lives in this one choice: `line`
 * flattens to a space, so `{ a = 1 }`; `softline` flattens to nothing, so `(1, 2)`. Both break to a
 * newline, which is what makes `[1, 2, 3]` and `[\n  1,\n  2,\n  3\n]` two spellings of the same
 * list.
 */
export function innerBreak(list: ListDescriptor): Doc {
    return list.spaced ? line : softline;
}

/**
 * Wrap an already-joined item list in the indent-and-break that surrounds it inside the delimiters.
 *
 * Returned as a single doc so that a caller cannot pair the opening break with a different closing
 * one — a list whose left edge breaks while its right edge does not is a layout no fixture wants and
 * no reader would think to look for.
 *
 * The one exception is `closeGlued`, and it is not an exception to the pairing rule but to the
 * break: the closing side gets **no break at all**, so the `>` stays attached to the last item. The
 * opening break is untouched, because it is always safe. See the descriptor field for why this is a
 * correctness requirement and not a style preference, and `.probe/_angles2.mts` for the output that
 * this function used to produce (which no moc accepts).
 *
 * ## A trailing line comment is the one thing glue cannot do
 *
 * `closeGlued` is right for every last item that is *code*, and wrong for exactly one: a line
 * comment. `listItemsDoc` already forces a `breakParent` for a comment (walk.ts's `commentDoc`), so
 * a list whose last item is a `//` is always printed broken — and glue then attaches the close to
 * the comment's own text, producing `// c>`. The `>` is inside the comment, the close is gone, and
 * the next re-parse fails.
 *
 * The guard catches this, so it is not a correctness hole; it is a **crash**, and on valid Motoko.
 * `let x = L.make<\n  Nat,\n  Int // c\n>()` is accepted by moc 1.16.0 and rejected by the printer,
 * which means the printer cannot format a file moc compiles. `.probe/_instcrash.mts` is the
 * measurement.
 *
 * There is no spacing that fixes it, which is why the fix is a break rather than a different join.
 * Gluing puts the `>` in the comment; a space leaves the `>` after the comment's text and *still*
 * inside the comment, because a line comment runs to the newline; and moc reads a `>` with
 * whitespace on both sides as `GTOP` rather than a close — the same lexer rule that makes
 * `closeGlued` necessary in the first place. So the close goes on its own line, which is the only
 * spelling that ends the comment before the `>`. That makes a trailing line comment the single
 * exception to "the close is never broken", and it is a narrow one: a trailing *block* comment still
 * glues, because a block comment ends at its own delimiter, not at the newline.
 * `.probe/_trailcomment2.mts` measures both.
 *
 * `lastIsLineComment` is passed by the caller rather than derived here, because the caller is the
 * only place that has the item list — `listIndent` sees the joined Doc, and re-deriving "what came
 * last" from a Doc would be a different and worse question.
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

/** Whether a node is a line comment — the one comment kind that cannot have anything after it on its line. */
export function isLineComment(node: NormalChild): boolean {
    if (node.nodeType === 'Text') return false;
    if (node.nodeType === 'Token') return node.type === 'line_comment';
    return node.kind === 'line_comment';
}

/**
 * The kinds whose list is printed by the generic list printer without a kind-specific override.
 *
 * Exported so a test can assert the printer's dispatch covers the table: a kind in `LISTS` that no
 * area printer claims would otherwise print through the verbatim fallback and look correct on a
 * single-line fixture while being silently wrong on a broken one.
 */
export function listKinds(): NodeKind[] {
    return Object.keys(LISTS) as NodeKind[];
}

/** A token's own text, for the many places a delimiter or keyword is printed as-is. */
export function tokenText(token: NormalToken): Doc {
    return token.text;
}
