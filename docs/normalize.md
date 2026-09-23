# The normaliser: CST → `NormalNode`

Specification for `src/parser/normalize.ts`. It is the module that turns a `web-tree-sitter` tree
into plain objects we own. The sibling implementations are already in the tree —
[`src/parser/normalize.ts`](../src/parser/normalize.ts) is the code this document describes, and
[`src/parser/parse.ts`](../src/parser/parse.ts) is its only caller. This file is the contract, that
file is the implementation; where they disagree, one of them is a bug. The empirical claims below
are the ones a later edit must not break, and each carries the command that checks it
([`.probe/normalize-check.mjs`](../.probe/normalize-check.mjs)).

## 1. Why plain objects

The plan's M1 architecture ([m1-architecture.md](m1-architecture.md)) fixes this: the normaliser
exists because tree-sitter `Node` values are views into wasm memory owned by a `Tree`.

1. **Lifetime.** A `Node` is garbage the moment its `Tree` is deleted. `parse.ts` deletes the tree
   in a `finally`; `verify.ts` holds the _input_ shape after the printer has run and the `moc2`
   rewrite builds new shapes. Neither can hold a wasm handle. Plain objects make both possible
   without lifetime discipline.
2. **The token round-trip.** Re-concatenating every token plus the gaps between them must reproduce
   the input exactly ([formatter-rework.md](formatter-rework.md) line 149, "token round-trip:
   re-concatenating tokens and gaps reproduces the input"). That check needs tokens as first-class
   children **with offsets**, and it needs the _whitespace between them_ to be representable. A
   `Node` list cannot hold a gap; a plain object tree can.

The round-trip is the single check that proves the normaliser lost nothing, and "lost nothing" is
the precondition for trusting the printer's output to be a function of the whole input. Everything
below is arranged so that check holds for every input the grammar accepts.

## 2. The node shape

```
NormalToken  = { nodeType:'Token',  type, named, extra, error, missing, text, ...span }
NormalBranch = { nodeType:'Branch', type, kind, mode, named, extra, field,
                 children, fields, set, collapsed, error, missing, text, ...span }
NormalText   = { nodeType:'Text',   text, position, adjust, ...span }   // a gap, whitespace only
span         = { startIndex, endIndex, startPosition, endPosition }
point        = { row, column }                                          // row 0-based
```

- `type` — the name tree-sitter reports, **alias and all** (`call_exp_object`). This is what a
  diagnostic names.
- `kind` — `type` with the mode suffix stripped (`call_exp`). Keyed into the generated `NODE_KINDS`,
  so a printer `switch` on `kind` is exhaustive over the grammar. See §4.
- `mode` — `'block' | 'object' | null`; which suffix family `type` came from. See §4.
- `field` — the field name this node occupies in its parent, or `null`. Read from
  `node.fieldNameForChild(i)` where `i` indexes `node.children` (**anonymous tokens included**; the
  loop counter is exactly that index — do not index by named-child position).
- `children` — source-order children, tokens included, plus the `Text` gaps.
- `fields` / `set` — `field` above covers the common case. `fields` is reserved for the corpora that
  carry explicit fields on the node itself; `set` records fields that were _present but `null`_, so
  a shape comparison can tell "absent" from "explicitly null" exactly as tree-sitter does.
- `collapsed` — reserved for M2 comment attachment, always `false` at M1.
- `error` / `missing` — copied straight off the wasm node (`isError` / `isMissing`). `parse.ts` reads
  them rather than re-deriving them; §6 says why.
- `text` — for a `Token`, sliced from source. For a `Branch`, the concatenation of its children's
  text (and the corpus harness asserts that equals `src.slice(startIndex, endIndex)`).
- `startIndex` / `endIndex` — **UTF-16 code-unit** offsets into the source string, which is exactly
  `String.prototype.slice`'s addressing. Verified with non-ASCII input (§8.3).

### 2.1 Offsets are UTF-16 code units, not bytes

`web-tree-sitter` reports `startIndex`/`endIndex` as indices into the JS string it parsed. So
`s.slice(n.startIndex, n.endIndex)` is exact for any input, including astral characters. `column`
counts characters likewise (it is not a byte offset). Every text slice in this codebase therefore
uses the indices directly against the original string; there is no byte↔char conversion anywhere,
and the corpus round-trip is what proves the convention.

Verified (`normalize-check.mjs`, §8.3): `let é = "a😀b"; // é😀` yields leaves whose offsets tile
0…22 exactly, with `startPosition.column` matching the character column (`text_literal` at byte
offset 9 is at `column 8`).

### 2.2 The root is widened to the whole input

tree-sitter's `source_file` starts at its first token and ends at its last, so a file's leading
blank lines and its final newline lie **outside** the node's own span. But `root.text` must equal
`source` for the round-trip, and Prettier's `locStart`/`locEnd` must be able to address every
character. So `normalize(root, source)` passes an explicit `bounds = {0, source.length}` and the
root's span, `startPosition` and `endPosition` are recomputed from the source (`{0,0}` and the
position just past the last character; a `\r\n` pair counts as one line break). The uncovered head
and tail are whitespace by construction — anything else is an error tree and is rejected in §6
before the printer ever sees it.

