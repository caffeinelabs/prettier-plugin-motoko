// The `... with ...` record-literal form, which `parts.ts:listOf` resolves to `semi_sep1` by
// instance (the node carries a `with` token). The `and`-only form has no `with` and stays
// `semi_sep`. Both print identically under `preserve`, because the trailing separator is
// reproduced from the source rather than chosen by the family — the family is fidelity to the
// decision table, not a behaviour switch.
//
// The prelude words (`and`, `with`) are ordinary list items: `parts.ts:isItem` only excludes
// separators and delimiters, so they are printed in source order between the base expressions
// and the fields.
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
