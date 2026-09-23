/**
 * The whitespace-sensitivity core: the seams where Motoko's meaning depends on spacing.
 *
 * This module is the executable form of `docs/adjacency.md` §7 (the implementation
 * checklist). Every rule below names the rows it implements, so a reader can go from
 * a line of code to the probe that justified it. Where the document and the probes
 * disagree with intuition, **the document wins** and the comment says so — several of
 * these rows are the opposite of the natural spelling. The two that most often get
 * "fixed" back into a bug are called out inline:
 *
 *   - `if c { ... }` keeps the head **bare** (H5), while `if f(x) { ... }` is
 *     **paren-wrapped** (H1). Same construct, opposite treatment, because a bare name
 *     is atomic and a call is not.
 *   - `if (c) -1 else 2` gets a space *before* the `-` and **none after** (B3). All
 *     three other spellings are syntax errors on at least one moc, including the two
 *     that read as "more correct".
 *
 * ## The three parsers
 *
 * The `preserve` invariant is "output means the same under moc 1.x **and** moc 2.0".
 * The formatter is built on tree-sitter-motoko, which is a *third* parser, and it
 * disagrees with moc in both directions (`docs/adjacency.md` §5). So this module never
 * delegates a decision to tree-sitter's own error recovery. The grammar tells us the
 * *shape*; the rules below tell us the *spelling*.
 *
 * ## What is here, and what is not
 *
 * Only the seams. Everything else (`docs/adjacency.md` §2.9) is free-spaced and belongs
 * to the area printers' own layout choices. A rule earns a place here only if some
 * other spacing of the same tokens parses to a different tree, or fails to parse.
 *
 * The module is deliberately dependency-light: `prettier`'s doc builders and nothing
 * else. It is imported by every area printer, so an import cycle here would be an
 * import cycle everywhere.
 */

import { doc } from 'prettier';
import type { Doc } from 'prettier';

const { hardline, line } = doc.builders;

/** The four verbs `docs/adjacency.md` §0.1 assigns to a token pair. */
export type Verb =
    /** A space is mandatory and must not be turned into a newline. */
    | 'force-spaced'
    /** Two tokens must be adjacent in the printed output. */
    | 'force-glued'
    /** A space before, `none` after (or the mirror) — the asymmetric rows. */
    | 'force-spaced-before'
    | 'force-spaced-after'
    /** Any whitespace, or none: the pair is not a seam at all. */
    | 'free';

/**
 * A glue: zero-width text that forces its neighbours together with no separatable space.
 *
 * Prettier removes leading and trailing whitespace **inside** a `group`, but it does not
 * remove whitespace *between* sibling docs — a `line` in there is still a legal break. So
 * a "glued" pair cannot be expressed by simply omitting the space; the pair has to be
 * emitted as one `concat` with nothing between the parts.
 *
 * `glue()` exists to make that intent explicit at the call site, and — more usefully — to
 * be the *only* way this module produces a zero-width separator. A reviewer can grep for
 * it, which is how the "no separator was emitted where one was required" class of bug is
 * caught. `glue()` with no arguments is also the honest spelling of "these two docs are
 * one token" in a template literal that would otherwise read as a typo.
 */
export function glue(...parts: Doc[]): Doc {
    return parts.length === 0 ? '' : parts.length === 1 ? parts[0] : parts;
}

/**
 * The number-dot rule (D1–D4, checklist item 5).
 *
 * `5.` is lexed as a **Float literal**, not as an integer followed by a dot. So the seam
 * between a number and a projection is not a seam we get to choose: `5.toText()` has no
 * `.` token at all in the tree (the literal is `"5."`), while `5 .toText()` has a real
 * `.` and a real `Text(" ")`. Emitting `5. toText()` — a space *after* the dot — re-lexes
 * moc's way into `Float 5.` applied to `toText`, which is M0097 and a different program.
 *
 * tree-sitter cannot see this (S1: it reads `5. toText()` as field access anyway), so the
 * printer is the only thing standing between the author and a silent meaning change. The
 * rule is therefore mechanical: if the source spelled the number glued to the dot, the
 * printed form is glued too. `dotExp` is where that is decided.
 */
