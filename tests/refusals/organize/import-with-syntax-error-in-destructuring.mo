// Refusal fixture: the pinned moc rejects this input too, so the formatter rejects it.
//
// Legacy case(s): import with syntax error in destructuring[0]
//
// Contract: the parse rejects with a MotokoSyntaxError carrying a `loc`. The message and the
// exact line/column are deliberately NOT asserted — both move whenever parser recovery is
// improved, and neither is a rule the rework is trying to preserve. See tests/refusals.test.ts.
import Array "mo:base/Array";
import { map;; filter } "mo:base/Array";

actor {}