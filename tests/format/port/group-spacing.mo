// Ported from the 0.13.0 suite: `group spacing` (formatter).
//
// Verdict: 1 changed on purpose.
//
// 1 × 0.13 collapsed groups the source had spread:
//   - [0] line 1: 0.13 "{}; { a }; (); (a)" → now "{};"
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
{};{a};();(a)