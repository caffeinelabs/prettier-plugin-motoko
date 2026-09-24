/**
 * `prettier-ignore`: a directive comment suppresses formatting of the item after it.
 *
 * ## Where this file comes from
 *
 * The legacy `prettier-ignore` test holds four cases. Two are portable as written, one needs a
 * spelling that parses, and one is not Motoko at all:
 *
 * - `//prettier-ignore\n1*1;\n2*2` and its blank-line variant — portable; both are below.
 * - `// prettier-ignore\n{\nabc}` — portable; the record at the end is below.
 * - the block-comment directive on a record spanning lines — **not Motoko**. `moc` rejects it
 *   (`M0001`, "unexpected token '}'"): record fields need `;`, so the two fields in the operand have
 *   no separator between them. The *directive* is fine, and its block spelling is exercised below at a
 *   spelling that parses; what is dropped is the malformed operand. See `docs/fixture-triage.md`
 *   §"The refusals, measured" for the class this belongs to.
 *
 * ## The rule
 *
 * `src/printer/walk.ts:itemDoc` looks at the item *before* the one it is printing and, if that item
 * is a comment whose text is `prettier-ignore`, emits the current item through `verbatim` instead of
 * through `nodeDoc`. So the ignored item reproduces its source bytes exactly — including spacing the
 * printer would otherwise normalise — and its neighbours are unaffected.
 *
 * That "neighbours are unaffected" half is the point of the third and fourth sections: the directive
 * applies to exactly one item, so the item after it still normalises. A fixture with only ignored
 * items would pass even if the directive leaked to the rest of the file.
 *
 * ## Why the ignored lines look unformatted on purpose
 *
 * `1*1` and `2*2+2` are here because this printer normalises operator spacing (`operator-spacing.mo`
 * in `tests/format/expressions/` is the positive control). Writing the canonical `1 * 1` after a
 * `prettier-ignore` would make the fixture pass whether or not the directive works, which is the
 * failure mode this file exists to catch.
 */

// --- A line-comment directive suppresses the next item --------------------------------------------
//
// `1*1` keeps its missing spaces; `2*2` on the next line does not, because the directive covers one
// item and not the rest of the file.

//prettier-ignore
1*1;
2*2;

// --- The directive does not swallow the blank line after it ---------------------------------------
//
// The legacy case pairs this with the one above to show the two behaviours are independent: the
// ignored item is still verbatim, and the blank line the author wrote still survives as one blank.

//prettier-ignore
1*1;

2*2;

// --- A spaced directive works the same way --------------------------------------------------------
//
// `// prettier-ignore` with a space is the same directive (`isIgnoreDirective` trims), so the
// multi-line record is kept on its own lines. The second pair is the control: the same record with no
// directive collapses to one line, which is what makes the first pair evidence of anything.

// prettier-ignore
let rec1 = {
abc};

let rec2 = {
abc};

// --- The block-comment spelling -------------------------------------------------------------------
//
// A block comment is a comment too, so it is a directive when its inner text is `prettier-ignore`.
// On its own line the printer keeps it where it is and the item after it is verbatim.

/* prettier-ignore */
let b1 = 2*2+2;

let b2 = 2*2+2;

// --- A directive in the middle of a file ----------------------------------------------------------
//
// The case that most needs pinning: the ignored item sits between two ordinary ones, so a directive
// that applied from its line to the end of the file would be visible here and nowhere above.

let a = 1*1+1;

// prettier-ignore
let b = 2*2+2;

let c = 3*3+3;
