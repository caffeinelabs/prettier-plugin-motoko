// Records: the plain form, the shorthand, the mutable field, the rename.
//
// Input is deliberately NOT canonical, so the fixture shows the printer moving it: the first
// record is broken in the source and must collapse, the wide one is one line in the source and
// must break.
let simple = { a = 1; b = 2 };
let shorthand = { a; b };
let renamed = { newX = x; y };
let mutable = { x = 1; var y = 2 };
let nested = { outer = { inner = { deep = 1 } } };
let wide = { alpha = 1; beta = 2; gamma = 3; delta = 4; epsilon = 5; zeta = 6; eta = 7 };
let broken = {
    a = 1;
    b = 2;
};
let trailing = { a = 1; };
