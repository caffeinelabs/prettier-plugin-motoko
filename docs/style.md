# Motoko style, as the printer must produce it

This is the written-down style the tree-sitter printer implements. It is
normative for the printer: every rule below is meant to be turned into a test.

It is not a general Motoko style guide for humans. Where it differs from the
compiler's style guide, the difference is deliberate and is called out under
[Conflict rulings](#conflict-rulings).

## Sources, in order of authority

1. **`doc/md/reference/style-guide.md` at PR #6385 head** (`1d57a4fc`). The diff
   from `master` to that commit is the newest statement of intent: it is where
   parenless heads, no-`;`-between-arms and "brace every body" were decided.
2. **`docs/formatter-rework.md`**, sections "Style" and "Key choices". This is
   where the printer's own rules (semicolon printing, chain breaking, comment
   handling) are specified.
3. **Real code at `1d57a4fc` head** — `samples/**`, `doc/md/**`,
   `src/prelude/*.mo`. Used to settle anything the first two do not state, and
   cited inline as `path:line`.

A rule that only source 3 supports is marked **(observed convention)** and is a
candidate for the "most likely to be wrong" list at the end.

Two facts about the grammar constrain everything below and are not style
choices:

- The tree-sitter grammar's separators are per-node. `semi_sep` allows a trailing
  `;` before the closing delimiter; `semi_sep1` requires a `;` before a
  following item and also allows a trailing one; `comma_sep` never emits a
  trailing comma. From `tree-sitter-motoko@0.2.0` `grammar.js`:

    ```js
    function comma_sep(r) {
        return seq(repeat(seq(r, ',')), optional(r));
    }
    function semi_sep(r) {
        return seq(repeat(seq(r, ';')), optional(r));
    }
    function semi_sep1(r) {
        return seq(repeat(seq(r, ';')), r, optional(';'));
    }
    ```

    `semi_sep` nodes: `block_exp`, `obj_body`, `object_exp` (plain form),
    `obj_typ`, `obj_pat`, `source_file`, `import`. `semi_sep1` nodes:
    `variant_typ`, `object_exp` (the `... with ...` form).

- A trailing `;` is never semantically significant. `motoko/src/mo_frontend/parser.mly`
  has `%inline semicolon: SEMICOLON | SEMICOLON_EOL` and
  `typ_obj: LCURLY tfs=seplist(typ_field, semicolon) RCURLY` — the separator is
  optional at the end of every such list. The printer is therefore free to add
  or drop the trailing `;` for layout reasons, and does.

## Layout fundamentals

### Indent

