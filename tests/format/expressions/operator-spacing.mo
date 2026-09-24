/**
 * The `+`/`-`/`*`/`/`/`^` seams: what `preserve` does with the space the source did, and did not, write.
 *
 * ## Where this file comes from
 *
 * The legacy suite (`tests/legacy/formatter.test.ts`) splits these seams across four separate tests —
 * `unary operators`, `unary / binary operators`, `multiplication and division spacing`,
 * `addition vs. positive number`, `subtraction vs. negative number`. Between them they hold 27
 * replayable cases, and all 27 already print correctly through this printer (`.probe/_tally.mts`, and
 * the per-case output in `.probe/_adj.mts`). So this fixture is that whole group moved into one file
 * at the source's own spelling: every expression below is a legacy input verbatim, and the snapshot
 * is the assertion that the printer still does what the group always asked for.
 *
 * ## The rule it asserts, and why the two halves are both here
 *
 * `docs/adjacency.md` §3 owns the `-` seam and reaches the sharpest result in that document: of the
 * four spellings of "minus one" after a head, only one parses on all three compilers. The printer's
 * job is therefore *not* to normalise `-` away. It is to give a **binary** operator its spaces and to
 * leave a **unary** sign glued to its operand — and those two jobs pull in opposite directions on the
 * same character, which is why a printer that only knew one of them would pass half of this file.
 *
 * So the fixture deliberately holds both directions:
 *
 *   - `1+1` → `1 + 1`. The source left the space out; both parses and both meanings agree, so
 *     supplying it is free and the style guide asks for it.
 *   - `x - +1` → unchanged. Here the `+` is unary. A normaliser that treated every `+` as binary
 *     would emit `x - + 1`, which is a subtraction of a spaced `+ 1` — and on 1.16.1 that spelling
 *     does not parse at all (adjacency.md's `br-neg-space` row).
 *
 * The pair is the whole rule. Either half alone is passed by a printer that is wrong about the other.
 *
 * ## Why `verify.ts` is what makes the second half enforceable
 *
 * A wrong bend here is not a layout preference, it is a different program. The runtime guard compares
 * the printed token stream against the tree the printer was given, so collapsing `x - +1` into
 * `x - + 1` is a hard failure at format time rather than a snapshot someone has to notice. That is why
 * the cases below are worth pinning even though most of them are byte-for-byte identity: they are the
 * cheap regression test for a guard that is doing real work.
 */

// --- Binary seams: the source omitted a space and the printer supplies it -------------------------
//
// Every line is the same seam: two operands and an operator the source wrote tight. `1*1` and `1 * 1`
// are the same tree, so normalising costs nothing and the style guide asks for it.

1 +   5;
1+1;
1+1.0;
x+1;
x+1.0;
1*1;
x*1;
1/1;
x/1;
1-1;
1.0-1.0;
x-1;
x-1.0;

// The same seam written the *other* way round: the space is before the sign, not after it. `1 +1` is
// still one plus one — `+` is binary here, not unary — so the printer is free to print `1 + 1`, and
// does. This is the pair that shows the rule is about the operator's *arity*, not its spelling: the
// source wrote `+1` tight and the printer still spaces it, because it read a binary `+`.
1 +1;
x +1;
1 -1;
x -1;

// `1./+5` is the case that a naive rewrite gets wrong twice over. The `.` closes the float literal
// `1.` (not a member access), and the `+` is unary. The printer emits `1. / +5` — the binary space
// between the operands, and the unary `+` still glued to its `5`.
1./+5;

// --- Unary seams: the gluing is load-bearing, so it is preserved ----------------------------------
//
// A run of unary operators. `-+5` is minus applied to plus applied to `5`; respacing it as `- + 5`
// would be a subtraction of a positive literal, which is a different tree with a different meaning.
// All of these are identity cases, and `^ ^ a` is the one that is not even tight — the printer keeps
// the source's own gap rather than choosing one.

-+5;
+-a;
+ - ^5;
^ ^a;
^ ^ a;

// --- Unary signs after a head: the cases that must not be bent ------------------------------------
//
// The `+`/`-` here sits where a binary operator could also sit, so getting it wrong silently changes
// the parse rather than failing loudly. `x+ -1` is the tight form of "x plus negative one"; `x - +1`
// is its mirror. Both keep the unary sign glued.
x+ -1;
x - +1;

// An argument, an index position, and a return: three more heads a unary sign can follow. `x(+1)` and
// `x(-1)` are calls whose argument is a signed literal; bending either would turn the sign into a
// binary operator against a missing left operand.
x(+1);
x(-1);
return +1;
return -1;

// The statement-boundary case. The `+` opens a *second* statement, so it is not continuing `x` — and
// reading it as a binary `+` across the `;` is exactly the mistake this line exists to catch. The
// printer keeps them on separate lines.
x;
+1;
