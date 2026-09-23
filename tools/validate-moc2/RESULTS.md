# validate-moc2 — results

Validation harness for the `moc2` rewrite, per `docs/formatter-rework.md` ("Validating `moc2` on the
compiler repo against #6385"). Everything here is runnable; every number below was produced by a
command shown next to it. Where the environment or the spec prevents a check, this file says so
plainly rather than implying the check ran.

(The plan names this file `tools/validate-moc2/report.md`; it is `RESULTS.md` here per the task's
deliverable list. Same content, same role — "attached to the M3 release notes".)

Pinned revisions (an explicit edit in `lib/config.mjs`, per the plan — "re-pinned on purpose, never by
following a branch"):

- **base** `441dd70cd1ab935d0edbb6691fc5a20e6667c13f` (merge base of caffeinelabs/motoko#6385)
- **head** `1d57a4fc7b0f2a28a43cd2fcdc7d0820c21e0986` (its head)

Grammar: `tree-sitter-motoko` **0.2.0**, ABI **15**, 354 node types, loaded via `web-tree-sitter`.

## Headline: `moc2` does not exist yet

The plan's Goal 1 rewrites every unit with `moc2` and demands each level pass on the **output**, and
its Goal 2 compares **our output** with head. Neither is possible today: there is no `moc2`. What is
implemented and run below is the honest projection onto what exists:

- Goal 1 runs with an explicit rewrite function; the only one wired in is the identity, which proves
  the level plumbing runs end to end and cross-checks **our grammar against moc** on every unit.
  Wiring a real `moc2` is a source edit in `lib/goal1.mjs` (`goal1({ rewrite })`), not a flag, so a
  run can never silently claim to have used a rewrite it did not.
- Goal 2 collapses to **base vs head at tree level** — exactly what #6385 changed — plus the
  head-vs-target residue scan. `divergences.json`'s `meta.missingLeg` names the absent third leg and
  what it would take to add it.

## Correction to the task brief: moc **is** available here

The task brief states there is no moc binary and the moc-backed levels cannot run. That is false in
this environment, and the harness does not pretend otherwise. Two working binaries exist:

| name                           | path                                           | version                                          |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------ |
| moc built from the pinned head | `/tmp/moc6385/src/_build/default/exes/moc.exe` | `Motoko compiler (source 1.16.1-26-g1d57a4fc7b)` |
| release beta                   | `/tmp/mocnow/moc`                              | moc 2.0.0-beta.1                                 |

`findMoc()` prefers the source build (the stronger oracle: exactly the frontend #6385 was validated
against). So the diagnostics, parse-tree and typed-tree levels **run for real** below. One caveat
that matters to anyone reading exit codes: a moc built outside the nix-shell wrapper prints
`Environment variable MOC_RELEASE_RTS not set` and exits 1 even on success, so `status === 0` is not a
success signal. The harness judges success by content (a dump was produced / the diagnostic multiset),
and strips the banner — see `normaliseMocOutput` in `lib/moc.mjs`.

## Units

A unit is a `.mo` file or a parseable `motoko` fence in Markdown. `lib/units.mjs`.

The fence regex is **not** anchored at column 0, because #6385's first harness was and so silently
matched none of `style-guide.md`'s fences — dropping the file with the largest diff. The harness
proves this rather than asserting it:

```
node tools/validate-moc2/bin/census.mjs
```

```
over 145 .md files: column-0-anchored found 544 motoko fences, real regex found 652
trap confirmed: 3 file(s) would be dropped by column-0 anchoring
```

The gainers (files the anchored regex would lose fences from):

| file                                          | anchored | real |
| --------------------------------------------- | -------- | ---- |
| `Changelog.md`                                | 0        | 49   |
| `doc/md/fundamentals/types/mutable-arrays.md` | 12       | 14   |
| `doc/md/reference/style-guide.md`             | 0        | 57   |

The census **fails** when no gainer exists, so weakening `FENCE_OPEN` back to column-0 anchoring (or
losing the indented-fence samples) is caught rather than silently accepted.

### Expected unit counts, enforced

`lib/expected-counts.mjs` holds a per-file minimum unit count for both sets (144 oracle files, 1943
full files with units), checked as `observed >= expected` because a regressing extractor can only lose
units. A file named in the expectations but absent from the tree is a hard failure too. Regenerate
deliberately with `census.mjs --write-expected` (verified idempotent: a second write changes nothing).

Both checks pass at base:

```
node tools/validate-moc2/bin/census.mjs            # exit 0
  oracle ok: true
  full   ok: true
```

Adversarially verified (poisoning the expectations, not asserted):

- bumping `doc/md/base-core-migration.md` 20 → 21 ⇒ `ok: false`, `drops [{file, expected 21, observed 20}]`
- naming a nonexistent file ⇒ `ok: false`, `missing [{file, expected 9}]`

## Measured sets at base

| set                                                                                | files | units | parsed | unparseable |
| ---------------------------------------------------------------------------------- | ----- | ----- | ------ | ----------- |
| **oracle** (`doc/md/**`, `doc/overview-slides.md`, `samples/**`, `src/prelude/**`) | 158   | 641   | 545    | 45          |
| **full** (every `.mo` and fence, incl. `test/**`)                                  | 2004  | 2511  | 2371   | 87          |

`src/prelude/*.mo` (4 files) are counted and listed but not scanned: the grammar cannot reach
`@`-privileged names, exactly as the plan says. Recorded with that reason, never dropped quietly.

## Goal 1 status, per level

```
node tools/validate-moc2/bin/goal1.mjs --set oracle          # 641 units, ~78s
node tools/validate-moc2/bin/goal1.mjs --set full            # 2511 units, several minutes
```

Oracle result (identity rewrite, moc present):

```
units: 641 total, 590 processed, 4 skipped
levels:
  parse        542/542
  diagnostics  542/542
  parseTree    542/542
  typedTree    262/262
  idempotence  542/542
  execution    NOT RUN
grammar-vs-moc disagreements: 3
```

Full result (identity rewrite, moc present):

```
units: 2511 total, 2458 processed, 4 skipped
levels:
  parse        2354/2354
  diagnostics  2354/2354
  parseTree    2354/2354
  typedTree    1315/1315
  idempotence  2354/2354
  execution    NOT RUN
grammar-vs-moc disagreements: 18
```

Reading, honestly:

- **parse** — our grammar parses the (identity) output with no `ERROR`. Under the identity this is
  trivially true; it is here as proof the plumbing runs, not as evidence about a rewrite.
- **diagnostics / parseTree / typedTree** — these cross-check **input vs output**, which under the
  identity is the same source, so they are green by construction. Their real value today is the
  _gate_: units that already fail at base are recorded as pre-existing and skipped (48 oracle units:
  45 our grammar rejects at base, 3 moc `-dp` rejects at base), and a unit that changes verdict across
  a real rewrite would be a failure. The identity cannot demonstrate that; a `moc2` can.
- **typedTree** — 280 oracle units do not type-check at base (illustrative doc fragments, `test/fail`
  fences), so the level cannot compare them; recorded as `typedTreeNotRun`, not counted as failures.
- **idempotence** — `rewrite(rewrite(x)) == rewrite(x)`, trivially true for the identity.
- **execution** — **NOT RUN.** It needs a nix shell of the motoko repo plus the `test/run` (309) and
  `test/run-drun` (439) goldens. Neither is available here. `executionLevel()` throws a loud,
  worded error rather than returning a pass; the driver records it as `NOT RUN`. See "What is
  missing".

That the levels are not a stub was verified adversarially, not asserted: `goal1({ rewrite })` was
called with a mutant that drops the head parens of `if (value == 10)` in
`doc/md/fundamentals/basic-syntax/functions.md` (2 units mutated). Four levels caught it —

```
parse 3/5   diagnostics 3/5   parseTree 3/5   typedTree 3/5   idempotence 5/5
  :57 ... our grammar ERROR on rewritten output
  :57 ... codes differ: input {} vs output {"M0275":1}
  :57 ... moc -dp produced no dump for output
  :57 ... moc -dt produced no dump for output
```

— which is the interface a real `moc2` plugs into. (A companion mutant that matched no source text
scored 5/5 everywhere, confirming the harness does not invent failures.)

### The one substantive Goal 1 finding: grammar-vs-moc disagreements

Three oracle units our grammar parses clean but moc rejects (the plan's stated purpose for the moc
oracle: "catches the grammar's deviations"):

| unit                                                      | construct                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `doc/md/fundamentals/implicit-parameters.md:21 (fence)`   | `(implicit : (K, K) -> Order)` — implicit-parameter annotation |
| `doc/md/fundamentals/implicit-parameters.md:209 (fence)`  | same                                                           |
| `doc/md/fundamentals/types/function-types.md:114 (fence)` | `async*` function type / `await*`                              |

Over the **full** set there are 18 disagreements, and they divide cleanly in two:

- **17 grammar-clean / moc-rejects.** The three above plus `src/lang_utils/error_codes/M0158.md` (2
  fences) and twelve `test/fail/*.mo` files (`bad-char-lit*`, `char-high-surrogate`,
  `syntax-reserved-keyword`, `syntax-head-prefix-op`, …). The `test/fail/*` ones are **expected**: those
  files are _deliberately_ invalid, so moc rejecting them is moc being correct and our grammar being
  too lenient — it accepts inputs moc's frontend rejects. That is a real leniency in 0.2.0 worth naming,
  though for `test/fail` it is harmless.
- **1 moc-clean / our-grammar-errors:** `test/perf/qr/list.mo`. Our grammar reports an `ERROR` where
  moc does not — the more concerning direction, since it is a false rejection. Filed under the
  grammar-deviations doc; not fixed here (out of this deliverable's write scope).

## Goal 2: base vs head, three buckets

```
node tools/validate-moc2/bin/compare.mjs           # writes divergences.json
```

```
oracle units: base 641, head 644
matched 511   changed 119   moved 3   shifted 9   unparseable 2
buckets: intended 117  missed 0  extra 2
```

How classification works, stated once so a reviewer can disagree with it (see the module docstring in
`lib/compare.mjs` for the full argument): each changed unit's **node-type histogram delta** is the
edit (leaf nodes keyed `type\0text`, non-leaf keyed `type`), which is robust where a first-divergence
walk is not — a paren removal first shows up as the _enclosing_ node's child-count drop
(`for_exp(7)→for_exp(5)`), not as a node type. The delta names the `par_exp` and its tokens underneath.

- **intended 117** — the edit is the target migration (`par_exp`/`tup_pat`/`(`/`)` falling;
  `block_exp`/`exp_dec`/`{`/`}` rising), or a dropped `;` after a braced arm. 73 entries are
  paren-removal only, 44 also add a braced body, 1 is a separator-only drop. The plan's intended list
  (the style-guide's `// COUNTER EXAMPLES!` block, prose-driven `func` wrappers, `func … = e`) also
  lands here.
- **extra 2** — both in `style-guide.md`, both a whole old example replaced by a new-style one (the
  delta shows a large block of foreign node types: the new example is simply different code). These
  are "we rewrote a site #6385 also rewrote, differently" — a human confirms or reclassifies. Listed,
  not silently dropped.
- **missed 0** — no _edit_ is the migration's reverse. In this base-vs-head direction "missed" means
  the migration was undone, which never happens. The plan's real "missed" is the **head-vs-target**
  direction, reported separately below.
- **shifted 9** — `style-guide.md` gains 3 fences at head (57 → 60), so positionally pairing fence N
  at base with fence N at head would align _different_ fences and manufacture false edits (this was a
  real bug: it produced 12 false `extra` entries before source-pairing was added). Fences that only
  moved lines pair by exact source text; the 9 that pair neither by label nor by source nor
  positionally are listed as `shifted` and **never classified**. A reported gap beats a false edit.
- **unparseable 2** — `style-guide.md:552` and `:791` fences: base has a grammar `ERROR`, head none,
  so the two trees cannot be diffed cleanly.
- **moved 3** — fences that only shifted line numbers, paired by source.

### Head residue: the "missed" in the head-vs-target direction

`headResidue()` scans head with the migration's own rules; a site that survives at head is what the
_hand_ migration left. The plan's zero target.

```
head residue: 190 site(s) over 546 parsed units
  parenthesisedHeads 4        bareBodies 7        bareArmBodies 2
  bracedArmBodies 169        armSeparators 2     armSeparatorsAfterBraced 0
  wholePatternParensSingleCase 4   spacedApplicationOrIndexing 2
```

The 169 `bracedArmBodies` (165 case + 4 catch) are the migration _succeeding_ (a brace added is the
target), not residue.
The genuine leftovers are small and inspectable; examples: `functions.md:57` still has
`if (value == 10) reset()` (parenthesised head + bare body), `modules-imports.md:192` has
`while ((await counterActor.read()) < 10)` (the plan's named `await`-of-comparison exception — a head
that _must_ keep its parens), `style-guide.md:514` is the deliberate `// COUNTER EXAMPLES!` block.

## Residue scan on the full set

The legacy scanner (`lib/residue.mjs`) walks our tree and counts every construct the v2 target
retires. Its non-obvious rule is spaced application/indexing: `f(x)` and `f (x)` fold to the _same_
node, so the distinction survives only in the source gap; the scanner compares the gap text.

| construct                    | oracle | full |
| ---------------------------- | ------ | ---- |
| parenthesisedHeads           | 101    | 962  |
| bareBodies                   | 51     | 450  |
| bareArmBodies                | 41     | 773  |
| bracedArmBodies              | 127    | 1911 |
| armSeparators                | 155    | 2085 |
| armSeparatorsAfterBraced     | 119    | 1404 |
| wholePatternParensSingleCase | 93     | 1211 |
| spacedApplicationOrIndexing  | 2      | 562  |

### Discrepancies against #6385's reported numbers — reported, not faked

The plan quotes #6385 as counting **338 units** in the files it touches, and **549 bare arm bodies /
1249 arm separators** in `test/**` alone. None of the three reproduces under the definitions this
harness uses, and the gaps are not small. Measured hypotheses:

| definition                                           | units   |
| ---------------------------------------------------- | ------- |
| oracle globs @ base (this harness's oracle set)      | **641** |
| oracle globs @ head                                  | 644     |
| `git diff --name-only base head`, `.mo`/`.md` @ head | 376     |
| the same, `∩` oracle globs @ base                    | 371     |
| all `.mo` in the repo @ base                         | 1859    |
| **#6385 reported**                                   | **338** |

| `test/**` scan @ base                    | bareArmBodies | armSeparators |
| ---------------------------------------- | ------------- | ------------- |
| all of `test/**`                         | 729           | 1926          |
| `test/run**` only (the execution corpus) | 492           | 975           |
| all `.mo` under `test/`                  | 729           | 1926          |
| `test/**` excluding `test/fail/`         | 699           | 1820          |
| **#6385 reported**                       | **549**       | **1249**      |

No definition tried lands on 338, 549 or 1249. The most likely explanations, in order of plausibility:
(1) #6385's scanner counted a different construct set — e.g. only `case` arms, not `case`+`catch`;
(2) it counted at a different revision (its own branch tip, not this merge base); (3) it counted
`test/**` with a different file filter. **This harness cannot reconcile them**, so it reports its own
numbers as measured and flags the mismatch as a spec gap for a reviewer to resolve against #6385's
actual harness source. It does not tune its definitions to hit the quoted figures.

## The self-test: the harness proves it can fail

```
node tools/validate-moc2/bin/selftest.mjs      # exit 1 if a level that should catch a plant does not
```

Four planted rewrites, each a level must catch:

```
-- juxt-head     dropping parens of a juxtaposed-application head
   CATCH tree / dp / diagnostics / typedTree
-- await-head    dropping parens of an `await` comparison head
   CATCH tree / dp / diagnostics / typedTree
-- func-eq-body  bracing a `func … = e` body
   CATCH tree / dp / typedTree      MISS diagnostics
-- case-or       unwrapping `case (a or b)`
   CATCH tree / dp / diagnostics / typedTree

caught : juxt-head, await-head, func-eq-body, case-or
missed : (none)      skipped: (none)
```

Notes a reviewer should weigh:

- `func-eq-body` is **not caught by the diagnostics level**: `func f() : Nat = 1` and
  `func f() : Nat { 1 }` type-check identically (both report only `M0194`, an unused-binding warning),
  so `moc --check` legitimately sees no difference. The plant's `expect` is `['tree', 'dp']`, and it is
  caught at both — this is a real, informative limit of the diagnostics level, not a harness hole.
- The bad sides of `juxt-head` and `case-or` are _rejected_ by moc and by our grammar rather than
  silently misparsed (verified: `moc -dp` on `if f x == 0 { 1 }` gives `syntax error [M0001],
unexpected token '}'`). A rewrite that turns clean code into a syntax error is caught by every
  level; the fixtures were also shaped so the _tree_ level sees a difference, so the catch does not
  depend on the rejection alone.

## What is missing, exactly

1. **`moc2` itself.** Every Goal 1/Goal 2 comparison is input-vs-input (identity) or base-vs-head
   today. To close this: implement `moc2`, then call
   `goal1({ rewrite: moc2 })` and add a third tree per unit to `compare.mjs`. The seams are in place.
2. **The execution level.** Needs a nix shell of the motoko repo plus `test/run` (309) and
   `test/run-drun` (439) goldens. `executionLevel()` throws rather than passing; the driver reports
   `NOT RUN`.
3. **The plan's per-site normalisation for the tree levels.** The plan forgives differences _only at
   sites in the rewrite's edit log_ (a `ParP` unwrapped, a single-expression `BlockE` added, a `;`
   dropped). That log belongs to `moc2` and does not exist yet, so `lib/moc.mjs` strips only the
   unstable bits (phase banners, temp paths, the RTS warning) and compares the rest exactly. This is
   stricter than the plan, never looser.
4. **Reconciling the 338 / 549 / 1249 figures** with #6385's actual harness (see above).

## Spec discrepancies to double-check

- `doc/chat.mo` and `doc/schat.mo` were changed by #6385 but fall outside the plan's oracle globs.
  The globs are honoured as written; `config.mjs` records the two out-of-scope files rather than
  widening the set. `doc/schat.mo` also fails to parse under 0.2.0, as the plan predicts.
- The plan says the oracle set is "exactly the files #6385 touches … read at base" AND that #6385
  counted "338 units in the files it touches". Those two cannot both be the 641 units measured here;
  the discrepancy is item 4 above.

## Reproducing everything

```
cd <repo>
node tools/validate-moc2/bin/census.mjs --json              # units, counts, fence-regex trap  (exit 1 on regression)
node tools/validate-moc2/bin/compare.mjs                    # writes divergences.json
node tools/validate-moc2/bin/goal1.mjs --set oracle --json  # Goal 1 levels (needs moc for the moc levels)
node tools/validate-moc2/bin/selftest.mjs                   # four plants; exit 1 on a missed plant
```

`moc` is found automatically (`/tmp/moc6385/...` then `/tmp/mocnow/moc`); override with `MOC` /
`MOC_SOURCE`. The motoko checkout defaults to `../motoko`; override with `MOTOKO_REPO`.
