// Refusal fixture: the pinned moc rejects this input too, so the formatter rejects it.
//
// Legacy case(s): shared and query keywords[1]
//
// Contract: the parse rejects with a MotokoSyntaxError carrying a `loc`. The message and the
// exact line/column are deliberately NOT asserted — both move whenever parser recovery is
// improved, and neither is a rule the rework is trying to preserve. See tests/refusals.test.ts.
shared query({})