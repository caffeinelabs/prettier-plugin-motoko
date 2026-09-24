// Ported from the 0.13.0 suite: `no automatic semicolons before `else`, `catch`, etc.` (formatter).
//
// Verdict: 5 already identical to 0.13, 2 changed on purpose.
//
// 2 × 0.13 collapsed groups the source had spread:
//   - [1] line 1: 0.13 "if a {}" → now "if a"
//   - [4] line 3: 0.13 "else {};" → now "else"
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
if a {}
// Comment
else {};

if a
{}
// Comment
else {};

if a {
}
// Comment
else {};
if a {
}

// Comment
else {};
if a {
}
// Comment
  else
{};
try {}
// Comment
catch e {};

try {}
// Comment
finally {};
