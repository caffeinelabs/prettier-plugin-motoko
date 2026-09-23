# Grammar deviations: tree-sitter-motoko 0.2.0 vs moc

A catalogue of every place the `tree-sitter-motoko` grammar disagrees with the
Motoko compiler, built empirically. For each entry: the minimal repro, what
tree-sitter does, what moc does **and how that was observed**, the severity for
the formatter, and the rule the printer/rewrite layer must follow because of it.

This document is the input to `printer/adjacency.ts`, `rewrite/moc2/`, and the
grammar-feedback list at the bottom.

## How this was produced

Everything here was executed; nothing is inferred from reading grammar source
unless it says so.

| tool        | what it is                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tree-sitter | the **published** `tree-sitter-motoko@0.2.0` npm artifact, `wasm/tree-sitter-motoko.wasm` (368294 bytes, md5 `f8ed9702baa00ecea26a628032de3ab8`), loaded through `web-tree-sitter` 0.26.13. |
| moc         | `/tmp/moc6385/src/_build/default/exes/moc.exe`, `Motoko compiler (source 1.16.1-26-g1d57a4fc7b)` — built from the PR #6385 head `1d57a4fc7b0f2a28a43cd2fcdc7d0820c21e0986`.                 |

A pre-built moc **does** exist in this environment; it was built for this work
with:

```
git worktree add /tmp/moc6385 1d57a4fc7b0f2a28a43cd2fcdc7d0820c21e0986
nix develop --command bash -c 'cd /tmp/moc6385/src && ./source_id/gen.sh && dune build --profile release exes/moc.exe'
```

`./source_id/gen.sh` is required first — `dune build` alone fails with
`Some modules don't have an implementation ... generated` for `source_id`.
Every "moc" claim below is therefore a **real run**, not a source reading.

Probe scripts (run with `node .probe/<name>.mjs` from the repo root unless noted):

- `deviation-heads-precedence.mjs` — the two control-head cases + 13 precedence cases
- `deviation-adjacency.mjs`, `deviation-adj2.mjs` — whitespace-sensitive token pairs
- `deviation-moc-compare.mjs` — same cases, tree-sitter and moc side by side
- `deviation-constructs.mjs` — `@`-identifiers, shared/composite/query matrix, `doc/schat.mo`
- `deviation-corpus.mjs` — parses every `.mo` file at a rev, reports error nodes
- `deviation-funcfield.mjs` — function fields in records and object types
- `deviation-coalesce2.mjs`, `deviation-inst2.mjs`, `deviation-final.mjs` — the focused cases
- `deviation-stale-wasm.mjs`, `deviation-stale-wasm2.mjs`, `deviation-stale-corpus.mjs` — the stale-wasm question
- `run-moc.sh <label> <src>` — one-off moc invocation

## Summary table

| #   | deviation                                   | ts                          | moc                              | severity                   |
| --- | ------------------------------------------- | --------------------------- | -------------------------------- | -------------------------- |
| 1   | `if g(1) -1 > 0 {}`                         | parses (as `g(1) - 1 > 0`)  | **rejects**                      | **critical**               |
| 2   | `if (c) -h {} else {5}`                     | `bin_exp[(c) - h]` + branch | `CallE(h, {})` negated           | **critical**               |
| 3   | Spaced type application `List <T>`          | **ERROR**                   | accepts                          | **critical**               |
| 4   | Flat operator precedence                    | all one left-assoc level    | real precedence table            | **critical**               |
| 5   | `@`-privileged identifiers                  | **unreachable rule**        | accepts                          | **critical**               |
| 6   | `shared composite func`                     | parses (wrongly)            | **rejects**                      | high                       |
| 7   | `shared query composite func`               | parses (wrongly)            | **rejects**                      | high                       |
| 8   | `??` token eats one trailing space          | token text `"?? "`          | split token                      | high                       |
| 9   | `<` / `>` need whitespace on **both** sides | accepts both readings       | rejects one-sided                | medium                     |
| 10  | `5.toText()` int_literal leaf `"5."`        | different node shape        | `DotE(LitE 5, …)`                | medium                     |
| 11  | `!x` prefix, `x!` postfix                   | **ERROR** / bang exp        | rejects `!x`                     | low                        |
| 12  | Object-type member shapes                   | accepts more than moc       | rejects `shared f :`, `func f :` | low                        |
| 13  | `doc/schat.mo`                              | 8 error nodes               | rejects at the same construct    | n/a (dead file)            |
| 14  | `include I;` sets no `isError`/`isMissing`  | error, but unflagged        | rejects                          | **high** (error reporting) |

