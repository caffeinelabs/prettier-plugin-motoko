# Fixture triage: porting the 0.13 test suite

The plan requires:

> **Unit fixtures.** `tests/format/**` and `tests/rewrite/**` use Vitest snapshots. Every fixture
> also asserts idempotence. The 68 formatter tests and 34 organize-imports tests from 0.13 are
> ported as fixtures. Each is kept, changed on purpose (with a note), or deleted as a bug.

This file is the triage ledger for that port. It exists because "ported as fixtures" hides a real
question: **most of these tests assert the old engine's output, and the old engine's output is
partly what we are replacing.** Copying them verbatim would enshrine the behaviour M2 exists to
change, and a fixture suite that asserts the wrong thing is worse than no suite — it turns real
regressions into "expected" snapshots.

So every test gets a verdict before it becomes a fixture.

## The three verdicts

| verdict    | meaning                                                                   | when writing the fixture                                                |
| ---------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **keep**   | the test asserts a rule that survives the rework                          | port as-is; it should pass once the printer lands                       |
| **change** | the test asserts something the rework deliberately alters                 | port with the NEW expectation and a comment naming what changed and why |
| **delete** | the test asserts old-engine behaviour that is a bug or is now unreachable | do not port; record why here                                            |

A **change** verdict is not a failure of the old suite. Most of it comes from three deliberate
decisions in [formatter-rework.md](formatter-rework.md):

1. **Semicolons.** The old engine "guesses from line shape, appending `;` to any line that is exactly
   `}`". The new rule is the compiler's style guide: `;` between items always; after the last item
   only when the block breaks over several lines. Every semicolon test is therefore a **change**.
2. **Comments are printed verbatim**, never converted between `//` and `/* */`. The old printer
   converts `//` to `/* */` inside `<…>`. Tests that assert that conversion are **change**.
3. **`.did` is dropped** and Candid is out of scope, so any Candid-shaped test is **delete**.

## Formatter suite (68 tests)

Grouped by the surprise, not by source order — the grouping is what tells a reviewer where to look.

### Semicolons and trailing delimiters — all **change**

`automatic semicolons`, `automatic semicolons with line comment`, `automatic semicolons with block
comment`, `automatic semicolons with multi-line text`, `no automatic semicolons before \`else\`,
\`catch\`, etc.`, `add trailing delimiters`, `remove trailing delimiters`, `trailing semicolon after
block comment`, `trailing comma in square brackets`.

These encode line-shape guessing. Each must be re-derived from the `ifBreak(";")` rule and the
decision table in [style.md](style.md). Expect several of them to be _simplified_: the new rule is
state-free, so tests that exist only to pin one line-shape heuristic should collapse into one
"broken block gets a trailing `;`" fixture per construct.

A fixture whose name is `automatic semicolons` and whose body is a hand-enumerated table of
line-shapes should be deleted and replaced, not ported — the table is the old algorithm.

### Comments — mostly **change**

`line comments`, `block comments`, `line comment in single line`, `prettier-ignore line comment as
first line in block`, `unclosed quotes in comments`, `prettier-ignore`.

Assert the verbatim rule. The old outputs show the `//` → `/* */` conversion inside `<…>`; those
expectations are wrong now. `prettier-ignore` itself is a **keep** — it is a real feature and the new
printer must honour it.

### Whitespace adjacency and operators — **keep** (these are the safety core)

`unary operators`, `unary / binary operators`, `multiplication and division spacing`, `addition vs.
positive number`, `subtraction vs. negative number`, `logical operators`, `null coalesce operator`,
`dot after group`, `array indexing line break`, `tuple indices`, `variants / text concatenation`,
`optional variants`, `\`with\` keyword`, `parenthesized \`with\` expression prefixes`.

These are the tests that matter most, because they are the ones whose failure means _wrong code_ and
not just ugly code. They must be cross-checked against [adjacency.md](adjacency.md) rather than
trusted as-is: the old engine may have passed them by accident. Where the adjacency table and the
old expectation disagree, the table wins and the test is a **change**.

### Layout — **keep**, but beware

`extra whitespace`, `empty block`, `extra newlines`, `group spacing`, `nested group line breaks`,
`tuple line breaks`, `type binding line breaks`, `anonymous function line break`, `bracket spacing`,
`lines before/after group`, `double newline after import section`, `if-else wrapping`.

