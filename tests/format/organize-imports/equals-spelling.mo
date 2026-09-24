// The `=` spelling is the Motoko 2.0 form. `preserve` keeps whichever spelling the source used,
// on every statement of the section — including the bare-looking `import Array`, which is emitted
// with `=` because the section as a whole was spelled that way.
import { map } = "mo:base/Array";
import Array = "mo:base/Array";
import Text "mo:base/Text";

actor {};
