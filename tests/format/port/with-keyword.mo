// Ported from the 0.13.0 suite: ``with` keyword` (formatter).
//
// Verdict: 1 already identical to 0.13, 3 changed on purpose.
//
// 3 × 0.13 expanded groups that fit:
//   - [1] line 1: 0.13 "{" → now "{ a and b with c = d }"
//   - [2] line 1: 0.13 "{" → now "{ a and b with c = d }"
//   - [3] line 1: 0.13 "{" → now "{ a and b with c = d; e = f; }"
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
{a and b with c = d}
{a and b with
c = d}
{a and b with 
c = d}
{a and b with
c = d; e = f;}