## 3. Tokens stay as children

Three facts force it.

1. The round-trip needs them (§1).
2. Comments are `extras` and can appear **anywhere** — inside a call, between the callee and its
   `(`. If tokens were dropped and comments hoisted to a separate list keyed by position, the
   printer's adjacency logic (`printer/adjacency.ts`) would have to reconstruct what the tree
   already knows. Keeping them in place means "what is immediately before this token" is a tree
   question, not a text question.
3. `comment_text` cannot be reconstructed from its children at all (§5), so its `text` must be
   sliced from source; the round-trip is what forces the leaf rule to say so out loud.

### 3.1 The gap invariant

Children are emitted with the whitespace between them interleaved as `Text` nodes. There are exactly
three gap sites — the head gap (before the first child), the between-children gaps, and the tail gap
(after the last child) — and one code path emits all three, because writing them separately is
three ways to silently lose text.

**Invariant.** Every gap's text is whitespace only. Comments are never in a gap: they are tree
children, and the loop visits them in source order, so the only thing that can separate two children
is whitespace. A non-whitespace gap means a token exists in the source that the tree does not report
as a child, which would make the round-trip lossy — so the normaliser **throws** rather than
ignoring it:

```
normalize: unexpected non-whitespace between nodes at [start,end):
"…". A token that is not a child of the tree would make the round-trip lossy,
so this is fatal rather than ignored.
```

Verified corpus-wide: **0** non-whitespace gaps in opaque-comment mode over 1859 files (§8.1). The
throw has never fired; it exists so that a future grammar bump that hides a token fails loudly at
the first file instead of silently corrupting every file after it.

## 4. Mode: what `_block` / `_object` / head really mean

### 4.1 Why the grammar has modes at all

`grammar.js` (`NOTE(def: object-vs-block-expression)`) parameterises every expression production by
`b ∈ {block, object, head}`:

- **object** — ordinary expression position. Record literals `{ x = 1 }` are allowed.
- **block** — a position where a bare `{` must open a _block_: the body of a function, an `ignore`,
  a `return`, and so on.
- **head** — added later (`NOTE(def: head-mode)`): the condition of `if`/`while`, the scrutinee of
  `switch`, the collection of `for`, **when written without parentheses**. Head mode is block mode
  plus two restrictions that make the `{` after the head always open the body: no record literal can
  appear anywhere in the head, and a call or index only continues the head when its `(`/`[` is
  _glued_ to what precedes it (`token.immediate`). A spaced `(`/`[` starts the legacy bare branch
  instead, exactly as the compiler's lexer reads it.

tree-sitter, unlike Menhir, cannot parameterise this, so the grammar templates it by hand: `head`
copies of the productions are registered as `<name>_head` and then **aliased** back to a visible
name. Two helpers do it:

```js
function mode_rule($, name, b) {
    return b == 'head'
        ? alias($[`${name}_head`], $[`${name}_block`])
        : $[`${name}_${b}`];
}
function head_alias($, name, b) {
    return b == 'head' ? alias($[`${name}_head`], $[name]) : $[name];
}
```

So head-mode nodes are **not a new node kind**. The plan (line 30): "Head-mode nodes are aliased
with a `_block`/`_object` suffix (`call_exp_block`, …). The normaliser strips the suffix into a
`mode` flag."

### 4.2 The naive rule, and why it is not enough

