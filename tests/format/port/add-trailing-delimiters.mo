// Ported from the 0.13.0 suite: `add trailing delimiters` (formatter).
//
// Verdict: 4 changed on purpose.
//
// 4 × 0.13 expanded groups that fit:
//   - [0] line 1: 0.13 "(" → now "(a, b, c)"
//   - [1] line 1: 0.13 "(" → now "(a, b, c,)"
//   - [2] line 1: 0.13 "(" → now "(a, b, c,)"
//   - [3] line 1: 0.13 "(" → now "(a, b, c,)"
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
(a
,b,c)
(a
,b,c,)
(a
,b,c,)
(a
,b,c,)