---

## 1. `if g(1) -1 > 0 {}` — tree-sitter accepts, moc rejects

**Repro**

```motoko
let g = func (n : Nat) : Int { 1 }; if g(1) -1 > 0 {};
```

**tree-sitter** — parses clean, no error nodes:

```
if_exp["if",
  bin_exp_block[
    bin_exp_block[call_exp_block[g, par_exp[1]], bin_op["-"], 1],
    rel_op[">"], 0],
  block_exp["{", "}"]]
```

**moc** — `moc -dp --check`:

```
t.mo:1.45-1.46: syntax error [M0275], unexpected token '-', expected a block `{ ... }`:
switch and do always take a block, and so do the branches or body of `if`/`while`/`for`
when the condition or head is an unparenthesized compound expression (a call, index,
projection, or operator application); parenthesize it to keep bare branches ...
```

**Why.** moc 2.0's "head mode" (`exp_head` / `exp_head_post` / `exp_bin_asym` in
`src/mo_frontend/parser.mly`) allows exactly **one** operator application in an
unparenthesized head. `g(1) - 1` is that one application, so the head is
_committed_ to a braced branch: the `>` cannot continue the condition, and `-`
cannot appear where a block is required. tree-sitter models this with
`prec.dynamic(1, prec.left(...))` in head mode (`grammar.js:320-329`) plus a
`prec.dynamic` tiebreak (`grammar.js:373`), and those heuristics pick the
operator-chain reading instead. Two independent `bin_exp_block` nodes are
produced where moc permits at most one operator application in the head.

**Formatter rule.** The head of an unparenthesized control expression may carry
at most one operator application, and if it does the branch must be braced. The
printer must never emit a _second_ operator into a head — it must not join two
comparisons into one unparenthesized head, and it must not remove parentheses
that separate them. Concretely: `adjacency.ts` must treat a `bin_exp` inside a
control head as an "at most one operator, else parenthesize" region, and the
`preserve` invariant is what saves us — output must re-parse under moc, so this
tree shape must never be printed back as source.

## 2. `if (c) -h {} else {5}` — both misread it, differently

**Repro**

```motoko
let c = true; let h = 1; if (c) -h {} else {5};
```

**tree-sitter** — parses clean; the condition is a **binary** subtraction, and
the `{}` is a separate branch:

```
bin_exp_block[par_exp[( c )], bin_op["-"], var_exp[h]]
then block_exp["{","}"]  else block_exp["{",5,"}"]
```

**moc** — `moc -dp --check` — parses it, and the tree is completely different:

```
IfE (VarE c)
    (UnE NegOp (CallE _ (VarE h) (ObjE)))     <-- negated CALL of h, with {} as its argument
    (BlockE [5])
```

moc then reports `M0097 expected function type, but expression produces type Nat`
plus `info: this looks like an unintended function call, perhaps a missing ';'?`.
So moc reads `-h {}` as **unary negation applied to a call** whose argument is
the empty object `{}`.

**Why this is worse than the plan says.** `docs/formatter-rework.md` describes
this as a reading of unary vs binary minus. It is not: the two parsers also
disagree about **which construct owns the `{}`** (tree-sitter: `if`'s then-branch;
moc: the argument of the call `h`). A printer that reconstructs `{}` as the
`if` branch, or the reverse, changes the program.

**Formatter rule.** The `-h` / `{` adjacency is not safe to normalise. The
printer must round-trip the `(`/`{` gaps of a bare-branch head exactly as they
were, and this pair must appear in the `preserve` test corpus verbatim. Do not
attempt a rewrite that "fixes" it.

