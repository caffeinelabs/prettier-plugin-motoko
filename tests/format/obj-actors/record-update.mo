// The `... with ...` record-literal form (`semi_sep1` per the decision table).
//
// The prelude is `exp_post (and exp_post)* with`, then the fields. `and`-only has no `with` and
// no fields; the printer must keep that shape too.
module M {
    public let u = 25;
};
let a = { x = 1 };
let base = { b = 6 };
let extended = { a and M };
let withOnly = { base with x = 2 };
let withAnd = { a and M with u = 1 };
let nestedBase = { { c = "C"; d = "D" } with a = 8; b = 6 };
let wide = { veryLongBaseNameHere with alpha = 1; beta = 2; gamma = 3; delta = 4; epsilon = 5 };
