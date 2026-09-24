// Object types (`obj_typ`), which the decision table puts in the plain `semi_sep` row, and the
// variant type (`variant_typ`, `semi_sep1`) it shares a shape with.
type Simple = { x : Nat; y : Text };
type Method = { f : () -> async Nat };
type Mutable = { var x : Nat };
type TypeField = { type U = Nat; x : U };
type Nested = { inner : { deep : { x : Nat } } };
type CarInfo = { model : Text; plate : Text; isValid : Bool; wasStolen : Bool; expires : Nat };
type WithParams = { f<A>(a : A) : A };
type Result = { #ok : Nat; #error : Text };
type Status = { #Active; #Inactive; #Banned : Text };
type Arrow = { x : Nat } -> Nat;
