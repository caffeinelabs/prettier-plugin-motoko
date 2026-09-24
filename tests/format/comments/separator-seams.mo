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
 * ## The comment stays on the line the author put it on
 *
 * Ordering alone leaves one more question — where the comment itself goes — and the answer is the
 * source's. A comment the source wrote at the end of `a`'s line (`a // c`) stays there, and the
 * separator leads the next line; a comment the source wrote on a line of its own is left there. That
 * is what `docs/style.md`'s fence shows (`a = 1; // first` stays glued) and what 0.13.0 did: a
 * trailing comment is *attached* to the item before it, and detaching it is churn the style does not
 * ask for. So the seam checks the comment's own gap — no newline before it means the source wrote it
 * on the previous item's line — and glues rather than breaks when that is what the source did.
 *
 * The two are independent, which is why both are pinned below: the *separator's* place follows from
 * the comment being an item that would swallow it, and the *comment's* place follows from the source.
 * A block comment is forced open by its `breakParent` like any other, so the fixture's `block` case
 * breaks the list too — that is the group rule, not the separator rule.
 *
 * ## Why a line-leading separator is not a hack
 *
 * `,` and `;` on a line of their own are ordinary Motoko, and the corpus writes them —
 * `../motoko/test/repl/lib/type-lub.mo` leads seven lines with `,`. moc accepts both spellings, and
 * the outputs below are checked against it rather than assumed: each is printed, written to a file,
 * and fed to `/tmp/moctar/moc -dp` (`.probe/_moccheck.mts`), whose report is grepped for
 * `syntax error` — **not** read from its exit code. The distinction is load-bearing here and was got
 * wrong once: these cases are fragments, so moc fails name resolution on them and exits 1 whether or
 * not the separator is spelled right. ON THE INPUT the fix replaced — the comma inside the comment,
 * `f(\n  a // c,\n  b\n)` — moc reports **zero syntax errors too**, and exits 1 for the same
 * name-resolution reason. That is exactly why this bug needed no compiler to find and is a guard
 * catch rather than a moc catch: the mis-spelling parses, it just means a different tree, so
 * `verify.ts`'s re-parse comparison is the only thing that can see it. The grep is what separates
 * "accepted" from "accepted as something else".
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
// lead its own line. The comment itself stays on `a`'s line, because that is where the source put it.
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

// The attachment rule on its own, with no separator in the seam to confuse it. The two declarations
// differ only in where the author wrote the comment, and the printer reproduces that difference rather
// than picking one: `preserve`'s job is to change layout, not to move a comment the source placed.
// `angle-lists.mo` pins the same pair one item later, in the `closeGlued` seam.
let attachedComment = f(a, b // trailing
);
let ownLineComment = f(
    a,
    // own line
    b
);

// A block comment takes the other branch of the *attachment* rule and the same branch of the group
// rule. Its `breakParent` forces the list open exactly as a line comment's does — the group rule does
// not care which comment kind it is — but it stays glued to `a`, because that is where the source
// wrote it, and the separator after it is already outside the comment. This pair with the first case
// is the point of the rule keying on the comment's *kind*: `willBreak` is also true for an item that
// merely *contains* a comment, and moving the separator for one of those would detach the comma from
// its own item — a rewrite the guard would catch, and worse output than the bug it fixed.
let blockCommentUnaffected = f(
    a /* c */
    ,
    b
);