## 3. Spaced type application — tree-sitter ERROR, moc accepts (NEW)

Not in the plan. Found by the corpus scan.

**Repro**

```motoko
let x : List <Nat> = null;
```

**tree-sitter** — ERROR node covering `: List <Nat>`:

```
(source_file
  (let_dec (var_pat (identifier))
    (ERROR (ERROR (identifier)) (typ_params (typ_bind name: (type_identifier))))
    ...))
```

`List <Nat>` is read as the _start of a type-parameter binding_ (`typ_params`) in
declaration position — a parse that cannot complete.

**moc** — accepts it, and `-dp` proves it is a genuine type application:

```
(AnnotE (LitE NullLit) (PathT (IdH (ID List)) (PathT (IdH (ID Nat)))))
```

**Mechanism.** `inst` (`grammar.js:1086-1090`) and `path_typ`
(`grammar.js:1151-1158`) open with `token.immediate("<")`. `token.immediate`
means _must not be preceded by whitespace_, so tree-sitter can only recognise
type application when `<` is glued on the left. moc has no such constraint: its
lexer reclassifies `LT`/`GT` to `LTOP`/`GTOP` only when they are surrounded by
whitespace on **both** sides (`src/mo_frontend/lexer.ml:93-94`), so a
one-sided-spaced `<` stays a plain `LT`, which is exactly what `typ_args` /
`inst` in `parser.mly:480-560` consume. The grammar already knows this: the
`leading-ws-bug` NOTE at `grammar.js:506-514` says the `token.immediate` choice
was forced by tree-sitter issue #4091, upstream in the **generator** — there is
no grammar-level spelling that gets both readings right.

**Blast radius (corpus).** `test/perf/qr/list.mo:87`:

```motoko
func<T>(l : List <T>, i : Nat) : Bool {
```

3 error nodes; moc parses the line (only a missing-import error). Also:

```motoko
func f(l : List <T>) : Bool { true };   -- ERROR
type T = List <Nat>;                     -- ERROR
let x : List <T> = 1;                    -- ERROR
```

while the glued form `List<T>` is fine everywhere.

**Formatter rule.** This is the one deviation the formatter can _fix_ rather
than merely preserve, and it must: when the formatter prints a type application
it must emit it **glued** (`List<Nat>`, `f<T>`), because glued is the only
spelling both parsers accept. Conversely a spaced `List <Nat>` arriving in the
input cannot be formatted at all — it must be an explicit parse failure with a
diagnostic, not a silently-wrong re-emission. `rewrite/moc2/` should own this:
normalise type application to the glued form on output.

## 4. Precedence is flat

**Repro / observation.** `node .probe/deviation-final.mjs`:

| source           | tree-sitter tree       | moc                             |
| ---------------- | ---------------------- | ------------------------------- |
| `1 + 2 * 3`      | `(1 + 2) * 3`          | `1 + (2 * 3)`                   |
| `1 * 2 + 3`      | `(1 * 2) + 3`          | `(1 * 2) + 3`                   |
| `2 - 3 - 4`      | `(2 - 3) - 4`          | `(2 - 3) - 4`                   |
| `a or b and c`   | `(a or b) and c`       | `a or (b and c)`                |
| `1 + 2 == 3 * 4` | `((1 + 2) == 3) * 4`   | `(1 + 2) == (3 * 4)`            |
| `1 % 2 + 3`      | `(1 % 2) + 3`          | `(1 % 2) + 3` — agrees, by luck |
| `1 + 2 ** 3`     | `(1 + 2) ** 3`         | `1 + (2 ** 3)`                  |
| `a ?? b ?? c`    | right-nested (correct) | right-assoc (correct)           |

Every binary and relational operator lands in one `prec.left` level
(`grammar.js:320-334`: `mk_bin_exp` returns `prec.left(seq(left, bin_op|rel_op, right))`
with no per-operator precedence). The grammar's own comment at
`grammar.js:501-502` admits it: _"TODO: Get the precedences for these right (but
only if it doesn't affect the state count too much)"_. The correct table is
moc's, `src/mo_frontend/parser.mly:277-303`:

