actor {
    func notHead(c : Bool) : Bool { if not c { true } else { false } };
    func parHead(c : Bool) : Bool { if (c) { true } else { false } };
    func callHead(c : Bool) : Bool { if f(c) { true } else { false } };
    func dotHead(o : { b : Bool }) : Bool { if o.b { true } else { false } };
    func idxHead(a : [Bool]) : Bool { if a[0] { true } else { false } };
    func binHead(a : Bool, b : Bool) : Bool { if a and b { true } else { false } };

    func f(b : Bool) : Bool { b };

    func objectPosition(c : Bool) : () {
        let a = not c;
        let b = (c);
        let d = f(c);
        let e = { x = c };
        ignore (a, b, d, e);
    };
};
