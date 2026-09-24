actor {
    type T = { a : Nat; b : ?Nat };

    let (x, y) = (1, 2);
    let (_, z) = (3, 4);

    func alt(n : ?Nat) : Bool {
        switch (n) {
            case (null or ?0) false;
            case (_ or _) true;
        };
    };

    func annot(a : Any) : Bool {
        switch (a) {
            case ((n : Nat)) n > 0;
            case (_) false;
        };
    };

    func obj(r : T) : Nat {
        switch (r) {
            case ({ a; b = null }) a;
            case ({ a = n; b = ?m }) n + m;
            case (_) 0;
        };
    };

    func quest(n : ?Nat) : Nat {
        switch (n) { case (?v) v; case (null) 0 };
    };

    func tagged(v : { #tag : Nat; #other }) : Nat {
        switch (v) {
            case (#tag n) n;
            case (#other) 0;
        };
    };

    let single = x;
    ignore (y, z, single);
};