```
%nonassoc EQOP NEQOP LEOP LTOP GTOP GEOP
%left ADDOP SUBOP WRAPADDOP WRAPSUBOP HASH TIGHT_ADDOP TIGHT_SUBOP TIGHT_HASH
%left MULOP WRAPMULOP DIVOP MODOP
%left OROP
%left ANDOP
%left XOROP TIGHT_XOROP
%nonassoc SHLOP SHROP ROTLOP ROTROP
%left POWOP WRAPPOWOP
```

Note the two rows where the flat grammar's single left-associative level _happens_
to match moc (`1 * 2 + 3`, `2 - 3 - 4`, `1 % 2 + 3`): the coincidence is that
left-associative same-or-tighter binding is right. It is not a sign the grammar
has precedence.

Note `or` binds _tighter_ than `and` in Motoko (opposite of most languages),
which the flat grammar cannot express at all.

**Formatter rule.** The printer may never add, remove, or **re-associate**
parentheses around operators, and it must print a binary chain as a flat
sequence at one indent level so that the wrong tree shape never becomes visible
in the layout. Any rewrite of an operator expression is forbidden. `**` is the
one exception: it is genuinely right-associative in both.

## 5. `@`-privileged identifiers are unreachable

**Repro**

```motoko
let x = @f();
```

**tree-sitter** — 2 ERROR nodes; the `@` is `ERROR (UNEXPECTED 'f')`.

**moc** — accepts `@`-prefixed identifiers throughout the prelude.

**Mechanism.** `privileged_identifier: $ => seq("@", $.identifier)` is
`grammar.js:403` and is the **only** occurrence of that string in the file
(`grep -c` = 1). Nothing references it — not `identifier`, not any expression,
pattern, or type rule. The rule is dead code and the syntax is simply not in
the language the grammar accepts. moc accepts it because `src/prelude/*.mo` is
written in it.

**Affected files** (counts stable across both PR #6385 revs, base
`441dd70cd1a…` and head `1d57a4fc7b0…`):

| file                        | `@` lines | ts error nodes |
| --------------------------- | --------- | -------------- |
| `src/prelude/internals.mo`  | 156       | 444            |
| `src/prelude/prim.mo`       | 17        | 32             |
| `src/prelude/timers-api.mo` | 2         | 4              |
| `test/run-drun/timer.mo`    | 1         | 2              |

Sample forms actually present: `type @Iter<T_> = { next : () -> ?T_ };`,
`var @cycles : Nat = 0;`, `func @add_cycles<system>() { ... }`,
`let int64ToInt = @int64ToInt;`, `debugPrint(@text_of_Nat x)`,
`@timer_helper()`.

**Formatter rule.** The formatter cannot format the compiler's own prelude
until this rule is wired up. Until then, a `.mo` file containing `@` must be a
hard, reported failure — there is no partial-format story, because the
surrounding declaration will have been consumed by an ERROR node. Wiring
`privileged_identifier` into `identifier` (or into the appropriate pattern/typ
alternatives) is the single highest-value upstream fix.

## 6 & 7. `shared composite` / `shared query composite` — the plan's claim is inverted

The task said a scan found `shared composite query func` fails to parse. It does
not. `node .probe/deviation-constructs.mjs`:

| source                                          | tree-sitter                            | moc                 |
| ----------------------------------------------- | -------------------------------------- | ------------------- |
| `shared composite query func f() : async () {}` | **ok**                                 | **ok**              |
| `shared composite func f() : async () {}`       | ok                                     | **FAILS**           |
| `shared query composite func f() : async () {}` | ok (parses `composite` as a `var_pat`) | **FAILS**           |
| `public composite func f() : async () {}`       | ok                                     | FAILS (same reason) |
| `composite func f() : async () {}` (bare)       | ok                                     | **FAILS**           |

moc, for the bare `composite func`:

```
M0001: unexpected token 'func', expected one of token or <phrase> sequence:
  query <pat_opt> func <func_pat> <annot_opt> <func_body>
  query <pat_opt> class <func_pat> <annot_opt> <class_body>
```