export const NUMBER_DOT_GLUED = true;

/**
 * Head positions: the constructs whose condition/scrutinee is a *spelling* decision, not a
 * layout one.
 *
 * H1–H4 are the core safety finding of `docs/adjacency.md`: the "tight head"
 * (`if f(x) { }`) is a moc ≥ 1.7 spelling, and on 1.1.0 it is a **syntax error** — both the
 * tight and the spaced bare forms fail, and only the parenthesised form parses. The
 * printer cannot know which compiler will read its output, so it emits the parenthesised
 * form, always, whenever the head is anything a `<`-free atom is not.
 *
 * The complement is H5–H7: a bare name, an already-parenthesised expression, and a
 * `<`-free atom stay bare. Forcing parens onto `if c { }` would churn every `if` in every
 * corpus for no safety gain, since it is fine on all three compilers.
 */
export type HeadKeyword = 'if' | 'while' | 'switch' | 'for';

/**
 * Does this head need parentheses? H1–H4 / checklist item 1.
 *
 * The decision is made on the **node the printer was handed**, not on the source text, so
 * it survives a rewrite. The caller passes the classified shape of the head expression;
 * the classifier lives in `exp.ts` (`headShapeOf`) because it needs the node kinds, and
 * keeping the kind table there is what lets the printer's `switch` stay exhaustive.
 *
 * `'atom'` is the `<`-free case of H7: a projection, an identifier, a literal, a record
 * literal in expression position. Those are unambiguous after any of the four keywords, so
 * they stay bare. `'par'` is H6: already parenthesised, so wrapping again would be churn
 * and would nest `((c))`.
 */
export type HeadShape =
    /** A bare name or other `<`-free atom: `if c`, `if o.x`, `if 1`. H5/H7. */
    | 'atom'
    /** Already a `par_exp`: `if (c)`, `if (f(x))`. H6 — do not wrap again. */
    | 'par'
    /** Anything compound: a call, an index, an instantiation, an operator chain. H1–H4. */
    | 'compound';

/**
 * Whether a head of this shape must be parenthesised — checklist item 1, rows H1–H4.
 *
 * Read this as a whitelist of what may stay bare, not a blacklist of what is dangerous.
 * The document's H1–H4 enumerate the compound cases it probed; a new grammar node that
 * lands in neither list must still be safe, and the only spelling that is safe for an
 * unknown compound node is the parenthesised one. So the default is `'compound'` and this
 * function only has to recognise the two shapes that may stay bare.
 */
export function headNeedsParens(shape: HeadShape): boolean {
    return shape === 'compound';
}

/**
 * Operator tokens that must never be split, and never have a space inserted inside
 * (checklist item 7, `docs/adjacency.md` §2.7).
 *
 * These are all the same failure: the lexer produces one token from these characters, and
 * any whitespace between them produces two tokens the grammar cannot fit back together.
 * The list is data rather than a chain of `if`s because it is also used by the adjacency
 * *test* — a missing entry would otherwise be invisible until moc rejected a real file.
 *
 * `->` is included even though `a -> b` is fine: the *inner* seam is what must never be
 * split (`- >` is a syntax error), and the surrounding space is the area printer's call.
 */
export const INDIVISIBLE_OPERATORS: ReadonlySet<string> = new Set([
    // Assignment operators. `a : = b` is a syntax error in both moc generations.
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
    // Pipe and power.
    '|>',
    '**',
    // Wrapping arithmetic.
    '+%',
    '-%',
    '*%',
    // Arrow. The seam inside it, not around it.
    '->',
    // Postfix star/quest unaries, whose suffix is part of the token.
    'await*',
    'async*',
    'await?',
    // Shifts and rotates. Note the *two* `>` of a shift must come from one token: `a > > b`
    // does not re-lex (`docs/adjacency.md` §2.7).
    '<<',
    '>>',
    '<<>',
    '<>>',
]);

