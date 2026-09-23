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

## Counting the port

Against the 102 tests:

- **keep**: ~71
- **change**: ~20
- **delete**: ~11 (the malformed-import crash-tolerance group, and any test whose only content is
  the old semicolon line-shape table)

These numbers are an estimate to be corrected as fixtures are written; they are stated so a reviewer
can check the shape of the port rather than trusting a bare "ported" claim. The exact per-test
verdict is recorded in each fixture's header comment when M2 writes them, and this file is updated
to match.

## What is deliberately NOT ported

- `tests/compiler.test.ts` — it reads Motoko test files from `../motoko` and is skipped in CI. The
  new equivalent is the corpus job (`tools/corpus/`), which covers far more. **Delete.**
- `tests/cli.test.ts` — the old `mo-fmt` CLI is replaced wholesale by M4. **Delete**, and M4 writes
  its own.
- `tests/test-webapp/` — the Vite app pinned to the old wasm. Replaced by `.probe/hosts/vite/`.
  **Delete**, but keep the CI intent: the plan requires the web job to _format a snippet in a
  headless browser_, not just build.
