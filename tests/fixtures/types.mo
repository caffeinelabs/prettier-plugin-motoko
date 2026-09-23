// Types: every `*_typ` kind, including the ones that only ever appear in a type position.
//
// `func_typ`, `obj_typ`, `variant_typ`, `weak_typ`, `or_typ`, `and_typ`, `quest_typ` and
// `tup_typ` are easy to leave uncovered because most real code declares its types through `type`
// aliases whose bodies are the *common* forms. Each is spelled out explicitly below.

actor {
    // prim_typ and path_typ
    type P = Nat;
    type Q = Prim.Types.Int;

    // or_typ / and_typ — the supertype-of disjunction and conjunction
    type Shared = { #a } or { #b };
    type Both = { a : Nat; b : Nat } and { c : Nat };

    // quest_typ / tup_typ / array_typ
    type Maybe = ?Nat;
    type Pair = (Nat, Text);
    type Unit = ();
    type Row = [Nat];
    type Rows = [[Nat]];

    // func_typ, with and without typ_params, and an async one.
    // `async Nat -> async Nat` is NOT valid Motoko — moc rejects it at the `->` — so the async
    // return sits inside the arrow rather than spanning it.
    type F = Nat -> Nat;
    type G = <T>(T) -> T;
    type H = Nat -> async Nat;
    type I = shared () -> ();

    // obj_typ, including a mutable field and a nested object
    type Rec = {
        a : Nat;
        var b : Text;
        c : { d : Bool };
    };

    // variant_typ
    type V = { #one; #two : Nat; #three : { x : Nat } };

    // typ_params with a bound (typ_bind)
    type Boxed<T> = { value : T };
    type Bounded<T <: { a : Nat }> = { value : T };

    // weak_typ and the function type in a field
    type Weak = { f : Nat -> Nat };

    ignore (null : ?P);
};
