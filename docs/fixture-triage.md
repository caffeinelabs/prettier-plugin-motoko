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

## What the suite actually is, measured

The counts this file inherited from prose — "68 formatter tests and 34 organize-imports tests", 102
total — are **test functions**, not `format()` calls, and the difference is not cosmetic. Both
suites are tables whose bodies are `async` and whose `format` calls sit _after_ an `await`, so a
naive reading (and a synchronous recorder) sees one call per test and reports 102. Running the
suites' own bodies in registration order gives the real number:

| suite            | test functions | **`format()` calls** |
| ---------------- | -------------- | -------------------- |
| formatter        | 68             | **289**              |
| organize-imports | 34             | **34**               |
| total            | 102            | **323**              |

So the port is 323 cases, not 102. Each case is measured rather than read: `tools/legacy-extract.mjs`
records the `(input, options)` pairs, `tools/legacy-golden.mjs` replays them through a pinned
`prettier-plugin-motoko@0.13.0` for its goldens, and `tools/legacy-port.mjs` writes the ledger
(`.probe/port-ledger.json`) that says, per case, what the new engine emits, whether it is a fixed
point, and how it differs from 0.13.

### The throws are the contract, not regressions

47 of the 323 call the new engine on input it refuses. That reads like a regression and is not one.
`tools/probe/moc-validity.py` replays every input against a real moc 2.0 and judges validity by
`syntax error` in the compiler's output (`moc`'s exit code is 0 for valid and invalid alike):

|                   | moc-valid | moc-invalid |
| ----------------- | --------- | ----------- |
| **throws**        | **0**     | 47          |
| matches 0.13      | 132       | 5           |
| differs from 0.13 | 138       | 1           |

**Zero throws on moc-valid input.** Every input the new parser refuses is one the compiler refuses
too, so refusing with a located `MotokoSyntaxError` is the new strict contract working, not a gap.
The five `moc-invalid` cases that _match_ 0.13 are arm fragments rather than whole programs
(`case (x) [x];`, `case _ (i)`) — incomplete by construction, which is why the compiler rejects them
and why the new engine reproducing 0.13 byte-for-byte on them is fine.

