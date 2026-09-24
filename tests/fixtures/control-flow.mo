// Range of expressions and control flow, with the labels and guards that are easy to leave out.

actor {
    func loops(n : Nat) : Nat {
        var total = 0;

        // for_exp with its pattern, iterator and body fields
        for (i in [0, 1, 2].vals()) {
            total += i;
        };

        // while_exp
        var i = 0;
        while (i < n) { i += 1 };

        // loop_exp with no condition
        var j = 0;
        loop { j += 1; if (j >= n) { break } };

        // label_exp with break/continue carrying the label
        label outer for (a in [0, 1].vals()) {
            label inner for (b in [0, 1].vals()) {
                if (a == b) { continue inner };
                if (a > b) { break outer };
            };
        };

        total + j;
    };

    // if_exp with an else-if chain and a block head
    func branch(c : Bool) : Nat {
        if c { 1 } else if (not c) { 2 } else { 3 };
    };

    // switch_exp with a guard, a literal pattern and an else-less arm
    func switches(n : Nat) : Text {
        switch (n) {
            case (0) "zero";
            case (m) if (m > 10) "big";
            case (_) "small";
        };
    };

    // do_exp / do_quest_exp / try_exp with catch and finally
    func effects() : async Nat {
        let a = do { 1 };
        let b = try { await async { 1 } } catch (e) { 0 } finally { ignore a };
        b;
    };

    // throw_exp, return_exp, assert_exp, ignore_exp, label_exp on a block
    func flow(c : Bool) : Nat {
        assert c;
        if (not c) { throw Error.reject("no") };
        ignore (do { 1 });
        return 0;
    };

    // assign_exp and the binary assignment operators, including unassign
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

    // The full binary operator set. The grammar's precedence is flat, so parens here must survive formatting.
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

    // The unary operators.
    func unaries(a : Nat) : Nat { -a };

    // rel_op / bin_op / binassign_op are anonymous tokens, so they only appear as children here.
};