i.e. moc demands `query` between `composite` and the declaration. So **every**
spelling of `composite` that the grammar accepts is rejected by moc unless
`query` follows it immediately.

The real deviations are the opposite of the reported one: tree-sitter accepts
`composite` _without_ a following `query`, which moc rejects.

**moc**, for `actor A { shared composite func f() : async () {} };`:

```
unexpected token 'func', expected ... query
```

and for `shared query composite func`:

```
M0274: `composite` is a reserved keyword and cannot be used as an identifier;
choose a different name (e.g. `composite_`)
```

**Mechanism.** `_shared_pat` (`grammar.js:455-468`) is:

```js
_shared_pat: $ => choice(
  seq("shared", optional("composite"), optional("query"), optional(field("shared_pat", $._pat_plain))),
  seq(optional("shared"), optional("composite"), "query", optional(field("shared_pat", $._pat_plain)))
),
```

Both alternatives make `composite` independent of `query`. moc's grammar makes
them a single unit — `parser.mly:440-442`:

```
%inline query:
  | COMPOSITE QUERY { Type.Composite }
  | QUERY           { Type.Query }
```

So `composite` is only legal immediately before `query`. The `_shared_pat` rule
must be respelled so `composite` is only ever reached through the
`COMPOSITE QUERY` unit, and so the bare form is `query` or nothing.

**Formatter rule.** Never emit a bare `composite`. `shared composite query` is
the only composite spelling that survives both parsers, so that is the one the
printer may produce; on input, `shared composite func` is a parse-accepted but
moc-invalid form and must be reported, not reformatted.

## 8. The `??` token swallows one trailing whitespace character

**Repro** — `node .probe/deviation-coalesce2.mjs`:

| source                 | tree-sitter | leaf text     | moc                           |
| ---------------------- | ----------- | ------------- | ----------------------------- |
| `a ?? b`               | ok          | `"?? "`       | ok                            |
| `a?? b`                | ok          | `"?? "`       | ok                            |
| `a ??b`                | ERROR       | `"?" "?" "b"` | FAIL (`unexpected token '?'`) |
| `a??b`                 | ERROR       | `"?" "?" "b"` | FAIL                          |
| `a ??(*c*) 0`          | **ERROR**   | —             | FAIL                          |
| `a ??  0` (two spaces) | ok          | `"?? "`       | ok                            |
| `a ??\n 0`             | ok          | `"??\n"`      | ok                            |

**Mechanism.** `_coalesce_op: $ => alias(token(/\?\?[ \t\r\n]/), "??")`
(`grammar.js:546`) — the token literal is `??` **plus exactly one whitespace
character**, deliberately, to mirror moc's `NULLCOALESCE when not (trailing_ws ())`
split in `src/mo_frontend/lexer.ml:120`. The consequence that matters for a
formatter is the `??(*c*)` row: a comment is not `[ \t\r\n]`, so the token does
not match and the whole operator fails — even though moc's own lexer would also
reject the comment form (so no _meaning_ is lost, only the ability to parse it).

**Formatter rule.** When the printer emits `??` it must guarantee exactly one
whitespace character after it — a single space, or a newline for a broken line —
and must never place a comment directly after the operator. This is a
whitespace rule the emitter has to enforce rather than derive from the tree,
because the whitespace is _inside_ the leaf, so a naive
"print leaves joined by the original gaps" strategy will duplicate or drop it.

## 9. `<` and `>` need whitespace on both sides

`node .probe/deviation-adj2.mjs`:

| source  | tree-sitter       | moc  |
| ------- | ----------------- | ---- |
| `a < b` | ok (`rel_op "<"`) | ok   |
| `a<b`   | ERROR             | FAIL |
| `a <b`  | **ok**            | FAIL |
| `a > b` | ok                | ok   |
| `a>b`   | **ok**            | FAIL |
| `a >b`  | ok                | FAIL |

