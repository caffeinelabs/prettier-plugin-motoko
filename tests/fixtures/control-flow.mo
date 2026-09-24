actor {
    func loops(n : Nat) : Nat {
        var total = 0;

        for (i in [0, 1, 2].vals()) {
            total += i;
        };

        var i = 0;
        while (i < n) { i += 1 };

        var j = 0;
        loop { j += 1; if (j >= n) { break } };

        label outer for (a in [0, 1].vals()) {
            label inner for (b in [0, 1].vals()) {
                if (a == b) { continue inner };
                if (a > b) { break outer };
            };
        };

        total + j;
    };

    func branch(c : Bool) : Nat {
        if c { 1 } else if (not c) { 2 } else { 3 };
    };

    func switches(n : Nat) : Text {
        switch (n) {
            case (0) "zero";
            case (m) if (m > 10) "big";
            case (_) "small";
        };
    };

    func effects() : async Nat {
        let a = do { 1 };
        let b = try { await async { 1 } } catch (e) { 0 } finally { ignore a };
        b;
    };

    func flow(c : Bool) : Nat {
        assert c;
        if (not c) { throw Error.reject("no") };
        ignore (do { 1 });
        return 0;
    };

    func assigns() : Nat {
        var a = 1;
        a += 1;
        a -= 1;
        a *= 2;
        a /= 2;
        a %= 2;
        a **= 2;
        a := 0;
        a;
    };

    func ops(a : Nat, b : Nat, c : Bool) : Bool {
        let n = a + b - a * b / a % b ** 2;
        let s = a << 1 >> 1;
        let m = a & b | a ^ b;
        let l = c and not c or c;
        let r = a == b and a != b or a < b and a <= b or a > b and a >= b;
        let q = a : Nat;
        ignore (n, s, m);
        l and r and q == a;
    };

    func unaries(a : Nat) : Nat { -a };
};
