// The six constructs that appear in head position: an unparenthesised control head, where a `{`
// after the node opens a *body* rather than a record.
//
// Both alias shapes are here on purpose. `not` and `par` are aliased back onto their *bare* names
// (`not_exp`, `par_exp`), so their `type` carries no mode suffix at all and only `grammarId` can
// recover head mode. `call`, `x.y`, `x[0]` and `a and b` get `<name>_block`, where the suffix
// happens to agree. A regression in `modeOf` shows on the first group and not the second.

actor {
    func notHead(c : Bool) : Bool { if not c { true } else { false } };
    func parHead(c : Bool) : Bool { if (c) { true } else { false } };
    func callHead(c : Bool) : Bool { if f(c) { true } else { false } };
    func dotHead(o : { b : Bool }) : Bool { if o.b { true } else { false } };
    func idxHead(a : [Bool]) : Bool { if a[0] { true } else { false } };
    func binHead(a : Bool, b : Bool) : Bool { if a and b { true } else { false } };

    func f(b : Bool) : Bool { b };

    // The same constructs in object position, which must NOT be head mode. `not c` here is an
    // ordinary expression and `{` after an assignment opens a record.
    func objectPosition(c : Bool) : () {
        let a = not c;
        let b = (c);
        let d = f(c);
        let e = { x = c };
        ignore (a, b, d, e);
    };
};