moc reclassifies `LT`/`GT` to `LTOP`/`GTOP` only when whitespace is present on
**both** sides (`lexer.ml:93-94`); a one-sided-spaced comparison operator is not
a comparison operator to moc at all. tree-sitter is looser: `token.immediate` on
the instantiation `<` means a _glued-left_ `<` is always an instantiation, so
`a<b` is an ERROR, but a spaced-left `<` falls through to `rel_op` and is
accepted even when glued on the right.

**Formatter rule.** The printer must always emit `<` and `>` in relational
position **with spaces on both sides**. It must never produce `a<b`, `a <b`, or
`a>b`, and it must never rely on adjacency to disambiguate comparison from type
application — that decision has to come from the parse tree, not from the gaps.

## 10. Number-dot literals: `5.toText()` produces an `int_literal` of `"5."`

**Repro** — `let r = 5.toText();`

**tree-sitter**:

```
dot_exp_object[lit_exp[int_literal "5."], identifier "toText"]
```

The `int_literal` leaf source text is literally `"5."` — the `_num_dot_lit`
production swallows the dot into the literal.

**moc**: `CallE(DotE(LitE 5, toText))` — the dot is a separate projection.

Same meaning, different node shape. A normaliser that assumes
`int_literal` text is a valid Motoko number literal will emit `5.` on its own or
double the dot.

**Formatter rule.** `int_literal` leaves must be printed **verbatim from the
source text**, never re-rendered from a parsed numeric value, and the printer
must not append a dot when the literal already ends in one. The same hazard
exists for `5 .toText()` (space before the dot), which parses differently.

## 11. `!` — prefix/postfix confusion

- `let r = !x == y;` — tree-sitter **ERROR** (`ERROR` on `!`); moc also rejects
  (`unexpected token '!'`) — `!` is not an operator in Motoko, so
  tree-sitter's failure is _correct_ here and this row is only a note that
  `grammar.js:305` (`mk_bang_exp`: `seq(_exp_post, "!")`) is postfix-only and
  `!=` is a single `rel_op`. No action.
- `^x` (prefix not) — tree-sitter `unop "^"`, moc `NotOp`. Agreement.
- `x!` — postfix, tree-sitter `bang_exp`, moc couple — agreement.

**Formatter rule.** none; recorded so a future reader does not "fix" the `!x`
error away.

## 12. Object-type member shapes

`node .probe/deviation-funcfield.mjs`:

| source                                       | tree-sitter | moc                   |
| -------------------------------------------- | ----------- | --------------------- |
| `{ f = func () : Nat { 1 } }`                | ok          | ok                    |
| `{ f : () -> Nat = func () { 1 } }`          | ok          | ok                    |
| `{ func f() : Nat { 1 } }`                   | ERROR       | FAIL (M0273, correct) |
| `type T = { f : () -> Nat }`                 | ok          | ok                    |
| `type T = { f : () -> Nat; g : Nat }`        | ok          | ok                    |
| `type T = { shared f : () -> async Nat }`    | ok          | **FAILS**             |
| `type T = { f : func () -> Nat }`            | ERROR       | **FAILS**             |
| `type T = { composite f : () -> async Nat }` | ok          | **FAILS** (M0274)     |

The two genuine mismatches: tree-sitter accepts a `shared`/`composite`
qualifier on an object-type field (`{ shared f : … }`) that moc rejects, and
rejects the `func` keyword spelling (`f : func () -> Nat`) that moc also
rejects — so that row is agreement, and only the `shared f :` row is a real
looseness.

**Formatter rule.** Never emit `shared`/`composite` on an object-type field.
Object types get bare fields only. Low severity — no real-world corpus file
uses the accepted-but-invalid shape.

## 13. `doc/schat.mo` fails to parse — but it is dead

**Repro** — `doc/schat.mo` at `1d57a4fc…` (57 lines). `node .probe/deviation-constructs.mjs`:
tree-sitter reports **8 error nodes**, first at line 14:

```motoko
private shared broadcast(message : Text) {
```

**moc FAILS too**, at the same construct:

```
14.27-14.28: syntax error [M0001], unexpected token '(',
expected ... func <func_pat> <annot_opt> <func_body> | class ...
```

