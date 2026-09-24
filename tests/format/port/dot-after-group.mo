// Ported from the 0.13.0 suite: `dot after group` (formatter).
//
// Verdict: 1 already identical to 0.13, 2 changed on purpose.
//
// 1 × 0.13 collapsed groups the source had spread:
//   - [1] line 1: 0.13 "().0" → now "("
//
// 1 × 0.13 expanded groups that fit:
//   - [2] line 1: 0.13 "(" → now "(a).0"
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
().0
(


).0
(
a
).0