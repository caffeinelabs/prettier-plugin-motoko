/**
 * Angle lists: `typ_params` and `inst`, and the one item glue cannot be trusted with.
 *
 * Both families are `closeGlued` — the closing `>` is never preceded by a break, not even a
 * `softline` that flattens to nothing — because moc's lexer reads a `>` with whitespace on both
 * sides as `GTOP` rather than a close, so a broken `>` stops being a closing angle bracket. That
 * rule is `docs/style.md`'s and this fixture is where it is pinned from the outside.
 *
 * ## The last section is the bug this fixture exists for
 *
 * A **line comment** as the list's last item is the single case glue gets wrong, and it got it wrong
 * silently until now: `commentDoc` forces the group open, so the list is always printed broken, and
 * the glue then attached the `>` to the comment's own text — `// c>` — which drops the close
 * entirely. `src/verify.ts` caught it on re-parse, so the file was never *written* wrong; the printer
 * threw instead, and it threw on input moc accepts:
 *
 *     let x = L.make<
 *       Nat,
 *       Int // c
 *     >();
 *
 * That is `inst: trailing comment` below, and it is the case that makes the exception a correctness
 * fix rather than a taste. There is no join that works: glue puts the `>` inside the comment, and a
 * space leaves the `>` inside it too, because a line comment runs to the newline. The close goes on
 * its own line, which is the only spelling that ends the comment first.
 *
 * A **block** comment is not the same case and stays glued — it ends at its own delimiter rather
 * than at the newline, so the `>` after it is outside. `blockCommentStaysGlued` is that pair.
 *
 * ## Why every case is bound with `let` or `type`
 *
 * Same reason as `member-chains.mo`: a bare expression would be an `exp_dec` whose `;` is a
 * source-file sibling, and the fixture would then be asserting a token it did not mean to test.
 */

// Fits, so the angles stay flat and the close is glued to the last argument — the ordinary case the
// `closeGlued` flag is written for.
let fitsFlat = L.make<Nat, Int>();

// Over `printWidth`, so the list breaks: one argument per line, and the `>` glued to the last one
// rather than broken onto a line of its own, which is the rule this family exists to enforce.
let breaksWithCloseGlued = someLongReceiverNameHere.methodName<SomeLongTypeArgumentName, AnotherLongTypeArgumentName>(anArgument);

// The same shape as a type parameter list. `typ_params` carries the identical `closeGlued` rule, and
// the two families are listed separately in `parts.ts`'s table precisely so this can be pinned twice.
type LongTypeParameters<SomeLongTypeParameterName, AnotherLongTypeParameterName, AThirdLongOne> = SomeLongTypeParameterName;

// The trailing line comment — the crash. `moc 1.16.0` accepts the input, so a printer that refuses it
// cannot format a file the compiler builds. The close takes a line of its own and the `>` is outside
// the comment; `// c` is not swallowed and neither is the `>`.
let trailingComment = L.make<
    Nat,
    Int // c
>();

// A line comment in the *middle* of the list is a different question and never needed the exception:
// the comment is not last, so the glue is not what the close follows. It breaks to its own line at
// the list's indent and the following argument continues after it.
let middleComment = L.make<
    Nat, // c
    Int
>();

// A block comment as the last item stays glued. This is the pair to `trailingComment`: the same
// position and the opposite answer, and the reason is where the comment ends — at its own delimiter
// rather than at the newline — so the `>` is already outside it.
let blockCommentStaysGlued = L.make<Nat, Int /* c */>();

// The same seam in a `typ_params`, where moc is stricter about a trailing comment than it is for
// `inst`: this exact input is a syntax error for moc, so the printer's job is only to keep the
// tokens in the same order and let the guard compare trees. Recorded so the asymmetry is visible
// rather than looking like an oversight in the case above. `_moccheck.mts` reports this file with
// exactly one moc error *in* and one *out*, which is this declaration in both — the fixture is not
// introducing a parse problem moc did not already have.
type TrailingCommentInParameters<A, B // c
> = A;

// Below `printWidth` after breaking, so the group's fit check settles it and the close stays glued
// even though the source was written with the `>` on its own line — the flag overriding the source's
// own layout, which is visible churn this area is allowed to produce because a broken `>` is not
// parseable in the first place.
type ShortParameters<
    A,
    B
> = A;