Root cause: line 14 is `shared broadcast(message : Text) {` — an unnamed shared
function, i.e. `shared` + a pattern + a body. moc has no such production (a
`shared` declaration must be followed by `func`/`class`), so this is **legacy
doc sample code that no longer compiles**. `doc/md/schat.mo` does not exist at
this rev.

**Formatter rule.** None. Do not special-case it. Record it so a future corpus
sweep does not spend time on it: the file is invalid Motoko under both parsers
for the same reason, and tree-sitter's 8 error nodes are a faithful report.

## 14. `include` — the recovery sets no error flag, and moc agrees on the shape

**Not a deviation in what is accepted**, but a deviation in _how failure is reported_, and the one
place where a mistake here reaches the user as a wrong message rather than a wrong tree.

`include` takes an **expression**, not a bare module name. moc's production is
`INCLUDE x=id system=system_opt e=exp(R, R)`, and the tree-sitter grammar mirrors it
(`include_dec`: `seq("include", $.identifier, optional($.system_exp), $._exp_block)`). So:

| source                     | tree-sitter | moc                                          |
| -------------------------- | ----------- | -------------------------------------------- |
| `include Inner();`         | ok          | ok                                           |
| `include Inner;`           | error       | `unexpected token ';', expected … <exp(ob)>` |
| `include Inner<system>();` | ok          | ok                                           |

Agreement on all three. The problem is the middle row's _tree_:

```
source_file            err=false miss=false hasErr=true  [0,25)
  import               err=false miss=false hasErr=false [0,12)
  ;                    err=false miss=false hasErr=false [12,13)
  include_dec          err=false miss=false hasErr=true  [14,23)  "include I"
    include            err=false miss=false hasErr=false [14,21)
    identifier         err=false miss=false hasErr=false [22,23)  "I"
    lit_exp            err=false miss=false hasErr=true  [23,23)  ""
      float_literal    err=false miss=false hasErr=true  [23,23)  ""
  ;                    err=false miss=false hasErr=false [23,24)
```

The grammar recovers by borrowing the number-literal recovery rule: it inserts a **zero-width**
`lit_exp > float_literal` and sets `hasError` on it. It sets `isError` and `isMissing` **nowhere**.
A walk that looks only for those two flags therefore finds nothing, and `parse.ts` used to fall
through to its "no offending node was found — please report a normaliser bug" guard: a plain typo
reported as a bug in our code.

**Formatter rule.** `findProblem` in `parse.ts` must treat a zero-width non-root branch under a
`hasError` ancestor as the offender, reporting the _enclosing rule_ rather than claiming a missing
token (the rule failed to reach its end; no token was asked for by name). `NormalBranch.hasError`
exists for this. The guard message is now unreachable for every recovery this grammar performs, so
seeing it again means a genuinely new recovery shape — which is the right time to hear about it.

**Fixture note.** `tests/fixtures/objects-and-fields.mo` writes `include Inner();`. The `()` is
load-bearing; omitting it is the invalid form above.

---

## Corpus sweep

`node .probe/deviation-corpus.mjs` at rev `1d57a4fc7b0f2a28a43cd2fcdc7d0820c21e0986`:

```
.mo files: 1859  parsed clean: 1831  failing: 28
```

Of the 28, ~20 are `test/fail/*.mo` — **negative tests**, where an ERROR node is
the correct answer. The non-negative failures, i.e. the real work items:

| file                                 | cause                                   |
| ------------------------------------ | --------------------------------------- |
| `src/prelude/internals.mo` (444 err) | `@`-identifiers — §5                    |
| `src/prelude/prim.mo` (32 err)       | `@`-identifiers — §5                    |
| `src/prelude/timers-api.mo` (4 err)  | `@`-identifiers — §5                    |
| `test/run-drun/timer.mo` (2 err)     | `@timer_helper()` — §5                  |
| `test/perf/qr/list.mo:87` (3 err)    | spaced type application `List <T>` — §3 |
| `doc/schat.mo` (8 err)               | dead/invalid source — §13               |

No other deviation surfaced in the sweep, which is a useful negative result: the
grammar is in good shape on the corpus apart from `@` and spaced type
application.

