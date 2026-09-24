// Refusal fixture: moc rejects this input, so the formatter must too.
// Ported from the 0.13 suite: function in type bindings[1]
f<() -> (), () -> ())>();
