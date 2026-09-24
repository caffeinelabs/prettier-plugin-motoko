// `obj_pat` and the four field token shapes that every body above is made of: `dec_field`
// attaches a visibility/stability to a declaration, `exp_field` carries the mutable `var` and
// the rename form, `val_tf`/`func_tf`/`typ_tf` are the object-type fields, and `val_pat_field`
// is the object-pattern field. (There is no `var_tf` kind: a mutable object-type field is a
// `val_tf` whose first token is `var`.)
//
// The record-literal and object-type inner spacing is left as the source wrote it — see
// `docs/style.md` conflict ruling 1, `bracketSpacing`, which is inert under `preserve`.
object Fields {
    public let a = 1;
    private let hidden = 0;
    public var b = 2;
    public let renamed = { newX = a; var y = b };
    public func method() : Nat { a };
};
func take({ x; y = renamed } : { x : Nat; y : Nat }) : Nat { x };
func annotated({ a : Nat } : { a : Nat }) : Nat { a };

// `with`-form records nest, and the nested base is itself a list that recurses.
let outer = { { p = 1 } with q = 2 };