The obvious rule — "`mode` is which `_block`/`_object` suffix the visible `type` carries" — is
**wrong for head mode**, and wrong in a way that matters, because head vs block is exactly the
distinction that decides whether a `{` opens a body or a record. Two nodes with identical visible
type can differ:

```
if f (1) { }        call_exp_block ── its par_exp is the *body-adjacent* branch, `f` is the head atom
if f(1) { }         call_exp_block ── the call IS the head, `(1)` continues it
```

Both print `call_exp_block`; both have `typeId === 258`. They are different grammar symbols
(258 vs 275) and different parses. A printer that treated block mode as "ordinary expression" would
print `if f(1)` as `if f(1)` and, on the day the _body_ starts with a record, quietly change the
parse.

### 4.3 The rule that works: `grammarId`

tree-sitter exposes both the **visible** symbol id (`typeId`, what `node-type` reports) and the
**grammar** symbol id (`grammarId`, the id of the rule that actually produced the node, alias
applied to neither). For an aliased head-mode node the two differ; for everything else they are
equal.

```
isHead(node)  ⟺  HEAD_SYMBOL_IDS.has(node.grammarId)
```

where the set is the 20 head-mode symbol ids. They are not reachable by name — `nodeTypeForId(275)`
returns `call_exp_block`, the same name as 258, and `idForNodeType('call_exp_block', true)` always
returns **258**, the block-mode id. That asymmetry is what makes `grammarId` the discriminator.

```
HEAD_SYMBOL_IDS = {
  191 par_exp,              193 hash_exp,        194 quest_exp,
  195 unop_exp,             196 unassign_exp,    197 not_exp,
  198 debug_show_exp,       199 from_candid_exp, 200 await_exp,
  201 awaitstar_exp,        202 awaitquest_exp,
  272 array_idx_exp_block,  273 proj_exp_block,  274 dot_exp_block,
  275 call_exp_block,       276 bang_exp_block,  277 system_exp_block,
  278 bin_exp_block,        279 annot_exp_block, 280 coalesce_exp_block,
}
```

These are the ids of the `<name>_head` rules' aliases, enumerated with
`Language.nodeTypeForId(i)` for `i` in 1…360. The neighbouring ids are the un-aliased head rule
ids `185 _exp_nullary_head … 190 _head`, which never appear as a `Node` (they are hidden).

Derived:

```
mode = isHead(node) ? 'block'                       // head mode is printed as block mode
     : type.endsWith('_object') ? 'object'
     : type.endsWith('_block')  ? 'block'
     : null
```

Note the deliberate asymmetry: **head mode gets `mode: 'block'`**, because head mode _is_ block mode
for a printer's purposes (§4.1) — the two restrictions are layout restrictions, and
`printer/adjacency.ts` is where they are enforced. `_object` is the only mode that changes how a
printer treats the node.

### 4.4 The alternate rule is NOT equivalent — do not use it

An earlier candidate was `isHead ⟺ grammarId !== idForNodeType(type, isNamed)`. It is wrong in both
directions and the corpus shows it (`.probe/normalize-check.mjs` reports 12 nodes where the two
rules disagree):

- **False positives** — nodes whose `grammarId ≠ canonical` for a reason unrelated to head mode:
  `dot_exp_block` with `grammarId 208` (the `_num_dot_exp` alias, `42.toText`), because `typeId` and
  `canon` agree at 256. In a block-mode context `ignore 5.toText();` — no head anywhere — the inner
  `dot_exp_block` still has `grammarId 208`. The alternate rule calls it a head; it is not.
