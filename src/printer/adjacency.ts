/**
 * Motoko's whitespace-sensitive token pairs: the seams where another spacing of the same tokens parses differently or not at all.
 *
 * Output must mean the same under moc 1.x and moc 2.0.
 * tree-sitter-motoko, the formatter's own parser, disagrees with moc in both directions, so no decision here is delegated to it.
 * Every other token pair is free-spaced and left to the area printers.
 * Every area printer imports this module, so it depends on nothing but prettier's doc builders to stay out of import cycles.
 */

import { doc } from 'prettier';
import type { Doc } from 'prettier';

const { hardline, line } = doc.builders;

/** How a token pair may be spaced. */
export type Verb =
    /** A space is mandatory and must not become a newline. */
    | 'force-spaced'
    | 'force-glued'
    /** The asymmetric pairs: a space on one side, none on the other. */
    | 'force-spaced-before'
    | 'force-spaced-after'
    /** Not a seam. */
    | 'free';

/**
 * Joins docs with nothing between them. Prettier keeps a `line` between siblings as a legal break, so a glued pair must be one concat.
 * This is the only zero-width join in the module, so glued seams are greppable.
 */
export function glue(...parts: Doc[]): Doc {
    return parts.length === 0 ? '' : parts.length === 1 ? parts[0] : parts;
}

/**
 * `5.` lexes as a Float, so `5.toText()` has no `.` token and `5. toText()` is a different program (`Float 5.` applied to `toText`).
 * tree-sitter can't see this, so a number the source glued to its dot stays glued.
 */
export const NUMBER_DOT_GLUED = true;

/**
 * Keywords whose head is a spelling decision, not a layout one.
 *
 * moc 1.1.0 rejects both the tight `if f(x) { }` and the spaced bare form, so a compound head is always parenthesised.
 * A bare name, a `<`-free atom, or an already-parenthesised head parses on every moc and stays bare, so `if c { }` doesn't churn.
 */
export type HeadKeyword = 'if' | 'while' | 'switch' | 'for';

export type HeadShape =
    /** A bare name or other `<`-free atom: `if c`, `if o.x`, `if 1`. */
    | 'atom'
    /** Already a `par_exp`, so wrapping again would nest `((c))`. */
    | 'par'
    /** A call, index, instantiation, operator chain, or any node not known to be safe bare. */
    | 'compound';

/** A whitelist of what may stay bare: the only spelling safe for an unknown compound node is the parenthesised one. */
export function headNeedsParens(shape: HeadShape): boolean {
    return shape === 'compound';
}

/**
 * Operators the lexer reads as one token, so whitespace inside one splits it into tokens the grammar can't reassemble.
 * Data rather than a chain of `if`s because the adjacency test iterates it. `->` is here for its inner seam; the space around it is free.
 */
export const INDIVISIBLE_OPERATORS: ReadonlySet<string> = new Set([
    ':=',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '#=',
    '**=',
    '+%=',
    '-%=',
    '|=',
    '&=',
    '^=',
    '<<=',
    '>>=',
    '<<>=',
    '<>>=',
    '|>',
    '**',
    '+%',
    '-%',
    '*%',
    '->',
    // The suffix is part of the token.
    'await*',
    'async*',
    'await?',
    // `a > > b` does not re-lex as a shift, so both `>` must come from one token.
    '<<',
    '>>',
    '<<>',
    '<>>',
]);

export function isIndivisible(tokenText: string): boolean {
    return INDIVISIBLE_OPERATORS.has(tokenText);
}

// `<` is instantiation glued and comparison spaced. Two functions rather than one flag, because only the caller knows the role.

/**
 * Glued, because tree-sitter's instantiating `<` is `token.immediate`, so `f <T>(x)` re-parses as a comparison (moc accepts either).
 * A broken angle list must still glue its close, which `ListDescriptor.closeGlued` in `parts.ts` enforces.
 */
export function instantiationAngles(inner: Doc): Doc {
    return glue(inner);
}

/** The `>>` closing nested type args, one glued unit: `> >` does not re-lex as two closing angles. */
export function nestedClose(parts: Doc[]): Doc {
    return glue(...parts);
}

/** Spaced on both sides: moc lexes `<`/`>` as comparison only with whitespace around them, so `x<y;` is a syntax error. */
export function comparisonOp(op: string): Doc {
    return [line, op, line];
}

