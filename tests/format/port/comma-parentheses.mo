// Ported from the 0.13.0 suite: `comma-parentheses` (formatter).
//
// Verdict: 1 changed on purpose.
//
// 1 × 0.13 expanded groups that fit:
//   - [0] line 1: 0.13 "if (" → now "if(x) { y }"
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
if(
x) { y }