Two spaces per level. No tabs. No vertical alignment: never pad to line up a
second column of `:` or `=`. Every indentation is an exact multiple of two
(the style guide's "no indentation that is not a multiple of 2").

```motoko no-repl
// before
switch opt {
    case (?name) { "Hello " # name };
    case (null) { "" };
};
// after
switch opt {
  case ?name { "Hello " # name }
  case null { "" }
}
```

Note `samples/app/server.mo` and the fences inside `doc/md/**` are indented 1
and 4 spaces respectively. Those are authoring artifacts of the files
themselves, not the printed style. The printer normalises to 2.

### printWidth

80 columns. The width is measured in the printed output, so it is not affected
by the source's own line breaks. `printWidth` is the standard Prettier option
and the printer must honour it.

### Blank lines

At most one consecutive blank line in the output, and the printer never invents
one. Runs of two or more blanks collapse to one; leading and trailing blanks
inside a file are dropped.

```motoko no-repl
// before
a;


b;



// after
a;

b;
```

This is testable directly against the ported fixtures:

- `format('\n\na;\n\n\nb;\n\n')` → `'a;\n\nb;\n'`
- `format('a;\n\n\n\n\nb')` → `'a;\n\nb;\n'`

A blank line is kept only where the author put one, subject to the rule below.

### Blank line after the import section

If a file has imports, print exactly one blank line after the last import,
before the first declaration. If the file has no imports, print no leading
blank line.

```motoko no-repl
// before
import A "A"; actor {}
// after
import A "A";

actor {};
```

Ported fixture: `format('import A "A"; actor {}')` → `'import A "A";\n\nactor {};\n'`
(the test is named `double newline after import section`).

### Blank lines inside bodies

Kept as written, up to one. Real code groups logic with single blank lines and
the printer preserves that grouping:

```motoko no-repl
// samples/hoare.mo at 1d57a4fc (shape preserved)
while a[i] < pivot {
  i += 1
};

loop {
  ...
};
```

**(observed convention)** The style guide says nothing about blank lines inside
bodies beyond the general one-blank-line rule; the plan says "at most one blank
line kept and none invented". This document follows the plan.

## The semicolon rules

The single most load-bearing part of this document. The rule is stated as a
decision table so that a printer test can be written for each row.

The underlying rule has two halves:

- **Between items, `;` is always printed**, including after an item that ends in
  `}`. This is required by the grammar on every list except switch arms.
- **After the last item, `;` is printed only when the enclosing construct is
  broken over several lines.** In Doc IR this is `ifBreak(";")` on the closing
  token's group, and only when `semi` is true.

`case` arms are the one exception: there is no `;` between arms, in either
syntax mode (see the table). moc's own grammar states the reason:

> The `;` between cases is optional: every case starts with the `case` keyword,
> so the separator disambiguates nothing.

### Read this table as the `moc2` target

The decision table below is the **`moc2`** rule, and every "`ifBreak`",
"`trailingComma`", and "`semi`" cell in it is **inert under `preserve`**. It is
kept here because it is the specification `moc2` implements, and because the
mechanics it names are what `docs/semicolons.md` analyses.

`preserve` cannot implement those cells, and the reason is not a preference: the
runtime guard compares the printed token stream against the tree the printer was
given, and **a separator is a token**. So a `;` the printer adds or removes is a
difference the guard must reject — `verify.ts`'s tolerance list is empty on
purpose. What `preserve` prints is therefore _the source's own separators_,
which is strictly weaker than the table:

- **Between items** the two rules coincide, and that is provable rather than
  fortunate: the grammar _requires_ a separator there. `{ a = 1 b = 2 }` and
  `module M { let a = 1 let b = 2 }` both fail to parse (`Unexpected input`),
  so a source that parses at all already has the `;` the table asks for, and
  "preserve it" and "always print it" are the same rule.
- **After the last item** they diverge, because the trailing `;` is genuinely
  optional: `{ a = 1; }` has four children where `{ a = 1 }` has three. That is
  the whole reason `trailingSeparator` reproduces the source instead of
  computing the table's cell.
- **`comma_sep` is not a separator question at all.** `(1 2)` and `[1 2]` do not
  fail — they parse as a _call_ and as an _index_. So in that family the space
  is not a style choice the printer may make; removing it or adding it changes
  which construct the source denotes, and `README`'s adjacency rules apply
  (`docs/adjacency.md`). The table's `,` row describes the case where the source
  _did_ write the comma.
- **Switch arms.** Between arms there is never a `;` — `case` ends the previous
  arm. After an arm, `preserve` keeps whatever the source had. This is not a
  no-op relative to `moc2`: the `;` is a real token in the tree, and
  `switch x { case 1 { a }; case 2 { b } }` and its `;`-free form have different
  shapes (measured — `.probe/_switchsemi.mts`). So `moc2`'s dropping it is a
  real edit that the guard is told about, not an invisible one.

`docs/semicolons.md` §2 carries the empirical work behind this section, and the
child-count table there is the measurement `trailingSeparator` is built from.

### Decision table

| construct                            | between items | after last item, one line | after last item, broken           | separator node               |
| ------------------------------------ | ------------- | ------------------------- | --------------------------------- | ---------------------------- |
| block (`{ ... }`)                    | `;`           | none                      | `;` (`ifBreak`)                   | `semi_sep`                   |
| module / actor / object / class body | `;`           | none                      | `;` (`ifBreak`)                   | `semi_sep` / `semi_sep1`     |
| record literal, plain form           | `;`           | none                      | `;` (`ifBreak`)                   | `semi_sep`                   |
| record literal, `... with ...` form  | `;`           | none                      | `;` (`ifBreak`)                   | `semi_sep1`                  |
| object type `{ x : T; ... }`         | `;`           | none                      | `;` (`ifBreak`)                   | `semi_sep`                   |
| variant type `{ #a; #b }`            | `;`           | none                      | `;` (`ifBreak`)                   | `semi_sep1`                  |
| tuple / call args / array            | `,`           | none                      | `,` if `trailingComma != "none"`  | `comma_sep`                  |
| switch arm, bare body                | n/a           | none                      | `;` in `preserve`, none in `moc2` | `optional(";")` after `case` |
| switch arm, braced body              | n/a           | none                      | `;` in `preserve`, none in `moc2` | `optional(";")` after `case` |

Notes on the rows:

- **`semi: false`** turns every "broken → `;`" cell into "none". It only affects
  the trailing `;`, never the between-items `;`. This matches how motoko-core
  is written today (`motoko-core/Styleguide.md`), which is the reason the option
  exists.
- The `semi_sep1` rows (variant types, `with`-form record literals) require a
  `;` before a following item _and_ allow one at the end, so their trailing cell
  behaves exactly like the `semi_sep` rows. The distinction only matters for a
  **single-item** list: `{ #ok : A }` has no printed `;` on one line, and
  `{ #ok : A; }` broken. Both parse. `comma_sep` differs: it never prints a
  trailing comma even when broken, unless the printer's `trailingComma` option
  says so, because it is a `comma_sep` and not a `comma_sep1`.
- **switch arms.** Between arms there is never a `;` — `case` ends the previous
  arm. After the last arm's body: `preserve` keeps whatever the source had (so
  existing motoko-core files keep their `;`), `moc2` drops it, because the
  grammar makes it unnecessary. This is the one place where the two syntax
  modes differ on semicolons.

