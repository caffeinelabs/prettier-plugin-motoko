/**
 * Comment placement, and the verbatim rule.
 *
 * ## Where this file comes from
 *
 * The Comments triage group (`docs/fixture-triage.md` §"Comments — mostly **change**"): `line
 * comments`, `block comments`, `line comment in single line`, `prettier-ignore line comment as first
 * line in block`, `unclosed quotes in comments`. The sixth name in that group, `prettier-ignore`, is
 * a **keep** and already has its own fixture (`tests/format/comments/prettier-ignore.mo`); it is not
 * repeated here.
 *
 * ## The rule, from `docs/style.md` §Comments
 *
 * "**Printed verbatim.** Never converted between `//` and block form. Never reflowed, re-wrapped or
 * re-indented beyond the current indentation level." And: "A **line comment inside a group forces the
 * group to break.**"
 *
 * That is the whole content of this file. Every case below is a comment whose *text* the printer must
 * reproduce byte for byte — including a comment whose text contains a quote, a brace, or a semicolon
 * — sitting where the printer has to decide only *where the comment goes*, never what it says.
 *
 * ## Measured
 *
 * `.probe/_cmtport.mts` (pass 1, the legacy inputs verbatim), `.probe/_cmtport2.mts` through
 * `.probe/_cmtport8.mts` (the re-spellings, the placement set and the group-break control), and
 * `.probe/_cmtfinal.mts`, which reads *this file* and reports parse-clean, the four mocs' verdicts
 * and the fixed point. Per case: our parser accepts it, all four mocs accept it, and the printer's
 * output is a **fixed point**. `moc`'s exit code is 0 for invalid input too and `--check` writes to
 * stderr, so the verdicts come from a verifier that reads both streams (`_cmtverify.mts`). The four
 * builds, by the label the tables below use:
 *
 * | label   | path                                                      | `--version`                                       |
 * | ------- | --------------------------------------------------------- | ------------------------------------------------- |
 * | 1.1.0   | `~/.cache/dfinity/versions/0.31.0/moc`                    | `Motoko compiler 1.1.0 (source q8nbql1z-…-j6bq1lwd)` |
 * | rel1.16 | `/tmp/moctar/moc`                                         | `Motoko compiler 1.16.1 (source cmnnq83c-…-qfay9xca)` |
 * | pin     | `/tmp/moc6385/src/_build/default/exes/moc.exe`            | `Motoko compiler (source 1.16.1-26-g1d57a4fc7b)`   |
 * | v2      | `/tmp/mocnow/moc`                                         | `Motoko compiler 2.0.0-beta.1 (source cm629575-…-q1bsqjv2)` |
 *
 * A warning for whoever re-measures this: `.probe/_fixverify.mts` writes every case to the fixed
 * path `/tmp/_fv.mo`. With more than one agent probing in this worktree, a concurrent writer lands
 * between the write and the `moc` read and the column silently reports *another* agent's source. The
 * first run of this port was wrong for exactly that reason (it reported `SYNTAX` for a run of stars
 * between two slashes, which is a comment). `_cmtverify.mts` writes a pid-unique file instead.
 *
 * ## The change this group is about
 *
 * The legacy `line comment in single line` expects `a<(b,\n//c\n)>()` to become `a<(b, /* c */)>()`
 * — a `//` rewritten into block form so the group could stay on one line. That is the old algorithm
 * doing what the verbatim rule forbids: it moved a comment's *text* to make a layout work. The
 * section below is that same input and the printer now keeps `//c` as written and breaks the group
 * instead, which is the second half of the rule above.
 *
 * ## The known failure, reproduced and reported
 *
 * **Status: fixed on an unmerged branch.** PR #197 (`fix/comment-separator-seam`) repairs this whole
 * class — the separator moves to the line after the comment, and the comment stays where the source
 * put it. So the four rows below are a *reproduction on the current tree*, not an open question, and
 * they must not be re-derived. They are kept in this header because they are the reason none of the
 * four inputs appears in the body: a fixture that throws fails the whole suite rather than pinning
 * one behaviour, and deleting the note would make the omission look accidental.
 *
 * There is a seam where **the printer throws on input all four mocs accept**. The minimal input is
 *
 *     let o = { a = 1 // first
 *     ; b = 2 };
 *
 * which every moc parses (measured: `OK` on all four — it reaches no error at all) and our own parser
 * also accepts, but `prettier.format` fails the internal re-parse with
 *
 *     prettier-plugin-motoko: internal error — the printer produced code that does not parse.
 *     Unexpected input at 4:7.
 *
 * The class is a comment sitting **between an item and its separator**: a line comment before the `;`
 * of a record field, or before the `,` of an array/tuple element, or before the `;` of a sequence
 * element. Measured instances and their exceptions:
 *
 * | input                                   | moc      | printer |
 * | --------------------------------------- | -------- | ------- |
 * | `let o = { a = 1 // c\n; b = 2 };`      | OK x4    | `does not parse`, `Unexpected input at 4:7` |
 * | `[ 1 // c\n, 2 ];`                      | OK x4    | `changed the meaning`, `at .0.0` (input 6, output 3) |
 * | `(a // c\n, b);`                        | TYPE x4  | `changed the meaning`, `at .0.0` (input 6, output 3) |
 * | `1 // c\n; 2;`                          | TYPE x4  | `changed the meaning`, `at ` (position blank) |
 *
 * The block-comment spelling of the first row is *fine* (`let o = { a = 1 /* c */; b = 2 };` prints);
 * so is the same comment in any position that is not immediately before the separator
 * (`let o = { a = 1; /* c */ b = 2 };` prints). So the gap is specifically a comment between an item
 * and the token that follows it, and none of these four inputs is below.
 * `.probe/_cmtport5.mts` is the script that produced the table; `.probe/_throwcheck.mts` reproduces
 * all four independently, controls included.
 *
 * ## Two groups are not valid Motoko at all
 *
 * Neither is ported at its legacy spelling. Both are `delete`-class, and
 * `docs/grammar-deviations.md` is where a gap like this belongs rather than a snapshot.
 *
 * 1. **`prettier-ignore line comment as first line in block`** — `{\n// prettier-ignore\n  123}`. All
 *    four mocs reject it: `syntax error [M0001], unexpected token '}', expected one of token or
 *    <phrase> sequence`. At head a bare `{ … }` is a **record literal**, not a block, so `123` has to
 *    be a field and it is not one — the identical error appears with no comment present
 *    (`{ 123 }`, and `{123}`). The directive is exercised below at a spelling that is a block,
 *    `do { … }`, where all four mocs accept it and the comment survives verbatim.
 * 2. **`unclosed quotes in comments`** — eight fragments of the form `// a'b\n '` (a comment
 *    containing a quote, then a bare `'`). The bare `'` is the problem, not the comment: `moc`
 *    answers `syntax error [M0002], malformed operator` or `unclosed text literal`, and so does our
 *    parser. What the legacy test was really pinning — that a quote *inside* a comment does not open
 *    a literal — is kept below, with a real statement after the comment instead of a bare quote.
 *
 * ## Every statement ends in `;`
 *
 * The harness formats this file as one program. Two adjacent statements with nothing between them are
 * a parse error (`Missing ';'`), and a top-level `{ … }` is a record literal and needs one too.
 */