/**
 * `??` keeps a literal trailing space and breaks before, never after: unspaced `??x` is `?(?x)`.
 *
 * tree-sitter's token is `/\?\?[ \t\r\n]/`, so `a ??b` is rejected,
 * and `a ??\nb` re-parses to a token spelled `"??\n"`, which the re-parse guard rejects.
 * The space before is free, but a glued `a??` reads as two `?` tokens on moc 1.x.
 */
export function coalesceOperator(op: string): Doc {
    return [line, op, ' '];
}

/** `? ?a`, spaced and unbreakable: moc 1.1.0 reads glued `??a` as `?(?a)` while 1.16.1 and 2.0 reject it. */
export function doubleOption(): Doc {
    return '? ?';
}

/**
 * `#` glues to its tag and is spaced from whatever precedes it.
 *
 * moc 2.0's `TIGHT_HASH` lexer rule makes `#less` a tag only when glued, and `if (c)#less` is a syntax error on 1.16.1 and 2.0.
 * tree-sitter can't see this seam, so moc is the authority.
 */
export function hashTag(tag: Doc): Doc {
    return ['#', tag];
}

/** A space before `#`, never a break: the seam is spacing-sensitive on moc and tree-sitter can't check it. */
export function spaceBeforeHash(): Doc {
    return ' ';
}

/**
 * The space between a control head and a bare branch, never a break.
 *
 * Glued `(`/`[` after a control head continues the head as a call or index on moc 1.1.0, while spaced starts the branch.
 * A `-` branch is spaced before and glued after: only `if (c) -1` parses on every moc, since `- 1` is a subtraction on 1.1.0.
 */
export function bareBranchSpace(): Doc {
    return ' ';
}

/**
 * A unary `-`/`+`/`^` glued to its operand. The seam before the operator is `bareBranchSpace`'s.
 *
 * Never brace a unary-minus branch: `if (c) -h { 1 } else { 5 }` reads `-` as subtraction and `{ 1 }` as a record on every moc.
 * The bare branch `if (c) -h else 5` is the universally accepted form.
 */
export function unaryOperand(op: Doc, operand: Doc): Doc {
    return glue(op, operand);
}

/** Juxtaposition `f x` needs its space, never a break. In `f { a = 1 }` the space keeps the `{` a record argument, not a block. */
export function juxtapositionSpace(): Doc {
    return ' ';
}

/** Binary chains break after the operator. `|>` and `??` break before it instead, see `coalesceOperator`. */
export function breakAfterOperator(op: Doc): Doc {
    return [op, line];
}

/**
 * Whether a comment would sit inside a glued seam, which is a hard conflict.
 *
 * A comment between a callee and its `(`, or before an index bracket, stops them being a call or index. One after `??` breaks the token.
 * The formatter may not silently move the author's comment, so this returns a boolean and each caller picks its own hoist or fails.
 */
export function commentSplitsSeam(
    commentText: string,
    glued: boolean,
): boolean {
    return glued && commentText.trim() !== '';
}

/** The adjacency checklist as data. The adjacency test asserts one case per item, so an item can't be dropped silently. */
export interface ChecklistItem {
    readonly n: number;
    /** Row ids, e.g. `H1`, `B3`, `L5`. */
    readonly rows: readonly string[];
    readonly rule: string;
}

export const CHECKLIST: readonly ChecklistItem[] = [
    {
        n: 1,
        rows: ['H1', 'H2', 'H3', 'H4'],
        rule: 'paren-wrap a compound head',
    },
    {
        n: 2,
        rows: ['B1', 'B2', 'B3', 'B5'],
        rule: 'space before a bare branch opener',
    },
    {
        n: 3,
        rows: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'],
        rule: 'glue angles, space comparisons',
    },
    {
        n: 4,
        rows: ['C1', 'C2', 'C3', 'C4', 'C6', 'C7'],
        rule: 'space after ??; space between ? ?',
    },
    {
        n: 5,
        rows: ['D1', 'D2'],
        rule: 'glue the number-dot, never space after it',
    },
    {
        n: 6,
        rows: ['P1', 'P2', 'P3', 'P4'],
        rule: 'glue #tag, space before a branch #',
    },
    { n: 7, rows: ['§2.7'], rule: 'never split an indivisible operator' },
    { n: 8, rows: ['§4'], rule: 'a comment in a glued seam is a conflict' },
    {
        n: 9,
        rows: ['S1', 'S4', 'S5'],
        rule: 'do not delegate these to tree-sitter',
    },
];

/** At most one blank line, and the printer never invents one. Spelled once so the rule is greppable. */
export function blankLine(): Doc {
    return [hardline, hardline];
}