### Worked examples

Single-line block, no trailing `;`:

```motoko no-repl
// before
func succ(x : Nat) : Nat { return x + 1 };
// after: unchanged, braces inline, no ; before }
func succ(x : Nat) : Nat { return x + 1 };
```

Broken block, trailing `;`:

```motoko no-repl
// before
func sign(n : Int) : Text { switch n { case -1 { "neg" } case 0 { "zero" } case _ { "other" } } };
// after
func sign(n : Int) : Text {
  switch n {
    case -1 { "neg" }
    case 0 { "zero" }
    case _ { "other" }
  }
};
```

The `};` on the last line is the `ifBreak(";")` for the function's block body.
With `semi: false` it prints `}` alone.

One-line record, no trailing `;`; broken record, trailing `;`:

```motoko no-repl
// one line
let p = { x = 1; y = 2 };
// broken
let p = {
  x = 1;
  y = 2;
};
```

Variant type, `semi_sep1`:

```motoko no-repl
// one line — no trailing ;
type Result<A> = { #ok : A; #error : Text };
// broken — trailing ; on the last tag
type Status = {
  #Active;
  #Inactive;
  #Banned : Text;
};
```

Both forms appear at head: `doc/md/fundamentals/types/results.md` has the
one-line form with no trailing `;`, `doc/md/fundamentals/types/variants.md` has
the broken form with one.

Switch arms, both modes:

```motoko no-repl
// preserve, source had ; after the braced arm — keeps it
switch opt {
  case null { tryAgain() };
  case _ { proceed() };
}
// moc2 — drops it after every arm
switch opt {
  case null { tryAgain() }
  case _ { proceed() }
}
```

Module body, broken, trailing `;`:

```motoko no-repl
// doc/md/fundamentals/declarations/module-declarations.md at 1d57a4fc
module Matrix {
  public func ...
};

module class ExchangeRate(baseRate : Float) {
  ...
};
```

