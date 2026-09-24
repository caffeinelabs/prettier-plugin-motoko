/**
 * `switch`/`case`: where a broken switch puts its arms.
 *
 * Every case here is written so that the *source's own* layout is not the one the rule asks for, and
 * the first section is the one that mattered: written flat and over `printWidth`, the switch used to
 * break inside the `case (` — because the arm's pattern is a `tup_pat` owning a `comma_sep` list, and
 * that list was the only break candidate under the enclosing node. The arms never got a line of their
 * own, and no gate in this repo could see it: `verify.ts` compares token texts, and
 * `switch (x) { case (\n #a\n) e }` has exactly the same tokens as the flat spelling.
 *
 * The shape the snapshot should show is `docs/style.md` §"Switch / case layout": one `case` per line
 * when the switch breaks, arms indented one level, and the arm body hugging `case p { e }`.
 *
 * ## Two different `;`s, and both are tested below
 *
 * A bare `switch` at the top level is an `exp_dec`, and the grammar requires a `;` between two of
 * them — that is the *statement* terminator, and it is the same rule as anywhere else. Inside the
 * braces there is a second, unrelated `;`: the source's own arm separator, which `preserve`
 * reproduces and never chooses. The cases that write both are marked, because reading one as the
 * other is the easy mistake here.
 */

// Over `printWidth` at 80, so the arms must take a line each. Before this area printer existed this
// broke inside `case (` on every arm — see the header.
switch (someLongScrutineeExpressionHere) {
case (#alphaVariant) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambda;
case (#betaVariant) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambda;
case (_) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambda
};

// A switch that fits stays on one line, which `docs/style.md` explicitly allows — `line` flattens to
// a space, so the one Doc gives both layouts and the rule needs no `ifBreak`.
switch (mode) { case #up { +1 }; case #dn { -1 } };

// The scrutinee's own parens are the source's, not the printer's: §"Switch / case layout" keeps them
// as written, so a paren-free scrutinee stays paren-free.
switch x { case (#a) 1 };

// An arm whose body has no break point of its own puts its break between the pattern and the body —
// the "indented one more level" half of the rule. The pattern itself stays flat, which is the point:
// before the arm owned a break, the only thing that could give was the `tup_pat` around it.
switch (someLongScrutineeExpressionHere) {
case (#a) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambdaMuNuXiOmicronPiRhoSigma;
case (_) 2
};

// Both `;`s at once: the arm separator after `2` is inside the braces, and the statement terminator
// is the one after `}`. The source's arm separator is a real child token, so it is reproduced exactly
// and never chosen — `.probe/_switchsemi.mts` measures that the two spellings have different shapes.
switch (x) { case (#a) 1; case (_) 2; };

// No trailing arm separator in the source, none in the output: the same rule, the other direction.
// The `;` here is only the statement terminator.
switch (x) { case (#a) 1; case (_) 2 };

// A body that can break *internally* hugs `case p { e }` and takes its break inside itself — the
// guide's own shape. This is the half that shows why the arm does *not* emit its break
// unconditionally: doing that would orphan the `{` on a line of its own, which is neither form the
// guide allows.
switch (x) {
case (#alphaVariant) { alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambdaMuNuXi1 };
case (#betaVariant) { alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambdaMuNuXi2 }
};

// The case that decides *how* "can break internally" is tested, and the one a narrower test gets
// wrong. A nested `switch` is not a list, but it is a body with a break of its own to give — so it
// hugs, exactly as the block above does, with its arms one level deeper than the outer arm. The
// first draft asked `listOf(body) !== null`, which missed this and printed the inner `switch` on a
// line of its own with the arm orphaned above it.
switch (a) {
case (#VCon (tag, args)) switch tag { case "0" b; case _ { assert false; #VInt 0 } };
case _ { assert false; #VInt 0 }
};
