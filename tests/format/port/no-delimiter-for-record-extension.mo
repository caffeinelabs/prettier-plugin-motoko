// Ported from the 0.13.0 suite: `no delimiter for record extension` (formatter).
//
// Verdict: 5 changed on purpose, 1 deleted as a bug.
//
// 5 × 0.13 expanded groups that fit:
//   - [0] line 1: 0.13 "{" → now "{ a }"
//   - [1] line 1: 0.13 "{" → now "{ a : b }"
//   - [2] line 1: 0.13 "{" → now "{ a = b }"
//   - [3] line 1: 0.13 "{" → now "{ a and b }"
//   - [4] line 1: 0.13 "{" → now "{ a with b = c }"
//
// 1 case(s) of this name are refusals — the parse throws, so they cannot be
// a fixture here. They are pinned in `tests/refusals/` (see `tests/refusals.test.ts`).
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
{
a}
{
a : b}
{
a = b}
{
a and b}
{
a with b = c}