### Interaction with the ported fixture expectations

The existing expectations in `tests/legacy/formatter.test.ts` are the **`moc2`**
behaviour, and they are the specification for M3 rather than a gate on this
printer. They are not run (`tests/legacy/README.md`). Two of them would fail
against `preserve` by construction, and that is expected rather than a defect:

- `format('{\n}')` → `'{};\n'`. The `;` here is the table's _broken → `;`_ cell,
  i.e. the `ifBreak` this printer does not emit; `preserve` prints `{}` alone.
- `format('{\n}\nA\n')` → `'{};\nA;\n'`: the `;`s are again added, not preserved.

Where the table and `preserve` agree — the between-items case — the expectations
hold as written, because the source already had the separator. The others are
restated here with the cell they exercise, so the port is a matter of naming
rather than re-deriving:

- `format('{\n\n}')` → `'{\n\n};\n'`. An empty block written across lines keeps
  its one blank line, and _being broken_ takes the trailing `;`. `preserve`
  keeps the blank line (the empty-list branch in `listDoc`) and omits the `;`.
- Tuples: `'(\n  a,\n  b,\n  c,\n)'` with a trailing comma by default, and the
  comma dropped under `trailingComma: 'none'`. Both are the _broken → `,` if
  `trailingComma != "none"`_ cell; `preserve` prints whichever the source had.
  The trailing `;` of an enclosing block disappears under `semi: false` — a
  `moc2` cell again.

## Blocks, records, object types: one line vs broken

One rule, applied to all of them:

> Print one line if the whole construct fits in `printWidth` and contains no
> hard break of its own. Otherwise break: one item per line, each indented one
> level, closing delimiter on its own line.

