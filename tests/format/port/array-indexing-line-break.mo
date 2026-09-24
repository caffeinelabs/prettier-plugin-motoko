// Ported from the 0.13.0 suite: `array indexing line break` (formatter).
//
// Verdict: 2 changed on purpose, 1 deleted as a bug.
//
// 1 × the semicolon rule:
//   - [0] line 1: 0.13 "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx[0];" → now "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx[0]"
//
// 1 × 0.13 expanded groups that fit:
//   - [1] line 2: 0.13 "0" → now "0]"
//
// 1 case(s) of this name are refusals — the parse throws, so they cannot be
// a fixture here. They are pinned in `tests/refusals/` (see `tests/refusals.test.ts`).
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx[0]
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx[
0]