// --- Line comments are verbatim, and a run of blanks still collapses to one -----------------------
//
// The comment inside the record and the comment after it are both `//`; neither is converted, and the
// `//` after the record keeps its `}\n//` placement with no space invented between them — the legacy
// `line comments` case expected `} //` on one line, which is the placement change this section pins.
// (Measured: the space is the whole difference; when nothing follows the `//` it prints on its own
// line, `}\n//`, and with items after it the two tokens are glued, `}//`, exactly as the source has
// them. `.probe/_cmtport8.mts`.) The blank-line rule is `docs/style.md` §Blank lines and applies to
// comments like any item.

{//
}//

//a
//b

//a


//b

// The legacy `line comments` case in its `;` spelling: the record is a statement and the comment
// after it is a separate item. Both the comment inside the record and the one on the last line are
// kept, and the file-edge trailing blank is dropped.

{
//
};

//

// --- A line comment inside a group forces the group to break ---------------------------------------
//
// This is the `line comment in single line` case, and the reason the group is a **change**. The
// legacy expectation `a<(b, /* c */)>()` only works if the `//` is rewritten, which the verbatim rule
// forbids. Keeping `//c` means the comment runs to end of line, so the group opens up instead. The
// same input with no comment (`a<(b)>()`) is the control: it stays on one line, so the break below is
// the comment's doing and not a rule about `<…>` argument lists.