A "hard break of its own" means an item that cannot be printed on one line
itself — a nested broken block, a multi-line string, a line comment (see
[Comments](#comments)).

```motoko no-repl
// fits — stays on one line
type Vec3D = { x : Float; y : Float; z : Float };
let o = { a = 1; b = 2 };
func add(x : Nat, y : Nat) : Nat { return x + y };

// does not fit — breaks, one field per line, trailing ; (broken block)
type CarInfo = {
  model : Text;
  plate : Text;
  isValid : Bool;
  wasStolen : Bool;
  expires : Nat;
};
```

`type CarInfo` is the real shape from `samples/pa_cars.mo` at head: one field
per line, `;` on every field including the last.

**Braces are always printed as written; the printer never adds or removes
them** except under the `moc2` rewrite. Specifically, a bare-branch `if`
produced by the printer must come from `moc2`; `preserve` keeps
`if (c) v else -v` exactly as the author wrote it, parens and all.

## Switch / case layout

- One `case` per line when the switch breaks. Arms are indented one level; the
  arm's body is indented one more level if it breaks, and hugs `case p { e }` on
  one line if it fits.
- No `;` between arms (both modes). Trailing `;` after the last arm only in
  `preserve` (see the decision table).
- The scrutinee is printed as an expression. In `preserve`, its parens are kept
  as written; in `moc2`, head parens are dropped.
- A one-line switch is allowed when it fits: `switch mode { case #up { +1 } case #dn { -1 } }`.
  This is real output in the style guide's own example
  (`doc/md/reference/style-guide.md:881`) and in
  `doc/md/fundamentals/actors/enhanced-multi-migration.md`.

```motoko no-repl
// before (preserve: keeps the ; it had)
switch (compare(x, y)) {
  case (#less) { A };
  case (_) { B };
}
// after, preserve
switch (compare(x, y)) {
  case (#less) { A };
  case (_) { B };
}
// after, moc2
switch compare(x, y) {
  case #less { A }
  case _ { B }
}
```

### Case patterns: parentheses

In `moc2`, parenthesize the **payload**, not the whole pattern. A pattern that
already ends unambiguously takes no parentheses.

```motoko no-repl
case null { ... }
case ?n { ... }
case -1 { ... }
case #leaf { ... }
case #node(n) { ... }
case (n, #male) { ... }        // parens delimit a tuple pattern
case ({ x; y }) { ... }        // anything else not in the list above
```

This is the `unwrap-case-pattern` rewrite. `preserve` keeps the source's parens
(`case (null)` stays `case (null)`).

**(observed convention) / conflict.** `doc/md/fundamentals/control-flow/switch.md`
at head writes `case ?value { value }` in one place and `switch option { case null ... }`
elsewhere, while the style guide's own new example (`greet`) writes `case ?name`.
This document follows the style guide: the `moc2` form is `?name`, `null`,
`#leaf`, `#node(n)`. The doc file is stale.

## Function signatures

Break like TypeScript: parameters first, one per line with the closing `)`
aligned to the `func` keyword's indentation, then the return type, then the
body. No trailing comma on the last parameter.

```motoko no-repl
// before
func equal<Ok, Err>(self : Result<Ok, Err>, other : Result<Ok, Err>, equalOk : (implicit : (equal : Ok, Ok) -> Bool), equalErr : (implicit : (equal : (Err, Err) -> Bool))) : Bool { ... };
// after
func equal<Ok, Err>(
  self : Result<Ok, Err>,
  other : Result<Ok, Err>,
  equalOk : (implicit : (equal : Ok, Ok) -> Bool),
  equalErr : (implicit : (equal : (Err, Err) -> Bool))
) : Bool {
  ...
};
```

This is the exact shape used in `motoko-core/src/Result.mo`. Note the absence of
a trailing comma after `equalErr` and the `) : Bool {` line. **(observed
convention)** The style guide's broken-parameter example does use a trailing
comma; this document follows motoko-core because it is the largest body of real
formatted code and the plan's "break like TypeScript" points the same way.
Flagged at the end.

A signature that fits stays on one line:

```motoko no-repl
func add(x : Nat, y : Nat) : Nat { return x + y };
```

### `= e` function bodies

`func f(x : T) : U = e` is not broken, rewritten or expanded by either mode. It
stays exactly as written.

```motoko no-repl
// samples/quicksort.mo at 1d57a4fc
func cmpi(i : Int, j : Int) : Int = i - j;
// motoko-core/src/Bool.mo
public func logicalAnd(self : Bool, other : Bool) : Bool = self and other;
```

The plan lists "the `= e` function body" as explicitly out of scope.

## Binary chains

The grammar has **no operator precedence**. Every binary operator is a single
left-associative level, so `1 + 2 * 3` parses as `(1 + 2) * 3`. The printer must
therefore:

- **never add or remove parentheses around operators** — the parens in the
  source are the only thing that constrains the tree, and the CST is flat; and
- print a chain **flat** — no nested `group`s per operator — breaking **after**
  the operator into one indented run.

```motoko no-repl
// before
let total = firstLongOperand + secondLongOperand + thirdLongOperand + fourthLongOperand;
// after
let total =
  firstLongOperand +
  secondLongOperand +
  thirdLongOperand +
  fourthLongOperand;
```

Note there is exactly one level of indentation for the whole run, not one more
level per operator. This is what "no nested groups" means.

## `|>` pipelines

Break **before** each `|>`, one per line:

```motoko no-repl
// before
let result = xs.filter(isEven) |> mapDouble |> take(10) |> sum;
// after
let result =
  xs.filter(isEven)
  |> mapDouble
  |> take(10)
  |> sum;
```

Rationale: `|>` is the one operator people chain long enough that the operator
leads the line reads better than trails it, and it makes the pipeline read
top-to-bottom. Stated in the plan's Style section.

**(observed convention)** No `|>` chain long enough to break appears in the
`motoko` samples at head, so the break direction is a plan decision, not
observed. Flagged.

## Member chains

One call per line once there are more than two calls and the chain does not fit,
breaking **before** the `.` with 2-space indent:

```motoko no-repl
// before
const ident = 'x'.repeat(50);
x.repeat(50).repeat(50).repeat(50).repeat(50).repeat(50).repeat(50).repeat(50);
// after
x
  .repeat(50)
  .repeat(50)
  .repeat(50)
  .repeat(50)
  .repeat(50)
  .repeat(50)
  .repeat(50);
```

The commented-out test in `tests/formatter.test.ts` expects exactly this shape:

```ts
// test('multi-line statement indentation', ...
expect(await format(`${ident}.${ident}.${ident}`)).toStrictEqual(
    `${ident}\n  .${ident}\n  .${ident}\n`,
);
```

**Conflict.** The plan's Style section says "one call per line past two calls";
this document agrees and adopts the old test's break-before-`.` direction as the
concrete reading of that sentence. The plan does not state the direction, so the
test is the only evidence. Flagged.

A chain with two or fewer calls does not use the chain rule at all, even when it
overflows `printWidth`: it breaks at the arguments instead.
`xs.map(func (x : Nat) : Nat { x + 1 })` breaks inside the call's argument list,
not at the `.`.

## Comments

- **Printed verbatim.** Never converted between `//` and `/* */`. Never
  reflowed, re-wrapped or re-indented beyond the current indentation level.
  `///` and `//!` doc comments are ordinary line comments to the printer.
- A **line comment inside a group forces the group to break.** This is how
  Prettier normally treats own-line comments, and it is required here because a
  `//` comment swallows everything to the end of the line.

```motoko no-repl
// before — one line, but the comment forces a break
let o = { a = 1; // first
          b = 2 };
// after
let o = {
  a = 1; // first
  b = 2;
};
```

- When a line comment is itself a list item, the **separator goes on the line
  after it**, not on the comment's line. A `//` runs to the newline, so a
  separator printed after one is _inside_ the comment and the list loses it.
  This is a correctness rule rather than a taste one: the printer used to emit
  `// c,` here, which drops the comma, and it did so on input `moc` accepts.
  The corpus writes leading separators already (`test/repl/lib/type-lub.mo`
  leads seven lines with `,`), and `moc` accepts both spellings, so this is a
  layout change and not a spelling one. A **block** comment is not this case: it
  ends at its own delimiter, so a separator after it is already outside and
  stays glued to the item — which is why the rule keys on the comment's kind and
  not on "the item contains a comment".

    ```motoko no-repl
    // before — the comment is the item, so the comma must lead its own line
    let g = call(a // c
                 , b);
    // after
    let g = call(
      a
      // c
      ,
      b
    );
    ```

- Comment attachment follows Prettier's model. The tree-sitter parser's tree is
  flattened to plain objects and the comments are hoisted into `ast.comments`;
  Prettier attaches them. `prettier-ignore` is handled by the standard
  mechanism.

## Literals

Text, number and char literals are printed **verbatim from source**. The printer
must not:

- re-group digits (`1000000` stays `1000000`; `1_000_000` stays `1_000_000`) —
  the style guide recommends `_` grouping but the printer does not apply it;
- normalise number bases or suffixes (`0xff`, `1e10`, `1 : Nat32`);
- re-quote or un-escape text literals;
- change `'a'` to `'\u{61}'` or back.

```motoko no-repl
// unchanged in both directions
let n = 1_000_000;
let h = 0xff;
let c = 'a';
let s = "a \"quoted\" string";
```

## Conflict rulings

Where the sources disagree, this is the ruling and why.

### 1. Inner spacing of record literals

The style guide's spacing example writes `{ a = 1; b = 2 }` (spaces inside the
braces). Real code at head writes no inner spaces:
`samples/app/server.mo` has `{id = nextId; client = aclient; var revoked = false}`
and `{head = c; var tail = clients}`.

**Ruling: follow `bracketSpacing` (default `true`), i.e. spaces inside braces**,
for record literals, object types and objects alike. Reason: the style guide is
the authority, the spacing example is in the section that defines spacing, and
the ported fixture test `bracket spacing` already asserts
`format('{abc}') === '{ abc }'`. The head sample is the outlier and looks
hand-written.

### 2. Member-chain break direction

The plan says "one call per line past two calls" but not which side of the `.`
the break goes. The commented-out old test breaks before the `.`.

**Ruling: break before the `.`.** Reason: it is the only concrete evidence, and
it matches how the pipeline rule breaks before `|>`.

### 3. Broken signature: trailing comma or not

The style guide's example keeps a trailing comma; motoko-core omits it and puts
`) : T {` at column 2.

**Ruling: no trailing comma, `) : T {` at the `func` indentation.** Reason:
motoko-core is the largest corpus of real formatted Motoko, and the plan says
"break like TypeScript", which also omits the trailing comma in its own default
style. Note this does not conflict with the `trailingComma` option for tuples
and call arguments — that option is about `comma_sep` lists, and a parameter
list is one.

### 4. `switch option { case null ... }` vs `case ?name`

Docs at head use both `case ?value` and `case null`. The style guide's new
`greet` example settles it.

**Ruling: `moc2` prints `?name`, `null`, `#leaf`, `#node(n)`** — no
whole-pattern parens. The doc files are stale and will be reformatted.

### 5. `;` between switch arms

The plan says "always `;` between items" and then excepts switch arms. The
grammar and moc's `parser.mly` agree the arm separator is optional.

**Ruling: no `;` between arms, ever. Trailing `;` after the last arm is kept in
`preserve` and dropped in `moc2`.** Reason: stated in the grammar's own comment;
dropping it is safe on moc 2.0, and keeping it in `preserve` is what makes
motoko-core round-trip unchanged.

## Rules most likely to be wrong

Check these first against real diffs. Each is either a plan-only decision or
rests on a single piece of evidence.

1. **Member-chain break direction and threshold** (break before `.`, more than
   two calls). The plan is silent on direction; one commented-out test is the
   only source. Try it on `motoko-core` and the compiler tests and see whether
   the output looks like the code people write.
2. **`|>` break direction** (before). No observed instance exists at head.
3. **Broken-signature trailing comma and `) : T {` placement.** motoko-core and
   the style guide disagree. If the compiler team's intent is the style guide's,
   this flips.
4. **Trailing `;` in `preserve` after a braced switch arm.** motoko-core keeps
   it, the style guide dropped it in `1d57a4fc`. Confirming that `preserve`
   round-trips motoko-core byte-for-byte is the cheapest check.
5. **One-line switch when it fits.** The style guide prints
   `switch mode { case #up { +1 } case #dn { -1 } }` on one line; it is worth
   checking that the printer's group actually keeps short switches inline rather
   than always breaking after `switch`.
6. **Record-literal inner spacing** (ruling 1). If the tree-sitter corpus's
   no-space form turns out to dominate, this ruling is the one to revisit;
   `bracketSpacing` already makes it a one-line change to the printer.
7. **Blank line inside an empty broken block.** The ported fixture asserts
   `format('{\n\n}')` → `'{\n\n};\n'`, and the two halves of that assertion have
   different statuses — measured (`.probe/_emptyblk.mts`, `.probe/_emptyblk2.mts`):

    - The **blank line holds**: `'{\n\n}'` → `'{\n\n}\n'`. This is `preserve`'s, and
      it is pure whitespace, so `shapeOf` cannot see it either way. A `'{ }'` or a
      `'{\n}'` does collapse to `'{}'`, so the blank line is specifically the thing
      being preserved, not a general "keep the body open" rule.
    - The **trailing `;` is not added**: the fixture's `'{\n\n};\n'` is not what
      `preserve` produces, and it must not be. A separator is a token the guard
      compares, so adding one is a rewrite; the `;` in that fixture is a `moc2`
      cell, as §"Interaction with the ported fixture expectations" already says.
      The ported expectation is therefore an M3 expectation, not an M2 one, and
      the M2 fixture is the blank-line half only.

    The odd part worth a second look is whether an empty block should collapse at
    all, which is the same question as the collapsing `'{ }'` case above and is
    answered by the ported fixture rather than by taste.
