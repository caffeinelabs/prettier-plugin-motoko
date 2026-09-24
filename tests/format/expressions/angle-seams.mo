// moc reads `<`/`>` as comparisons only when spaced on both sides, so these instantiations keep their spacing.
func id<T>(x : T) : T { x };
let spacedBeforeAngle = id <Nat>(1);
let inAChain = 1 + id <Nat>(2);
let compare = 1 < 2;
let compareBroken = 1 <
  2;
