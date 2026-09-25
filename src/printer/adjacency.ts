import { doc } from 'prettier';
import type { Doc } from 'prettier';

const { hardline, line } = doc.builders;

export type Verb =
    | 'force-spaced'
    | 'force-glued'
    | 'force-spaced-before'
    | 'force-spaced-after'
    | 'free';

export function glue(...parts: Doc[]): Doc {
    return parts.length === 0 ? '' : parts.length === 1 ? parts[0] : parts;
}

// `5.` lexes as a Float, so `5. toText()` is a different program from `5.toText()`.
export const NUMBER_DOT_GLUED = true;

// moc 1.1.0 rejects both the glued and the spaced bare compound head, so only the parenthesised one is safe.
export type HeadKeyword = 'if' | 'while' | 'switch' | 'for';

export type HeadShape = 'atom' | 'par' | 'compound';

export function headNeedsParens(shape: HeadShape): boolean {
    return shape === 'compound';
}

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
    'await*',
    'async*',
    'await?',
    '<<',
    '>>',
    '<<>',
    '<>>',
]);

export function isIndivisible(tokenText: string): boolean {
    return INDIVISIBLE_OPERATORS.has(tokenText);
}

// tree-sitter's instantiating `<` is `token.immediate`, so `f <T>(x)` re-parses as a comparison.
export function instantiationAngles(inner: Doc): Doc {
    return glue(inner);
}

export function nestedClose(parts: Doc[]): Doc {
    return glue(...parts);
}

// moc lexes `<`/`>` as comparison only when spaced on both sides, so `x<y;` is a syntax error.
export function comparisonOp(op: string): Doc {
    return [line, op, line];
}

// moc 1.1.0 reads glued `??a` as `?(?a)`, while 1.16.1 and 2.0 reject it.
export function doubleOption(): Doc {
    return '? ?';
}

// moc 2.0's `TIGHT_HASH` rule makes `#less` a tag only when glued.
export function hashTag(tag: Doc): Doc {
    return ['#', tag];
}

export function spaceBeforeHash(): Doc {
    return ' ';
}

// A glued `(`/`[` after a control head continues the head as a call or index on moc 1.1.0.
export function bareBranchSpace(): Doc {
    return ' ';
}

// `if (c) - 1` is a subtraction on moc 1.1.0, so the sign stays glued.
export function unaryOperand(op: Doc, operand: Doc): Doc {
    return glue(op, operand);
}

export function juxtapositionSpace(): Doc {
    return ' ';
}

export function commentSplitsSeam(
    commentText: string,
    glued: boolean,
): boolean {
    return glued && commentText.trim() !== '';
}

export interface ChecklistItem {
    readonly n: number;
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

export function blankLine(): Doc {
    return [hardline, hardline];
}
