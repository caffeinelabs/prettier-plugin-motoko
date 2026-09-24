// Refusal fixture: the pinned moc rejects this input too, so the formatter rejects it.
//
// Legacy case(s): prettier-ignore line comment as first line in block[0]
//
// Contract: the parse rejects with a MotokoSyntaxError carrying a `loc`. The message and the
// exact line/column are deliberately NOT asserted — both move whenever parser recovery is
// improved, and neither is a rule the rework is trying to preserve. See tests/refusals.test.ts.
{
// prettier-ignore
  123}