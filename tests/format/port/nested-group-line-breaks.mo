// Ported from the 0.13.0 suite: `nested group line breaks` (formatter).
//
// Verdict: 1 changed on purpose.
//
// 1 × 0.13 collapsed groups the source had spread:
//   - [0] line 1: 0.13 "((" → now "("
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
(
(
xxxxxxxxxxxxxxxxxxxx, 
xxxxxxxxxxxxxxxxxxxx, 
xxxxxxxxxxxxxxxxxxxx, 
xxxxxxxxxxxxxxxxxxxx, 
xxxxxxxxxxxxxxxxxxxx));