a<(b,
//c
)>();

a<(b)>();

// --- Block comments: the star run, verbatim --------------------------------------------------------
//
// The legacy `block comments` test loops `/*` + n stars + `/` for n in 0..9 and expects each back
// unchanged. All ten print as written. They are here because a printer that "normalised" comment
// text — collapsed a run of stars, re-indented a multi-line comment — would move exactly these.

/**/
/***/
/****/
/*****/
/******/
/*******/
/********/
/*********/
/**********/
/***********/

// The `=` and space spellings, also `expectFormatted` in the legacy suite. `/**/` is two chars of
// body and `/** **/` is a body that is not a doc comment, whatever the opener looks like.

/*=*/
/**=*/
/**=**/
/** **/
/*** **/
/** ***/

// One comment token spanning lines. Its internal newlines are its own text, so they survive as
// written, including the leading spaces on the continuation lines.

/****
-----
******/

// The same multi-line comment as an item of a record. The legacy spelling puts a `;` right after the
// closer (`…******/;`) and all four mocs reject it — `unexpected token ';'` on 1.1.0/rel1.16,
// `braces \`{ ... }\` enclose a record literal` on pin/v2 — because the comment is not a field, so the
// `;` has no item to follow. Without the `;` it is an ordinary item and prints as written.

{
  /****
  -----
  ******/
};

// --- Adjacent block comments, and the blank rule between them --------------------------------------
//
// The legacy `/**//**/` case expects a space between the two comments; measured, the printer puts
// each on its own line, which is the **change** (a space would be a character the source does not
// have). The blank version is `\n/**/\n\n\n/**/`: the file-edge blanks are dropped and the run of
// three collapses to one, so the two comments are separated by one blank line.

/**//**/

/**/


/**/

// --- A comment is a token, not whitespace ----------------------------------------------------------
//
// `let/*{{*/x` is one `let`, one comment and one binding, and the comment's braces are its own text:
// it is not a record literal and does not open one. The spaced spelling on the second line is the
// same program — the printer does not add or remove the space around the comment, because a comment
// is a token and the gaps around it are the author's.

let/*{{*/x = 0;//x
 (x);

let /*{{*/ x = 1;

// --- The `prettier-ignore` directive, at its valid spelling -----------------------------------------
//
// The legacy spelling of this case (`{\n// prettier-ignore\n  123}`, section header above) is not
// Motoko: `{ … }` is a record literal and `123` is not a field. `do { … }` *is* a block, all four
// mocs accept it, and the printer honours the directive there — the ignored `123` reproduces its
// source spacing (`  123`) while the block around it re-indents. The third case is the control: the
// same block with an ordinary comment and no directive, where the item normalises.

do {
// prettier-ignore
  123};

do {
// c
  123};

// --- A quote inside a comment does not open a literal ----------------------------------------------
//
// The `unclosed quotes in comments` group, re-spelled. In every case the comment's text contains a
// quote character — a bare `'`, a bare `"`, or one of the two sitting next to a semicolon or a brace
// — and the next line is a real statement. A lexer that scanned the comment as code would see an
// unterminated literal here; the printer reproduces both the comment and the statement unchanged.

// a'b
1;

// a"b
1;

//'
1;

//"
1;

/*'*/ 1;

/*;"*/ 1;

/* a'b */ 1;

/* a"b */ 1;
