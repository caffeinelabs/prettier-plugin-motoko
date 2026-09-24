// Refusal fixture: moc rejects this input, so the formatter must too.
// Ported from the 0.13 suite: trailing comma in square brackets[6]
type T = [{
  abc;
}];