/**
 * Is this token text an operator that must be emitted as one unsplittable unit?
 *
 * The area printers call this rather than testing membership directly, so that a future
 * addition (a new operator, or a rule that some entry is conditional) has one place to
 * live. It is `false` for anything not in the set, which is the safe answer: a non-seam
 * operator is free to have its own layout.
 */
export function isIndivisible(tokenText: string): boolean {
    return INDIVISIBLE_OPERATORS.has(tokenText);
}

/**
 * The `<` disambiguation rule (L1–L7, checklist item 3).
 *
 * `<` is the single most context-dependent character in the language, and the three parsers
 * decide what it means by *different mechanisms*:
 *
 *   - **moc (both generations)** uses grammar context. `f <Nat>(1)` and `f<Nat>(1)` give the
 *     identical tree, so moc does not care about the spacing at all.
 *   - **tree-sitter** uses adjacency: the instantiating `<` is `token.immediate("<")`, so a
 *     space *before* it makes it a comparison instead. `f <T>(x)` is therefore a
 *     *different tree* here than `f<T>(x)`, purely from the space.
 *
 * The printer's own parser is tree-sitter, and the printer's output is re-read by
 * tree-sitter (the runtime guard), so **force-glued wins** even though moc would accept
 * either. The reverse seam — comparison — is force-spaced on *both* sides, because moc's
 * lexer only produces `LTOP`/`GTOP` when there is whitespace on both sides: `x<y;` is a
 * syntax error in both moc generations.
 *
 * So there are two functions rather than one flag, because the verb differs by *role*, and
 * the caller is the one that knows the role. Getting this backwards is the mistake the
 * document warns about twice; the two names are deliberately dissimilar so a call site
 * cannot pick the wrong one by momentum.
 */

/**
 * The instantiating `<`: glue it to its type arguments and to whatever precedes it.
 * Rows L1, L2, L5, L6, L7.
 *
 * `docs/adjacency.md` L5 is the reason this is a `glue` and not a `line`: `List<List<Nat>>`
 * must not become `List<List<Nat> >`, because `> >` does not re-lex to a close pair under
 * either moc or tree-sitter.
 */
export function instantiationAngles(inner: Doc): Doc {
    return glue(inner);
}

/**
 * The closing `>>` of nested instantiation, forced together. Row L5.
 *
 * Separate from `instantiationAngles` because the failure it prevents is different: the
 * danger is not the space *around* the angles but between two adjacent `>` characters,
 * which the lexer reads as a rotate when glued and as two comparisons when not. Emitting
 * them as one `glue` makes the "no space inside" property structural rather than a promise.
 */
export function nestedClose(parts: Doc[]): Doc {
    return glue(...parts);
}

/**
 * A comparison operator: force-spaced on both sides, never glued. Rows L3, L4.
 *
 * `x<y;` is a syntax error on both moc generations, so this is not a style preference. The
 * space must also not become a newline in a place where the operator would end a line —
 * noc breaks after the operator for binary chains (`docs/style.md`), which keeps this seam
 * intact by construction, but a hand-built doc could still get it wrong.
 */
export function comparisonOp(op: string): Doc {
    return [line, op, line];
}

/**
 * `??`: free-spaced before, **force-spaced after** (C1, checklist item 4).
 *
 * The token is `alias(token(/\?\?[ \t\r\n]/), "??")` — **the trailing whitespace is part of
 * the token**. Three consequences the printer must respect:
 *
 *   - C2/C3: `a ??b` and `a??b` are syntax errors on all three parsers, because the regex
 *     needs a trailing space character to match. So the space after is mandatory.
 *   - C4: `a ??\nb` is *also* a syntax error, since `\f`/`\v` are not in the class and a
 *     newline after `??` is not the same token as a space after it. The break must go
 *     *before* the operator, never after.
 *   - The space before is free (`a ?? b` and `a?? b` both parse). We emit one, because a
 *     glued `??` on the left is what C7 misreads in moc 1.x as two `?` tokens.
 *
 * `line` after `??` would be legal Doc IR but illegal Motoko, so this returns the space as
 * a literal string rather than a `line`: there is no width at which breaking here is
 * correct.
 */
export function coalesceOperator(op: string): Doc {
    return [line, op, ' '];
}

