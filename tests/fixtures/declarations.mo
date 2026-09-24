import A "a";
import B = "b";
import { c; d } = "c";
import P = "mo:⛔";

module Inner {
    public type T = Nat;
    public let g = 1;
};

actor {
    type Alias = Nat;
    type Param<X> = X;
    type Bounded<X <: Nat> = X;
    type Two<X, Y> = (X, Y);

    let simple = 1;
    private let explicitPrivate = 2;
    public let explicitPublic = 3;
    var mutable = 4;
    public var publicMutable = 5;

    let (first, second) = (1, 2);
    let annotated : Nat = 6;

    let ?present = null else { 0 };

    debug simple;
    debug_show (explicitPublic, mutable);

    let viaPath = Inner.g;

    ignore (
        simple,
        explicitPrivate,
        explicitPublic,
        mutable,
        publicMutable,
        first,
        second,
        annotated,
        present,
        viaPath,
        A,
        B,
        c,
        d,
    );
};
