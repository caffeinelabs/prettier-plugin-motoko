let parExp = f(
    a // c
    ,
    b
);

let arrayExp = [
    a // c
    ,
    b
];

let trailingComma = f(
    a
    // c
    ,
);

let fileSeam = 1 // c
;

let angleSeam = L.make<
    A // c
    ,
    B
>();

let attachedComment = f(a, b // trailing
);
let ownLineComment = f(
    a,
    // own line
    b
);

let blockCommentUnaffected = f(
    a /* c */
    ,
    b
);
