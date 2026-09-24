// Ported from the 0.13.0 suite: `lines before/after group` (formatter).
//
// Verdict: 5 changed on purpose, 1 deleted as a bug.
//
// 5 × 0.13 expanded groups that fit:
//   - [0] line 1: 0.13 "[" → now "[1, 2,];"
//   - [1] line 1: 0.13 "{" → now "{ abc; };"
//   - [2] line 1: 0.13 "[" → now "[1, 2,]"
//   - [3] line 1: 0.13 "{" → now "{ abc }"
//   - [5] line 1: 0.13 "actor {" → now "actor { func f() { let a = 0; } }"
//
// 1 case(s) of this name are refusals — the parse throws, so they cannot be
// a fixture here. They are pinned in `tests/refusals/` (see `tests/refusals.test.ts`).
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
actor {

func f() {

let a = 0;

}

}
