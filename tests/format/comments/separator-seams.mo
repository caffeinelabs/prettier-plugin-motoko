/**
 * Comments sitting on the *separator seam* of a list: a `//` that is itself a list item, or the item
 * immediately before a list's own `;`/`,`.
 *
 * This fixture is a correctness fixture, not a style one. Every case in it used to make the printer
 * **throw**, and it threw on input `moc` accepts — so the printer could not format a file the
 * compiler builds. That is the same failure class as `angle-lists.mo`'s `trailingComment`, with the
 * same mechanism, one item earlier in the list.
 *
 * ## The mechanism, once
 *
 * `commentDoc` is `[verbatim(node), breakParent]` (walk.ts). A line comment's text is therefore
 * already terminated by a forced break, and anything the printer appends *after* that doc lands
 * inside the comment, because a `//` runs to the newline. The old code appended the separator after
 * the item:
 *
 *     f(a // c
 *     , b);          ->   f(
 *                           a
 *                           // c,        <- the comma is inside the comment
 *                           b
 *                         );
 *
 * The separator is gone, the guard re-parses, sees a different tree, and refuses. So the fix is
 * ordering: for a comment, the break goes **first** and the separator **after** it, which is the only
 * spelling that ends the comment before the separator.
 *
 * ## Why a line-leading separator is not a hack
 *
 * `,` and `;` on a line of their own are ordinary Motoko, and the corpus writes them —
 * `../motoko/test/repl/lib/type-lub.mo` leads seven lines with `,`. moc accepts both spellings, and
 * the outputs below are checked against it rather than assumed (`.probe/_cfitems.mts` records the
 * three target forms parsing with 0 syntax errors, measured with `/tmp/moctar/moc -dp` and grepped
 * for `syntax error`, because moc's exit code is unreliable and reports 0 for both).
 *
 * ## The cases are the three sites the rule reaches
 *
 *  - a **list** separator (`betweenSeparator`) — `par_exp`, `array_exp`, and the two angle families,
 *  - the **last** item's separator (`trailingSeparator`) — `f(a, b // c)` spelled with a comma,
 *  - a **source-file** separator (`sourceFileDoc`) — where a comment is an item in its own right, so
 *    `let o = 1 // c` / `;` puts the `;` in exactly the same seam.
 *
 * The last one is why `sourceFileDoc` routes through `trailingSeparator` at all rather than emitting
 * its `;` directly: a file is a `semi_sep` list, and this is the one input where that shows.
 */

// A comment as a non-last item, with the source's comma after it. The ordinary case, and the one the
// old code got wrong most visibly: the list is forced broken by the comment, so the separator has to
// lead its own line.
let parExp = f(
    a // c
    ,
    b
);

// The same seam in a bracket list. `array_exp` is the other `comma_sep` family, and it is listed
// separately from `par_exp` in `parts.ts` so the rule is pinned twice.
let arrayExp = [
    a // c
    ,
    b
];

// A comment as the *last* item, with a trailing comma after it. `trailingSeparator` used to emit the
// comma after the comment's forced break, exactly as `betweenSeparator` did, and swallow it the same
// way. Only the separated case is affected: an unseparated last item emits `''` and has nothing to
// swallow, which is why this is narrow.
let trailingComma = f(
    a
    // c
    ,
);

// The file-level seam. Here the comment is not inside a list at all — it is a `source_file` item, and
// the `;` is *its* separator rather than the preceding declaration's. `let o = 1 // c` puts the `;` on
// the next line, which makes it the comment's, and the old `sourceFileDoc` emitted it directly into
// the comment.
let fileSeam = 1 // c
;

// The angle families carry the same rule and an additional hazard: the close is `closeGlued`, so a
// comment as the *last* item also has to drop the glue and precede the `>`. That last-item case is
// `angle-lists.mo`'s and is fixed there. This is the non-last case, where the comma is the problem
// and the glue is not yet involved.
//
// It is an `inst` rather than a `typ_params` for a reason that is moc's rather than the printer's: a
// comment inside a `typ_params` is a syntax error for moc no matter where the comma goes (measured —
// both spellings report one), which is the same asymmetry `angle-lists.mo` records in
// `TrailingCommentInParameters`. So a `typ_params` version of this case could not be a fixture
// asserting the printer formats *valid* Motoko, because the input is not valid Motoko. `inst` is the
// family that accepts the comment, so `inst` is where the rule is pinned from the outside.
let angleSeam = L.make<
    A // c
    ,
    B
>();

// A block comment is NOT the same case and must not move. It ends at its own delimiter rather than at
// the newline, so a separator after it is already outside it and the ordinary `left, then break`
// order is correct. This pair with the first case is the point of the rule being `isLineComment`
// rather than a `willBreak` test on the doc: `willBreak` is also true for an item that merely
// *contains* a comment, and moving the separator for one of those would detach the comma from its own
// item — a rewrite the guard would catch, and worse output than the bug it fixed.
let blockCommentUnaffected = f(
    a /* c */
    ,
    b
);