These are the "at most one blank line kept, none invented" rules. Mostly keep. `empty block` is a
**change**: the old expectation is `{\n\n}` (a blank line inside an empty block) and the new
formatter should not invent a blank line there.

### Construct coverage — **keep**

`if-else wrapping`, `type bindings`, `anonymous functions`, `do ? / optional`, `async*`, `await*`,
`shared and query keywords`, `function in type bindings`, `case with array value`, `wildcard
identifier`, `identifier tokens`, `tuple line breaks`.

Port as-is; if the printer cannot reproduce them, that is a genuine M2 bug and exactly what the
suite is for.

### Literals printed verbatim — **keep**

`exponential notation`, `hexadecimal notation`, `scientific notation literals`, `quote literals`,
`multi-line text`, `emoji in import statement`, `invisible unicode characters`, `@ symbol`.

Note `@ symbol` and `invisible unicode characters` are load-bearing in a way the old suite did not
know: `@` is the `privileged_identifier` grammar gap (see
[grammar-deviations.md](grammar-deviations.md)), and zero-width characters are stripped by
`src/utils/removeZeroWidthCharacters`. Keep both, and make the `@` fixture document that the case
currently cannot parse.

### `no delimiter for record extension` — **keep**

Record extension is valid on moc 2.0 and has no delimiter. Port as-is.

### Misc — **keep**

`empty`, `trailing newline`, `already formatted`, `block with existing newline`, `conditional
parentheses`.

`conditional parentheses` is the highest-value test in the whole suite after the adjacency group: it
is the paren rule, and the plan's flat-precedence finding ("the printer may never add or remove
parens around operators") means it must be rewritten around the _whole_ flat chain, not around
per-operator precedence. **Change.**

## Organize-imports suite (34 tests)

This suite survives nearly intact, because organizing imports is a reimplementation on `import`
nodes and the plan calls it "far simpler than today". The _behaviour_ is the spec; the _old
implementation_ is not.

- **keep** — all of: `basic`, `group imports by prefix`, `combine imports from same path`, `sort
destructured fields`, `handle aliased imports`, `preserve code after imports`, `no imports to
organize`, `disabled by default`, `ic: prefix imports`, `empty destructured imports`, `trailing
comma in destructured imports`, `imports with inline comments`, `imports with block comments`,
  `comments between imports are preserved`, `imports with excessive whitespace`, `whitespace in
destructured imports`, `single item destructured import`, `imports with newlines between them`,
  `combine multiple destructured imports with existing named import`, `complex aliased imports with
sorting`, `mixed aliased and non-aliased destructured imports`, `imports with all prefix types
mixed`, `preserve spacing between imports and code`.

That is the whole suite except the malformed-input group. Organize-imports is opt-in
(`motokoOrganizeImports`, default false), so it cannot cause a wrong-code regression on its own, and
its tests are pure input/output pairs that port cleanly to fixtures.

- **keep, but re-derive** — the malformed group: `malformed import - missing path`, `malformed import
    - missing quotes`, `partially written import`, `incomplete destructured import`, `import with
      missing semicolon at end`, `destructured import with unclosed brace`, `import with invalid path
      format`, `import with syntax error in destructuring`, `import keyword only`, `import with
      incomplete alias`, `mixed valid and malformed imports`.

These assert that malformed imports are handled without crashing. On the new engine a malformed
import is a **parse error**, so most of these become "the format call throws a `SyntaxError` with a
location" — which is a _better_ contract and a deliberate change. One of them
(`import with missing semicolon at end`) needs care: the grammar requires `;` between items, so this
is a parse error, not an organize-imports concern.

## The refusals, measured

Replaying the suite through the current plugin (`.probe/_legacyreplay.mts`) splits the 267 extracted
assertions into **140 PASS, 87 DIFF, 34 THROWS, 6 COMPUTED** (the last are built by JS
interpolation — `${'x'.repeat(80)}` — so the regex reader recovers the template's characters, not the
string; they must be re-derived by hand as fixtures).

The 34 refusals are the pile that matters, because a refusal is either a real gap or an input that
was never Motoko. Each input was written to a file **exactly as the legacy test spelled it** and
handed to `moc 1.16.1` and `moc 2.0.0-beta.1` (`-dp`; a dumped `(Prog` tree is the positive signal,
and a bare expression is a valid program — `1 + 1` and `abc` both parse).

**All 34 are rejected by both compilers. Zero are valid Motoko.** Our own parser refuses all 34 too,
so the parser and moc agree on every one; there is no parser gap hiding in this pile.