The one `differs` on moc-invalid input is `import with missing semicolon at end`. It is the only case
in the whole port that was ever **not a fixed point**, and the mechanism is worth reading before
anyone touches `readSection`: see
[§ Organize-imports suite](#organize-imports-suite-34-tests-34-format-calls) below.

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

## Formatter suite (68 tests, 289 `format()` calls)

Grouped by the surprise, not by source order — the grouping is what tells a reviewer where to look.

Where the three deliberate decisions above are the _cause_ of a difference, the ledger confirms it;
where they are not, the difference is the interesting part. Of the 116 formatter cases that differ
from 0.13 (37 throw, so 116 of the 252 that run):

- **14** are the semicolon rule alone — normalising `;` before a line end or `}` makes them identical;
- **102** differ in something else, and no single cause dominates: the largest cluster is the
  **null coalesce operator** (18), then spacing around `-` and `+` (8 and 7, the same
  `1-1` / `1 - 1` question), `no delimiter for record extension` (5), `lines before/after group` (5),
  and a long tail of 1–4 case clusters.

The operator clusters are mostly the **`preserve` printer keeping the source's spacing**, which is
its contract: `a  ??  b` stays `a  ??  b` and `1-1` stays `1-1` where 0.13 canonicalised both.

#### The null-coalesce cluster is not a spacing preference — 0.13 emitted invalid Motoko

This was inherited as "the `preserve` printer keeping the source's spacing, which is its contract",
with the 18 `??` cases filed under the same heading as `1-1` / `1 - 1`. Measured, the two clusters are
not the same kind of thing. For all 18, 0.13's output is `a ??b` — the space is dropped **after** the
operator and kept before it.

[adjacency.md](adjacency.md) §2.4 already answers this and the answer was never propagated into this
port's plan. Row **C2** of that table is `a ??b`, its "safe emission" column reads **never**, and its
"required by" column reads `1x`,`2x`,`ts` all SYNTAX; the probe block below the table records the same
thing as `coalesce-trail  SYNTAX SYNTAX SYNTAX`. §2.4's own explanation is that the `??` token is
`alias(token(/\?\?[ \t\r\n]/), "??")` — **the trailing whitespace is part of the token**, so moc 2.0's
lexer splits `??` into two `?` tokens when nothing follows it, which is why C2/C3 are syntax errors
there. Independently re-measured here against the pinned oracle (`/tmp/mocnow/moc`, 2.0.0-beta.1):

| source        | 0.13 emits  | new engine emits | moc 2.0 on 0.13's output                 |
| ------------- | ----------- | ---------------- | ---------------------------------------- |
| `a ?? b`      | `a ??b`     | `a ?? b`         | **`syntax error, unexpected token '?'`** |
| `a ??b`       | `a ??b`     | `a ??b`          | **`syntax error, unexpected token '?'`** |
| `a ?? b ?? c` | `a ??b ??c` | `a ?? b ?? c`    | **`syntax error`**                       |

So `a ??b` is not a differently-canonicalised spelling of `a ?? b`; it is a **parse error**, and §2.4
lists it beside `??`-as-two-options under "must never be split" rather than under any spacing rule. The
consequence for the port: the 18 cases where the new engine differs from 0.13 are cases where the new
engine is **right**, because 0.13 emitted code the compiler cannot read. These are not "expected
`preserve` behaviour" — reproducing `??b` would be a correctness bug, and the fact that the ledger
shows a diff here is the ledger working. So the verdict for the whole cluster is **change, and the
change is a fix**; no per-case reconciliation against adjacency.md is needed, because moc has answered
it and §2.4 had already recorded the answer.

That leaves the genuinely-open part of the cluster much smaller than the raw count suggests. The
remaining differences are the `preserve` contract itself — `a  ??  b` stays double-spaced, which is
_C1_ and is fine — and `-`/`+` spacing, which [adjacency.md](adjacency.md) marks as **not**
free-spaced (§2.9's safe-to-re-lay-out list excludes `-`/`+`/`^` operands; §3.1–3.2 name the
bare-minus seams as grammar deviations). Each of _those_ cases must be cross-checked against
adjacency.md before its verdict, per the "the table wins and the test is a change" rule below.

Checked and closed, so nobody re-derives them: `1-1`, `1 - 1`, `1+1`, `1./+5` and both spellings of
`(m with a = 1; b = 2) actor {}` are **all valid** to moc 2.0 — ordinary arithmetic is not a
correctness risk, and the risk is confined to the head/branch seams adjacency.md names. This must be
measured with the build the oracle pins — `MOC = "/tmp/mocnow/moc"` in `tools/probe/moc-validity.py`,
2.0.0-beta.1 — and **not** one of the 1.16.1 dev builds that litter `/tmp`; they disagree on grammar,
and picking the wrong one has already produced one wrong "correction" to `adjacency.md`.

So "every semicolon test is a change" is right but is **14 cases, not a majority**. The bulk of the
port's work is the operator-spacing tail, and each of those cases needs a verdict from the ledger
rather than from this prose — with the 18 `??` cases now having one.

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

## Organize-imports suite (34 tests, 34 `format()` calls)

This suite survives nearly intact **in behaviour**, because organizing imports is a reimplementation
on `import` nodes and the plan calls it "far simpler than today". The _behaviour_ is the spec; the
_old implementation_ is not.

The ledger needs one caution attached to that word "intact", because it reads misleadingly at a
glance: only **1 of the 24** well-formed cases matches 0.13 byte-for-byte (`preserve code after
imports`). But that is 24 of 24 cases organizing the imports **identically** — the diffs are the
printer, not the pass. Measured: **20 of the 23** differing cases are explained by the semicolon rule
alone (`;` between `}`-terminated items, and no `;` after the last one), and the remaining three are
printer layout (`no imports to organize`, `preserve spacing between imports and code`, and the
missing-semicolon case below). So the import section itself is not what changed — the file around it
is. Compare `basic`: 0.13 emits `…\n\nactor {};\n` and the new engine emits `…\n\nactor {}\n`.

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
location" — which is a _better_ contract and a deliberate change. All eleven are `moc-invalid`, so
the compiler rejects them for the same reason the parser does.

`import with missing semicolon at end` needs care, and the inherited note here ("the grammar requires
`;` between items, so this is a parse error") is **not what happens**. Measured:

```
import Array "mo:base/Array"      <- no `;`
import Text "mo:base/Text";

actor {}
```

moc rejects this (`unexpected token 'import'`), and so does the new parser — but not by throwing.
`import` is an ordinary identifier in expression position, so the second statement is parsed as a
**call expression** `import(Text)("mo:base/Text")`, and the file parses clean. Organize-imports then
read a section one import long, left the rest in the tail, and re-spaced it: a partial rewrite, so
`format(format(x)) != format(x)`. This was the ledger's only `not idempotent` entry, now fixed —
the pass refuses a section containing such a node, and `tests/format/organize-imports/missing-semicolon.mo`
pins the refusal. 0.13 handled it by appending a stray `;` to the trailing `actor {};`.

## Counting the port

Against the 323 measured `format()` calls, the ledger's state **as of the current tree** (regenerate
with `node tools/legacy-port.mjs`; the per-case detail is in `.probe/port-ledger.json`):

| suite            | calls | throws | matches 0.13 | differs | not idempotent |
| ---------------- | ----- | ------ | ------------ | ------- | -------------- |
| formatter        | 289   | 37     | 136          | 116     | 0              |
| organize-imports | 34    | 10     | 1            | 23      | 0              |
| total            | 323   | 47     | 137          | 139     | 0              |

`throws` and `differs` are not verdicts, but they bound them: a `throws` case cannot be a **keep**
(the behaviour it pinned is now a located error), and a `differs` case is either a **change** or a
bug. The prose estimates this section used to carry — "keep ~71, change ~20, delete ~11" against 102
tests — are superseded; the verdicts are now derived per case and recorded in each fixture's header
comment as M2 writes them.

## What is deliberately NOT ported

Both suites that are not ported now sit in `tests/legacy/` (see its `README.md` for why the whole
legacy directory is quarantined there), so these are deletions of files that already exist at the
paths named:

- `tests/legacy/compiler.test.ts` — it reads Motoko test files from `../motoko` and is skipped in
  CI. The new equivalent is the corpus job (`tools/corpus/`), which covers far more. **Delete.**
- `tests/legacy/cli.test.ts` — the old `mo-fmt` CLI is replaced wholesale by M4. **Delete**, and M4
  writes its own.
- `tests/test-webapp/` — the Vite app pinned to the old wasm. Replaced by `.probe/hosts/vite/`.
  **Delete**, but keep the CI intent: the plan requires the web job to _format a snippet in a
  headless browser_, not just build.

### Two cautions on the plan's own wording

The quoted plan is accurate about counts but leaves two things to the reader, and both bite the port:

1. It says fixtures live in "`tests/format/**` and `tests/rewrite/**`". Only `tests/format/` exists
   in this tree, and three different destination names are now in play for the organize cases — the
   plan's `tests/rewrite/**`, `tests/legacy/README.md`'s `tests/format/imports/**`, and the
   `tests/format/organize-imports/` the first ported case already sits in. Take the last one: it is
   what exists, the fixture harness and shared snapshot already key off it, and `tests/format/imports/`
   is _already occupied_ by a different thing — the printer's import-section fixtures
   (`comment-in-section.mo`, `extra-blanks.mo`, `glued-section.mo`, `no-imports.mo`), which exercise
   `print` on an import section, not the `motokoOrganizeImports` pass. Putting the organize ports
   there would collide two unrelated suites in one directory under one snapshot file.
2. The 68/34 test-function counts it quotes are **test functions**, not cases — see
   [§ What the suite actually is, measured](#what-the-suite-actually-is-measured). Port 323 fixtures,
   not 102.
