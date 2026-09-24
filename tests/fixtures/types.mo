actor {
    type P = Nat;
    type Q = Prim.Types.Int;

    type Shared = { #a } or { #b };
    type Both = { a : Nat; b : Nat } and { c : Nat };

    type Maybe = ?Nat;
    type Pair = (Nat, Text);
    type Unit = ();
    type Row = [Nat];
    type Rows = [[Nat]];

    type F = Nat -> Nat;
    type G = <T>(T) -> T;
    type H = Nat -> async Nat;
    type I = shared () -> ();

    type Rec = {
        a : Nat;
        var b : Text;
        c : { d : Bool };
    };

    type V = { #one; #two : Nat; #three : { x : Nat } };

    type Boxed<T> = { value : T };
    type Bounded<T <: { a : Nat }> = { value : T };

    type Weak = { f : Nat -> Nat };

    ignore (null : ?P);
};