- **False negatives** — head-mode nodes whose `grammarId` happens to equal the canonical id, so the
  alternate rule misses them: `par_exp` with `grammarId 191` (it is 210's head variant) sits inside
  a head, and `not_exp` with `grammarId 197`.

Using the alternate rule would put `mode` in the wrong state on 12 nodes out of 437 318 across the
corpus, and on the _first_ `.` after a number in any file. `HEAD_SYMBOL_IDS` has 0 unexplained nodes
and 0 objects/blocks misclassified (§8.2).

### 4.5 Stripping the suffix

`modeOf(type)` walks `['_block', '_object']`; on a match it strips the suffix and, if the remainder
is a key of `NODE_KINDS`, returns it as `kind` with the suffix (minus underscore) as `mode`. A type
with no recognized suffix that is a known kind returns `mode: null`. An _unknown_ type is returned
as its own `kind` with `mode: null`: a grammar bump that adds a kind the generated types have not
seen must not crash the normaliser — the printer's exhaustive switch is what is supposed to fail,
and it will, at compile time, which is the whole point of generating `NODE_KINDS`.

Exactly **22** kinds carry a `_block`/`_object` suffix, from `node-types.json`:

```
annot_exp        array_idx_exp     assign_exp       bang_exp
bin_exp          binassign_exp     call_exp         coalesce_exp
dot_exp          proj_exp          system_exp
```

(each with `_block` and `_object`). No kind collides after stripping: `annot_exp_block` and
`annot_exp_object` both strip to `annot_exp`, which is the single `NODE_KINDS` entry with
`modes: ['block', 'object']`. That 22-entry list is what `tools/gen-node-types.ts` reads to fill
`aliases`/`modes`, and `normalize-check.mjs` asserts the suffix set matches it.

## 5. Comments

Comments are `extras`. tree-sitter's `extras` may appear **between any two tokens**, including
between a callee and its `(` — and they stay in position in the CST.

```
let r = f // why
  (x);
```

```
call_exp_object "f // why\n  (x)"
  var_exp "f"
    identifier "f"
  line_comment "// why"          ← an extra, between the callee and the par_exp
  par_exp "(x)"
    ...
```

Verified this session on real files: `test/fail/inference.mo` has `n/*<T>*/(f,z)` as a
`call_exp_object` whose children are `[var_exp, block_comment, par_exp]`, and
`test/run-drun/scope-example.mo` has `ping/*<Y>*/ ()` likewise. The _design_ consequence is §3
point 2: comments are ordinary children in source order, not a side list, and `normalize.ts` does
**not** strip them. Prettier's comment attachment (M2, `src/comments/`) decides what to do with them
for printing.

### 5.1 `block_comment` nests

`grammar.js` has `block_comment: seq("/*", $._comment_text, "*/")` with
`comment_text: repeat1(token(prec(1, /.|\n|\r/)))`. A `/* … */` inside a block comment is a real
nested `block_comment` node, and it lands **inside the outer `comment_text`**:

```
block_comment [1499,1846)
  "/*"        [1499,1501)
  comment_text[1501,1842)   ← contains another block_comment at [1813,1839)
  "*/"        [1844,1846)
```

(`test/run-drun/await-sugar.mo`, the corpus's one genuinely nested block comment.)

### 5.2 The leaf rule: `comment_text` is a leaf

`comment_text`'s children are **per-character** tokens, and they are not all reported: the tree
gives `comment_text` one child per character _for some characters_ but the node's span is not the
union of its children's spans. Reconstructing `comment_text`'s text by joining children is therefore
impossible; slicing it from source at `[startIndex, endIndex)` is exact. The normaliser treats it as
a **leaf**:

```ts
const SOURCE_TEXT_KINDS = new Set(['comment_text']);
// a node is a token if  node.childCount === 0  ||  SOURCE_TEXT_KINDS.has(node.type)
```

Two consequences, both deliberate:

1. A nested `block_comment` inside a `comment_text` is **not a node** in our tree; it is characters
   inside the outer `comment_text`'s text. Nothing a printer needs is lost: Prettier emits comment
   text verbatim, so the inner comment's text is preserved as a substring. (If a later milestone
   wants to attach the inner comment separately, that is an M2 decision; M1 does not.)
2. The parser's `text` for a comment is always a **source slice**, never a join. This is the
   general rule: `node.text` is never used; text always comes from `src.toString(startIndex,
endIndex)`.

### 5.3 The comment-extraction invariant

Stated as the check that `normalize-check.mjs` runs:

> Let `L` be the set obtained by descending the tree from the root and stopping at every node with
> `childCount === 0` **or** a `/_comment$/` type. Sort `L` by `startIndex`. Then, walking `L` and
> skipping any leaf whose `startIndex` is _before_ the running cursor, concatenating
> `src.slice(cursor, leaf.start) + src.slice(leaf.start, leaf.end)` and finally `src.slice(cursor)`
> reproduces the source exactly.

The cursor skip is what makes the invariant hold in both modes. In **opaque** mode the leaves
**tile** the source with no skip needed at all — the nested `block_comment` is not a leaf, so
nothing overlaps. In **descend** mode the outer `comment_text` contributes a leaf that _stops_ at
its child (`comment_text`'s span [1501,1842) is followed by the nested `block_comment` at
[1813,1839)), so the walk would skip over the intervening text and leave a non-whitespace gap.

**Measured (§8.1): opaque 1831/1831; descend 1830/1831, and the single failure is exactly
`test/run-drun/await-sugar.mo` — the file with the nested comment.** That is the empirical case for
`comment_text` being a leaf and not descended into. The `cursor` skip in the walk is what lets the
same checker compare both, and the opaque count is the one the normaliser is held to.

An equivalent way to say it — and the form `checkRoundTrip` uses — is that the _pieces_ gathered by
walking the normalised tree (each `Token` and each `Text`) must have `pieces[i].startIndex ===
cursor` for every `i` and cover `source.length` at the end. Because gaps are whitespace-only (§3.1),
the two are the same statement.

## 6. `ERROR` / `MISSING` → `SyntaxError`

tree-sitter is an error-recovering parser: it always produces _a_ tree, inserting `ERROR` nodes for
text it cannot match and `MISSING` nodes for tokens the grammar required but the source did not
supply. **A tree containing either is not the program the user wrote**, so formatting it would
silently rewrite code the printer never understood. Both are fatal, and `parse.ts` decides before
anything downstream runs. (Today the plugin emits garbage instead; the plan makes the failure the
deliverable — formatter-rework line ~16.)

### 6.1 Shape of the two

- `ERROR` — a node typed literally `ERROR`. Its span contains the unmatched source text. Usually
  wrapped: `let x = @@@ ;` yields `ERROR [6,11) "= @@@"` wrapping `ERROR [8,11) "@@@"`.
- `MISSING` — `isMissing`, **zero-width** (`startIndex === endIndex`). `type` is the token the
  grammar wanted (`}`, `]`, `identifier`, `text_literal`, `;`).

The normaliser carries both flags onto `NormalToken`/`NormalBranch` (`error`, `missing`) rather than
letting `parse.ts` re-derive them: a legitimate zero-width token and a `MISSING` one have the same
shape, so re-deriving would be a guess, and a wrong guess here means formatting unparseable code.

### 6.2 The walk (`findProblem`)

Most specific first: an error node is reported only if **none of its descendants** is an error, so
the caret lands on the token the user mistyped rather than on an enclosing wrapper. First offender
only: one bad token cascades, and listing the cascade buries the cause. `tree.rootNode.hasError` is
the cheap pre-filter, so the walk runs only on inputs that need it.

If `hasError` is set but the walk finds no error node, that is a **normaliser bug**, not user
error, and `parse.ts` throws a distinct message saying so rather than blaming the user's code.

### 6.3 The exception

`MotokoSyntaxError extends SyntaxError` carrying `loc` in Prettier's shape — 1-based line, 0-based
column, on `start` — plus a short `codeFrame` (two lines of context each side, caret padded by
_character_ column so a multibyte character earlier on the line does not skew it). Prettier and the
CLI print the frame verbatim; a bare "unexpected ERROR node" tells a Motoko author nothing.

### 6.4 Corpus reality

Verified (§8.4): of 1859 corpus files, **28** contain `ERROR`/`MISSING` — 610 `ERROR` nodes, 7
`MISSING` nodes (kinds `text_literal`×2, `identifier`×3, `]`×1, `;`×1; all zero-width). They include
`src/prelude/prim.mo` and `src/prelude/internals.mo` and most of `test/fail/syntax*.mo` (which are
_supposed_ to fail). A parse error **must** fail the format rather than emit garbage — those 28 are
a feature of the corpus, not a bug to work around.

Edge cases the error path must keep working: an unterminated `/* a` is an `ERROR`; an NBSP is an
`ERROR` (motoko's lexer does not accept it); an empty or whitespace-only file has
`root.childCount === 0` with `startIndex === endIndex` (so the widened root span of §2.2 is the only
thing that makes its round-trip hold); `/**/`, `//`, `///` parse with 2/2/3-character text; CRLF
leaves the `\r` inside the `line_comment` text.

## 7. The comparison normalisation (what `verify.ts` forgives)

`verify.ts` re-parses the printer's output and compares it to the **input** tree (the _rewritten_
input tree under `moc2`, so one check covers both modes — [m1-architecture.md](m1-architecture.md),
"Data flow"). The comparison is structural: node kinds, fields, and token texts. **Source offsets
must not participate** — reformatting moves everything.

`shapeOf(node)` therefore reports everything position-free:

- a `Text` gap → `null` (whitespace carries no meaning; only its existence in the walk matters),
- a `Token` → `"${named ? '' : '~'}${type}:${text}"` (the `~` marks anonymous, the text distinguishes
  `let` from `=`, and the _named_ flag is part of the shape so an identifier and a keyword cannot
  alias),
- a `Branch` → `[kind, (mode?), children…]` with the `Text` nulls filtered out.

Everything else is a difference by default. The tolerance is **exactly the rewrite's edit log** — a
difference outside a logged site fails:

| forgiven                                                      | why it is safe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a `ParP` (parenthesised expression) the rewrite **unwrapped** | `moc`'s JS export sets `include_parenthetical = false` (`src/js/common.ml`), so the oracle already ignores parens; `preserve` prints them as written so this only arises under `moc2`, where the rule logs it.                                                                                                                                                                                                                                                                                          |
| a **single-expression `BlockE`** the rewrite **added**        | `moc` normalises a one-statement block to its statement (this is the `BlockE`/`ParP` normalisation #6385 used). Adding braces around a bare branch is the `moc2` rewrite's core move, so it is logged.                                                                                                                                                                                                                                                                                                  |
| a `;` the rewrite **dropped**                                 | case separators. The semicolon is not semantic, and dropping it is one of the `moc2` rules; it is logged. Dropping a `;` _between statements_ is **not** forgiven — only the sites the rewrite logs.                                                                                                                                                                                                                                                                                                    |
| anonymous names that **embed source positions**               | `moc` stamps positions into generated names: `anon_id sort at = "@anon-" ^ sort ^ "-" ^ string_of_pos at.left` (`src/mo_def/syntax.ml:372-373`), and with `include_sources = true` (`src/js/common.ml`) every node carries a `"@" [left; right; it]` wrapper (`src/mo_def/arrange.ml:42`, `src/js/astjs.ml:184-185`). Positions move when you reformat, so these are normalised **everywhere**, not per-site. The editor strips `@anon-…-<line>.<col>` and the `"@"` position wrapper before comparing. |

Not forgiven, and deliberately so — these are the bugs the guard exists to catch: a paren added or
removed outside a logged unwrap; a `{}` block added or removed except the logged single-expression
case; a statement `;` added or dropped; any change to a token's text; any `kind` or `mode` change
(`if f (1)` → `if f(1)` is exactly a `mode` change on the `call_exp` and it must fail if the rewrite
did not log it); any `field` change; reordering. The comment texts must also match **in order**
(formatter-rework line 147).

The strictness has one direction only: `shapeOf` never _invents_ a tolerance. Whether a given
difference is the rewrite's signature is the caller's judgement, made from the edit log; a
difference the log does not mention is a failure.

## 8. Empirical validation

All numbers below are the actual output of
[`.probe/normalize-check.mjs`](../.probe/normalize-check.mjs), run against the published grammar
`/tmp/tscheck/package/tree-sitter-motoko.wasm` (identical to the vendored
`.probe/tree-sitter-motoko.wasm`, sha256 `35e710b0…9632fbf9`), over the 1859-file corpus extracted
with `git show master:<path>` from `/Users/kamil.listopad/motoko`. **Never** the stale
`tree-sitter-motoko-STALE.wasm` — it predates PR #25 and cannot parse unparenthesized moc 2 heads.

### 8.1 Token round-trip

```
round-trip: comments-opaque ok=1831  descend-into-comments ok=1830  non-whitespace gaps(opaque)=0
```

1831 = 1859 − 28 dirty files. The opaque leaf rule holds on every parseable file with zero
non-whitespace gaps. Descend mode holds on 1830 of them; the one failure is
`test/run-drun/await-sugar.mo`, and the reason is precisely §5.1/§5.2:

```
NONWS GAP test__run-drun__await-sugar.mo cursor=1501 leaf=1813 type=/*
         gap="\npublic func f7<X,A<:Int>(n:Int) : async"
```

The outer `comment_text`'s leaf stops at 1813 (its nested `block_comment` child starts there), so
descending puts the walk's cursor at 1501 while the next leaf begins at 1813 — and the intervening
`public func f7…` is not whitespace. Opaque mode does not descend into `comment_text`, so the leaf
covers `[1501,1842)` whole and nothing is skipped. **This is the empirical case that `comment_text`
must be an opaque leaf**: descend mode is not merely more expensive, it violates the gap invariant
on real input. The `cursor` skip (§5.3) lets the same checker report both counts; the opaque count
is the one `normalize.ts` is held to.

### 8.2 Mode classification

```
named nodes scanned=437318  head-classified=40  unexplained=0
rule disagreement (HEAD_SYMBOL_IDS vs grammarId!==canon) = 12
head node types seen: bin_exp_block=17 call_exp_block=9 par_exp=9 not_exp=1 dot_exp_block=3 array_idx_exp_block=1
```

The 12 disagreements are all the alternate rule's fault, enumerated in §4.4. `HEAD_SYMBOL_IDS` has
no unexplained head node and no `_object` misclassified. The low head count (40) is expected: the
corpus is style-checked motoko that mostly parenthesises its heads.

### 8.3 Offsets are UTF-16 code units

```
let é = "a😀b"; // é😀
  "let"        [0,3)   col 0
  ERROR        [4,5)   col 4   ← `é` is not a valid identifier start; irrelevant, the offsets are the point
  "="          [6,7)   col 6
  text_literal [8,14)  col 8   ← 6 UTF-16 units for "a😀b" (4 chars, 6 code units)
  ";"          [14,15) col 14
  line_comment [16,22) col 16
```

Leaves tile `0…22` exactly with no byte↔char conversion; `column` is a character column.

### 8.4 Error/MISSING census

```
dirty files=28 of 1859  ERROR nodes=610  MISSING nodes=7
missing kinds: text_literal×2, identifier×3, ]×1, ;×1   missing widths: {0}
```

## 9. What this document does not cover, and what a reviewer should check

- **`web-tree-sitter` symbol-id stability.** `grammarId` and `typeId` are per-language symbol ids
  assigned at grammar compile time. They were identical across three separate Node processes this
  session, and they are properties of the pinned wasm, so they cannot drift without a grammar bump —
  which is a deliberate re-pin that must regenerate `nodes.generated.ts` anyway. But the _values_
  (258 vs 275) are not stable across wasm rebuilds: if the grammar is ever recompiled from a
  different `tree-sitter-cli`, the numbers can shift. **The ids must therefore be checked, not
  trusted** — see the `HEAD_SYMBOL_IDS` assertion in `normalize-check.mjs`, which recomputes the set
  from `nodeTypeForId` and fails if it no longer matches the names. A reviewer should confirm that
  assertion exists in whatever lands in `src/parser/normalize.ts`; the safe form is to derive the set
  once from the language object rather than hardcode 20 numbers, and to fail loudly (a thrown error
  at init) if any `HEAD_SYMBOL_IDS` member does not resolve to a name in the expected family.
- **`comment_text` as a leaf is a requirement, not a preference.** Descending into it and deduping
  overlapping leaves is _not_ equivalent: §8.1 shows the descend walk leaves a non-whitespace gap on
  the one file with a nested block comment. The leaf rule is also what a printer needs (verbatim
  text) and is cheaper. If M2 comment attachment ever needs the inner comment as an object, it must
  take the text from `comment_text.text` (a substring scan), not by descending and re-tiling.
- **`fields` / `set` are currently unused.** They are carried for the shape comparison and for the
  corpora that put explicit fields on the node (e.g. `cards: [ _age ]`). No test exercises them yet;
  a reviewer should not read their presence as "implemented".
- **Unverified:** nothing here was checked against `moc.js` or a `moc` binary — neither exists in
  this environment. The moc-side normalisation (§7's table) is derived from reading `motoko`'s
  `src/mo_def/arrange.ml`, `src/mo_def/syntax.ml`, `src/js/astjs.ml` and `src/js/common.ml` at
  `master`; the _behaviour_ of `parseMotoko(recovery, src)` with those settings has **not** been
  run. `tools/validate-moc2/` is where that gets pinned (formatter-rework §"The oracle"), and it is
  not written yet.
- **Also unverified:** the corpus is `test/` and `src/` from `dfinity/motoko` at `master`. The plan's
  corpus also includes motoko-core, the grammar's `test/packages.json` set, skills-internal and
  mops-packages (formatter-rework line 148). Those are not present here, so §8's numbers are for the
  compiler tree only.