/**
 * Two option tokens in a row: `? ?a` (C6, C7). Space mandatory, break forbidden.
 *
 * C7 is the 1.x-vs-2.0 divergence and the reason this cannot be left to layout: `?? a` is
 * accepted by 1.1.0 as `?` applied to `?a`, but 1.16.1 and 2.0 split the glued `??` into
 * two `?` tokens and reject option-of-option written that way. `? ? a` is fine on all
 * three, so the space is the cross-generation spelling and a line break here would produce
 * `?\n?` which is a third thing again.
 */
export function doubleOption(): Doc {
    return '? ?';
}

/**
 * `#` at the head of a tag, and the seam *before* a `#` (P1, B5, checklist item 6).
 *
 * moc 2.0's lexer has a `TIGHT_HASH` rule: `not trailing_ws && next is ID && (leading_ws ||
 * not (ends_exp prev))`. Read against the probes, that produces two opposite requirements
 * at two different seams:
 *
 *   - The `#` glues to **its tag**: `#less`, `#ok(1)`. A space there stops it being a tag.
 *   - The `#` is spaced from **whatever precedes it** when that is a head or an expression
 *     end: `if (c) #less else #greater` is OK everywhere, `if (c)#less` is a syntax error on
 *     1.16.1+/2.0.
 *
 * tree-sitter is blind to the whole seam (S5: `h-paren-head`, `h-case`, `h-type` all come
 * back `SAME`), so the moc columns are the authority and this function encodes them rather
 * than a tree-shape inference.
 */
export function hashTag(tag: Doc): Doc {
    return ['#', tag];
}

/**
 * The `#`-before seam: force a space, and forbid a break. B5, P1.
 *
 * Returns a plain `' '` rather than a `line` for the same reason `coalesceOperator` does:
 * the break would land between an expression end and a `#`, and B5's probe rows say that
 * seam is spacing-sensitive in a way tree-sitter cannot check.
 */
export function spaceBeforeHash(): Doc {
    return ' ';
}

/**
 * A bare branch opener after a head: force a space, no break. B1, B2, B3, B5.
 *
 * This is the mirror of the head rule and the two must be read together. H1/H2 force the
 * *head* into parens; B1/B2 then force a space between the head and a branch that starts
 * with `(` or `[`, because on 1.1.0 a glued `(`/`[` continues the head as a call/index
 * instead of starting the branch:
 *
 *     if (c)(e) else f;    TYPE    SYNTAX  SYNTAX
 *     if (c) (e) else f;   TYPE    TYPE    TYPE   <- safe
 *
 * B3 is the sharpest row in the document and the one most likely to be "corrected" by
 * someone reading it as a typo: of `-1` glued, ` -1` lead-space, and ` - 1` spaced, only
 * ` -1` parses on all three. `- 1` is a *subtraction* on 1.1.0, which turns the branch into
 * a record literal or an error depending on what follows. So the space goes before and
 * never after.
 *
 * A newline here would be a fourth spelling, and not one any probe blessed — the operand
 * must stay on the same line as the space. Hence `' '`, not `line`.
 */
export function bareBranchSpace(): Doc {
    return ' ';
}

/**
 * A unary `-`/`+`/`^` applied to an operand: glue it to the operand. B3, and §3.2.
 *
 * The unary token and its operand are one unit for lexing purposes in every spelling that
 * works. What varies is the seam *before* the operator, which `bareBranchSpace` owns. The
 * second half of §3.2 is the rule the printer must never break: **never brace a
 * unary-minus branch**. `if (c) -h { 1 } else { 5 }` is a syntax error on all three (the
 * `-` is read as a binary subtraction and `{ 1 }` becomes a record literal), and
 * `if (c) - h { 1 } else { 5 }` only parses on 2.0. The universally accepted form is the
 * *bare* branch `if (c) -h else 5`, where the minus is part of a negative literal. That
 * decision belongs to `control.ts` (it is a choice about the branch's *shape*), and it is
 * flagged here because this is where a reader looks for the minus rule.
 */
export function unaryOperand(op: Doc, operand: Doc): Doc {
    return glue(op, operand);
}

