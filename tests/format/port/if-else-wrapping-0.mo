// Ported from the 0.13.0 suite: `if-else wrapping` (formatter).
//
// Verdict: 3 already identical to 0.13, 1 changed on purpose.
//
// 1 × 0.13 expanded groups that fit:
//   - [3] line 1: 0.13 "if true {" → now "if true { a } else if false { b } else { c }"
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
if true () else ()