module M {
    public let u = 25;
};
let a = { x = 1 };
let base = { b = 6 };
let andOnly = { a and M };
let withOnly = { base with x = 2 };
let andWith = { a and M with u = 1 };
let nestedBase = { { c = "C"; d = "D" } with a = 8; b = 6 };
let wide = { veryLongBaseNameHere with alpha = 1; beta = 2; gamma = 3; delta = 4; epsilon = 5 };