/**
 * Juxtaposition: `f x` (J1, J2). Force-spaced, and it must stay a *space*.
 *
 * There is no glued spelling of juxtaposition, so the whole rule is "do not merge this into
 * a call, and do not collapse the space". The second half is the trap: `f  x` and `f x` are
 * the same tree (two spaces are `SAME`), so a layout pass that dropped the space would not
 * be caught by tree-sitter — it would just silently turn `f x` into `f(x)`-shaped input for
 * moc, which is `x` applied to `f`.
 *
 * J2 is the record-argument case (`f { a = 1 }`), where the same seam is between an
 * expression end and a `{`. That one is load-bearing in the *other* direction: a `{` after
 * a head-opens-a-body position is a block, so the space is what keeps this a record
 * argument. `spaceBeforeHash`'s sibling, and the reason both return a literal space.
 */
export function juxtapositionSpace(): Doc {
    return ' ';
}

/**
 * The newline a binary chain breaks on, emitted **after** the operator (`docs/style.md`).
 *
 * Here rather than in `exp.ts` because it is the same seam as `comparisonOp`'s: an operator
 * that must be spaced from both operands, where the space may become a line on the right
 * only. A chain that broke *before* its operator would put the operator at the start of a
 * continuation line, which is a layout choice Prettier would then have to re-derive — and
 * for `??` it is illegal outright (C4).
 */
export function breakAfterOperator(op: Doc): Doc {
    return [op, line];
}

/**
 * A comment inside a force-glued seam is a **hard conflict** (`docs/adjacency.md` §4).
 *
 * The probes are unambiguous: a comment wedged between a callee and its `(` is a `B-ERROR`
 * under tree-sitter (the `(` is no longer immediate, so the head is no longer a call), a
 * comment before an index bracket is the same class, and a comment after `??` breaks that
 * token outright (its text includes the whitespace, C4). The rule the document draws is
 * "either move the comment outside the seam, or do not break the seam" — and moving a
 * comment is not something a formatter may do silently, because the comment is the
 * author's text.
 *
 * So this is a *diagnostic*, not a helper: it exists to be called when the printer finds a
 * comment it cannot place without splitting a seam, and the caller decides between hoisting
 * it (round-tripping the text to before the expression) and failing. Returning a boolean
 * rather than throwing keeps the policy at the call site, since different seams have
 * different safe hoists — a genuinely line-shaped decision that a shared helper would get
 * wrong for at least one of them.
 *
 * A comment can sit at more than one seam in the same expression (one before the bracket,
 * one after it), so the caller threads its own state; a module-level flag would leak
 * between files.
 */
export function commentSplitsSeam(
    commentText: string,
    glued: boolean,
): boolean {
    // A comment only conflicts when the seam it lands in is one that must be glued. In a
    // free-spaced seam a comment is ordinary layout and every area printer handles it.
    return glued && commentText.trim() !== '';
}

/**
 * The whole checklist, as a value, for the adjacency test to iterate.
 *
 * `docs/adjacency.md` §7 ends with a nine-item list; the test that guards this module walks
 * it and asserts one case per item, so an item cannot be dropped from the checklist without
 * a test going red. Keeping the list *here* rather than only in the test means the source
 * and its verification name the same rows.
 */
export interface ChecklistItem {
    /** The document's item number, so a failure message points at §7. */
    readonly n: number;
    /** The row ids the item implements (`H1`–`H4`, `B3`, `L5`, …). */
    readonly rows: readonly string[];
    /** What the printer must do, in one line. */
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
        rows: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'],
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

/**
 * The blank line a broken construct ends with, spelled once so the rule is greppable.
 *
 * Not an adjacency row — it is here because `docs/style.md`'s "at most one blank line, and
 * the printer never invents one" is the other global layout invariant, and the two global
 * invariants living in two files would make "where is the global layout policy?" a
 * question with two answers. `hardline` twice is the *only* blank line this module emits;
 * `hardline` once is an ordinary line break and is every area printer's business.
 */
export function blankLine(): Doc {
    return [hardline, hardline];
}
