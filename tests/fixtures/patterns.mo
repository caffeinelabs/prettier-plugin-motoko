// Patterns: every `*_pat` kind the grammar declares.
//
// Split out from the other fixtures because a pattern bug is invisible until the printer has to
// emit one, and the sibling corpus roots exercise the common forms heavily and the rare ones
// (alternation, `and`, named-object punctuation, tag patterns) hardly at all.

actor {
    type T = { a : Nat; b : ?Nat };

    // var_pat / lit_pat / wild_pat / tup_pat
    let (x, y) = (1, 2);
    let (_, z) = (3, 4);

    // alt_pat: `or`-alternation and `and`-conjunction
    func alt(n : ?Nat) : Bool {
        switch (n) {
            case (null or ?0) false;
            case (_ or _) true;
        };
    };

    // annot_pat: a pattern with its own type annotation
    func annot(a : Any) : Bool {
        switch (a) {
            case ((n : Nat)) n > 0;
            case (_) false;
        };
    };

    // obj_pat, including the shorthand and the renamed field
    func obj(r : T) : Nat {
        switch (r) {
            case ({ a; b = null }) a;
            case ({ a = n; b = ?m }) n + m;
            case (_) 0;
        };
    };

    // quest_pat: the `?…` option pattern
    func quest(n : ?Nat) : Nat {
        switch (n) { case (?v) v; case (null) 0 };
    };

    // tag_pat / unop_pat, and a mixed tuple
    func tagged(v : { #tag : Nat; #other }) : Nat {
        switch (v) {
            case (#tag n) n;
            case (#other) 0;
        };
    };

    // var_pat in a `let` binding, separate from the tuple above
    let single = x;
    ignore (y, z, single);
};
