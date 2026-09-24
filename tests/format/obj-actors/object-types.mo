// Object types (`obj_typ`), which the decision table puts in the plain `semi_sep` row, and
// `variant_typ`, which shares the braces and the `;` but is the `semi_sep1` row. Both are the
// same list contract in code: `docs/style.md` says the two rows "print identically", so the
// family is recorded for fidelity and nothing branches on it.
//
// `wide` is one line in the source and must break; the rest fit and stay flat.
type Simple = { x : Nat; y : Text };
type Method = { f : () -> async Nat };
type Mutable = { var x : Nat };
type TypeField = { type U = Nat; x : U };
type Nested = { inner : { deep : { x : Nat } } };
type WithParams = { f<A>(a : A) : A };
type Result = { #ok : Nat; #error : Text };
type Status = { #Active; #Inactive; #Banned : Text };
type Arrow = { x : Nat } -> Nat;
type Wide = { model : Text; plate : Text; isValid : Bool; wasStolen : Bool; expires : Nat };