Two consequences:

- **They are `delete`, not `change`.** The old engine accepted them because it shaped lines rather
  than parsing — `replace delimiters` asserts `format('(a;b;c)') === '(a, b, c)\n'`, i.e. it read a
  semicolon-separated tuple and repaired it to a comma-separated one. That is the old algorithm, and
  there is no new expectation to port: the input is a syntax error under the new engine, which is
  the correct contract.
- **Several entries above are marked `keep` as _constructs_, and that verdict stands** — but the
  legacy _spellings_ for some of them are not valid programs on their own, so a fixture must be
  written at the construct's real spelling. `async*` is `func f() : async* T { ... }` and `await*` is
  `await* t`, never the bare `async * T` the legacy test passed; `(a, b, c)` and `{a; b; c}` are
  valid where `(a;b;c)` and `{a,b,c}` are not; `#a` and `"A" # b` are valid where `# "A"`, `# 5` and
  `.1e1` are not; `x : [{ abc : Nat }] = 1;` is valid where `x : [{ abc; }] = 1;` is not. The `keep`
  verdicts describe the construct; the fixture header must carry the spelling that actually parses.

One entry needs a doc-level correction rather than a fixture. §5 of
[grammar-deviations.md](grammar-deviations.md) records that `@`-identifiers are unreachable and the
formatter rule is "a `.mo` file containing `@` must be a hard, reported failure" — correct, and
because moc also rejects a bare `@abc` in a file, this pile adds nothing to it. It does mean the
`@ symbol` fixture is not the "keep, and document that the case currently cannot parse" the section
above implies: it is a `delete`, and §5's rule already carries the intent.

## Counting the port

Against the 102 tests:

- **keep**: ~71
- **change**: ~20
- **delete**: ~11 (the malformed-import crash-tolerance group, and any test whose only content is
  the old semicolon line-shape table)

Those numbers were written before the printer existed, so they could not distinguish "this case
asserts a rule that survives" from "this case asserts a rule the `preserve` printer _cannot_
implement". The replay (§"The refusals, measured") supplies that distinction, and it moves the count:
of the 267 extracted assertions, **140 already print to their legacy expectation**, so the fixture is
a near-copy of a case that passes today rather than a case to re-derive.

The other 87 DIFFs are not 87 bugs. [style.md](style.md) rules on the largest group directly — its
§"Interaction with the ported fixture expectations" states that the legacy expectations are the
**`moc2`** behaviour and "are the specification for M3 rather than a gate on this printer", and its
§"Read this table as the `moc2` target" gives the reason: the guard compares the printed token stream
against the input tree, and **a separator is a token**, so `preserve` cannot implement any
`ifBreak`/`semi`/`trailingComma` cell. A DIFF whose content is a separator the legacy expectation adds
or removes is therefore **`change` by construction, with the copy being the source's own** — not a
defect to fix.

That is the test a reviewer should apply to each remaining DIFF in turn:

- the difference is a **separator** the printer added or removed → **change**, spec'd by style.md;
- the difference is **whitespace or layout** inside the printer's remit → check
  [adjacency.md](adjacency.md) first, because there the adjacency table wins over the old expectation;
- the difference is a **layout choice** (`ifBreak`, break direction, blank lines) → the relevant
  style.md section is authoritative and the legacy expectation is the `moc2` target.

A **fixture is an input, and its snapshot records the printer's output**
(`tests/format.test.ts`). So a case whose output is _wrong_ must not be ported at all: snapshotting it
would enshrine the bug. The port criterion is therefore not "this case passes" but "this case's
**output** is what the spec asks for" — the two coincide for the 140 PASSes and have to be checked one
by one for the rest.

These numbers remain an estimate to be corrected as fixtures are written; the exact per-test verdict
is recorded in each fixture's header comment, and this file is updated to match.

## What is deliberately NOT ported

- `tests/compiler.test.ts` — it reads Motoko test files from `../motoko` and is skipped in CI. The
  new equivalent is the corpus job (`tools/corpus/`), which covers far more. **Delete.**
- `tests/cli.test.ts` — the old `mo-fmt` CLI is replaced wholesale by M4. **Delete**, and M4 writes
  its own.
- `tests/test-webapp/` — the Vite app pinned to the old wasm. Replaced by `.probe/hosts/vite/`.
  **Delete**, but keep the CI intent: the plan requires the web job to _format a snippet in a
  headless browser_, not just build.
