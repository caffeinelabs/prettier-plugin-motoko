// Declarations and the binding forms: imports, modules, `let`/`var`, `let … else`, `type`, the
// visibility modifiers, and `debug`/`debug_show`.
//
// Split from the expression fixtures because a declaration is where the parser's *recovery* rules
// fire, and a recovery that produces a tree the printer accepts is worse than one that fails: the
// file still formats, and the output is wrong. The `import` production is the sharpest example —
// it is `IMPORT <pat> EQ? <TEXT>`, so `import C = A;` (alias to an identifier) is **not** valid
// Motoko even though it reads like the JS form, and only `import C = "path";` is.

import A "a";
import B = "b";
import { c; d } = "c";
import P = "mo:⛔";

module Inner {
    public type T = Nat;
    public let g = 1;
};

actor {
    // typ_dec, with and without parameters, and with a bound.
    type Alias = Nat;
    type Param<X> = X;
    type Bounded<X <: Nat> = X;
    type Two<X, Y> = (X, Y);

    // let_dec / var_dec, and their visibility modifiers.
    let simple = 1;
    private let explicitPrivate = 2;
    public let explicitPublic = 3;
    var mutable = 4;
    public var publicMutable = 5;

    // A `let` whose pattern is not a name, and one carrying its own type annotation.
    let (first, second) = (1, 2);
    let annotated : Nat = 6;

    // let_else_dec: the `let … else` form, whose `else` arm is a nest rather than a body, so a bare
    // `{` after `else` is a record — the same head/object distinction the head-mode fixture covers.
    let ?present = null else { 0 };

    // `debug` is a declaration position too (`debug_dec`), not only an expression.
    debug simple;
    debug_show (explicitPublic, mutable);

    // A nested module and a reference through it, so `typ_path`/`proj_exp` appear on a module that
    // is not at the top level.
    let viaPath = Inner.g;

    ignore (
        simple,
        explicitPrivate,
        explicitPublic,
        mutable,
        publicMutable,
        first,
        second,
        annotated,
        present,
        viaPath,
        A,
        B,
        c,
        d,
    );
};
