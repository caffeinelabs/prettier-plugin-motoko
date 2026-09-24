// Ported from the 0.13.0 suite: `variants / text concatenation` (formatter).
//
// Verdict: 3 already identical to 0.13, 4 changed on purpose, 2 deleted as a bug.
//
// 3 × breaks placed differently:
//   - [5] line 1: 0.13 "\"A\" # b" → now "\"A\"# b"
//   - [6] line 1: 0.13 "\"A\" # \"B\"" → now "\"A\"#\"B\""
//   - [7] line 1: 0.13 "\"A\" # #b" → now "\"A\"# #b"
//
// 1 × the semicolon rule:
//   - [8] line 2: 0.13 "\"B\";" → now "\"B\""
//
// 2 case(s) of this name are refusals — the parse throws, so they cannot be
// a fixture here. They are pinned in `tests/refusals/` (see `tests/refusals.test.ts`).
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
#a
"A" # b
"A" # #b
"A"# b
"A"#"B"
"A"# #b
"A" #
"B"