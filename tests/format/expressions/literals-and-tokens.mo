/**
 * Literals, identifiers and the operator spellings that are pure syntax: nothing here changes shape.
 *
 * ## Where this file comes from
 *
 * Six legacy tests — `scientific notation literals`, `multi-line text`, `hexadecimal notation`,
 * `exponential notation`, `identifier tokens`, `quote literals` — hold 21 cases, and four more
 * (`logical operators`, `pipe operator`, `null coalesce operator`, `shared and query keywords`) are
 * single spellings of the same kind. All of them are `expectFormatted` or near it: the input is
 * already canonical, so the assertion is that the printer leaves the *token* alone.
 *
 * Measured in one pass (`.probe/_literals.mts`): **29 PASS, 0 DIFF, 2 THROW**. This file is those 29.
 *
 * ## Why this is a fixed-point fixture and not a formatting one
 *
 * A literal is one token, so there is nothing for the printer to lay out — except that a `"` string
 * may span lines, and a hexadecimal or exponent literal may carry an underscore or a sign that a naive
 * printer would normalise away (`0xF_F` must not become `0xff`, `1.e1` must not become `1.0e1`). That
 * is the whole content of the file: **the printer reproduces literal text byte for byte**. The
 * `expectFormatted` shape is what makes the test readable — the input and the snapshot are the same
 * bytes, so any diff in review is a defect and not a layout choice.
 *
 * `multi-line text` is the case worth reading twice. A `"` literal containing newlines is *one token*
 * whose text contains them, and the printer must reproduce it exactly rather than re-indenting it —
 * including the leading spaces on its continuation lines and the blank lines inside it. The last case
 * in that section is a string whose content is `{\n};`, which is here because it is the input most
 * likely to be mistaken for Motoko code by anything that scans the file rather than parsing it.
 *
 * ## The two refusals
 *
 * `exponential notation`'s `.1e1` and `invisible unicode characters`'s zero-width space are **not
 * Motoko**: `moc` 1.16.1 and 2.0.0-beta.1 both reject them, and so does our own parser. They are
 * `delete` for the same reason as the pile in `docs/fixture-triage.md` §"The refusals, measured" — the
 * old engine accepted them because it shaped lines rather than parsing.
 */

// --- Scientific and exponential notation ----------------------------------------------------------
//
// The three forms that differ in where the sign and the fraction sit. `1.7976931348623157e+308` is
// `Float`'s maximum, so a printer that parsed the literal into a number and printed it back would
// round it here.

let s1 = 1e2;
let s2 = -1e-2;
let s3 = 1.7976931348623157e+308;

let e1 = 1e1;
let e2 = 1e-1;
let e3 = 1.e1;

// --- Hexadecimal notation -------------------------------------------------------------------------
//
// The underscore is a digit separator and the case of `F` is the author's, not the printer's. All five
// spellings must survive as written.

let h1 = 0xf;
let h2 = 0xF;
let h3 = 0xf_f;
let h4 = 0xF_f;
let h5 = 0xF_F;

// --- Identifier tokens that look like numbers -----------------------------------------------------
//
// `x.0.e0x` is member access with numeric field names, not a float. The second line is the same
// expression with a trailing `x`, which is a separate declaration rather than part of the literal —
// the pair is here because a printer that tokenised greedily would merge them.

x.0.e0x;

x.0.e0 x;

// --- Multi-line text ------------------------------------------------------------------------------
//
// One token spanning lines. The printer reproduces it exactly, so the leading spaces on continuation
// lines and the blank lines inside the string are all preserved. The last case's content is `{\n};`,
// which is deliberately Motoko-shaped text inside a string.

"A
B";

"  A
  B";

"A

B";

"A

  B";

"
A

  B
    ";

"

{
};

";

// --- Quote literals and the two-character operators -----------------------------------------------
//
// `'a'` is a character-ish quote literal and `"a"` a string; `|>`, `??`, `and`, `or`, `not` are all
// token spellings with no layout of their own. `shared query func` is included because the modifier
// order is fixed and a printer must not reorder it.

'a';

"a";

A and B;

A or B;

not A;

A |> f;

a ?? b;

a ?? b ?? c;

shared query func f() : async () {};
