// Refusal fixture: the pinned moc rejects this input too, so the formatter rejects it.
//
// Legacy case(s): partially written import[0]
//
// Contract: the parse rejects with a MotokoSyntaxError carrying a `loc`. The message and the
// exact line/column are deliberately NOT asserted — both move whenever parser recovery is
// improved, and neither is a rule the rework is trying to preserve. See tests/refusals.test.ts.
import Array "mo:base/Array";
import

actor {}