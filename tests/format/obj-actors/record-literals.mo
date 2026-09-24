// Records: the plain form, the shorthand, the mutable field, the rename.
//
// The input is deliberately not canonical, so the fixture shows the printer moving it:
// `collapsed` is broken in the source and fits on one line, `wide` is one line in the source
// and overflows `printWidth` so it must break. `trailing` pins the rule that a trailing `;`
// is reproduced from the source rather than invented or dropped.
let collapsed = {
    a = 1;
    b = 2;
};
let shorthand = { a; b };
let renamed = { newX = x; y };
let mutable = { x = 1; var y = 2 };
let nested = { outer = { inner = { deep = 1 } } };
let wide = { alpha = 1; beta = 2; gamma = 3; delta = 4; epsilon = 5; zeta = 6; eta = 7 };
let trailing = { a = 1; };
