// Ported from the 0.13.0 suite: `logical operators` (formatter).
//
// Verdict: 5 changed on purpose.
//
// 4 × 0.13 expanded groups that fit:
//   - [1] line 1: 0.13 "(" → now "(A and B)"
//   - [2] line 1: 0.13 "(" → now "(A and B)"
//   - [3] line 1: 0.13 "(" → now "(A or B)"
//   - [4] line 1: 0.13 "(" → now "(A or B)"
//
// 1 × the semicolon rule:
//   - [0] line 1: 0.13 "A and B;" → now "A and B"
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
A and
 B
(A and
 B)
(A and
 B)
(A or
 B)
(A or
 B)