## The stale-wasm claim does not reproduce

The task warned that the wasm committed in `/Users/kamil.listopad/tree-sitter-motoko`
is stale (pre-PR#25) and "CANNOT parse unparenthesized moc2 heads". The copies
are indeed different binaries — 366521 bytes (checkout) vs 368294 (published),
md5 `3713b504…` vs `f8ed9702…` — but **they parse identically on everything
tried**:

- 19 hand-picked head-mode and deviation cases (`deviation-stale-wasm.mjs`): 0 differing trees.
- The **entire corpus**: 1859 `.mo` files parsed by both (`deviation-stale-corpus.mjs`): **0 differing trees**.
- Both report `abi: 15`, `name: motoko`.

The checkout's own `grammar.js` and `src/parser.c` are **byte-identical** to the
published artifact's (md5 `a2eaf32784e7ee94b3933e652222a336` for both
`parser.c`), so the shipped wasm is a build of the 0.2.0 grammar regardless of
its size. **Conclusion: the claim is unverified / not reproduced.** The probe
tooling here loads the published artifact anyway (`.probe/tree-sitter-motoko.wasm`),
so this does not affect anything above — but a reviewer should not repeat the
warning to other agents without evidence, and if there _is_ a stale wasm
somewhere else, this sweep did not find the input that exposes it.

---

## To file upstream (tree-sitter-motoko)

Each verified here, not copied from the plan.

1. **Wire up `privileged_identifier`.** `grammar.js:403` defines it and nothing
   references it; the compiler's own `src/prelude/internals.mo`, `prim.mo`, and
   `timers-api.mo` cannot parse without it. 444 + 32 + 4 error nodes. Highest value.
2. **Add per-operator precedence.** `grammar.js:501-502` is a standing TODO;
   `mk_bin_exp` (`grammar.js:320-334`) puts every binary and relational operator
   on one `prec.left` level. The table to copy is `parser.mly:277-303` —
   including the surprising `or` > `and`. Needs to be done without exploding the
   state count, hence the TODO's caveat.
3. **Fix `_shared_pat`.** `grammar.js:455-468` lets `composite` stand without
   `query`; moc's `parser.mly:440-442` requires `COMPOSITE QUERY` as a unit. A
   bare `shared composite func` is accepted by the grammar and rejected by moc.
4. **Spaced type application.** `inst` (`grammar.js:1086`) and `path_typ`
   (`grammar.js:1151`) use `token.immediate("<")`, which cannot match `List <T>`
   that moc accepts. Blocked on tree-sitter issue #4091 per the grammar's own
   NOTE at `grammar.js:506-514`; `test/perf/qr/list.mo:87` is a real in-tree
   repro of the gap. Upstream-in-generator, so worth an issue rather than a
   local patch.
5. **Metadata says 0.1.1.** `src/parser.c` sets `.major_version = 0,
.minor_version = 1, .patch_version = 1` in both the checkout and the
   published 0.2.0 artifact (identical files). `tree-sitter.json` correctly says
   `0.2.0`. Regenerating `parser.c` fixes it.
6. **`queries/*` is in `package.json` `files` but no `queries/` directory
   exists** in the published artifact. Either add the directory or drop the glob.
7. **`file-types` is `["motoko"]`, not `["mo"]`.** `tree-sitter.json` does not
   claim the `.mo` extension, so editor/CLI auto-detection misses Motoko files.
8. **`_coalesce_op` includes a whitespace character in the token.**
   `grammar.js:546` is deliberate (it mirrors moc's lexer split) but means
   `a ??(*c*) 0` cannot be lexed — a comment after the operator is the one
   spelling Motoko programmers reach for. Worth knowing whether moc's lexer
   could be matched without consuming the whitespace.
9. **Object-type `shared` fields.** `{ shared f : () -> async Nat }` parses but
   moc rejects it (M0001). Low priority, no corpus impact.

Recorded but **not** upstream-worthy: the `!x` rejection (§11) is correct
behaviour; `doc/schat.mo` (§13) is invalid source, not a grammar bug.
