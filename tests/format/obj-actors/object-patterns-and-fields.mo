// `obj_pat` and the four field forms, which are the token-level shape of every body above.
// `dec_field` attaches a visibility and stability; `exp_field` carries the mutable `var` and the
// rename form; `val_tf`/`func_tf`/`typ_tf` are the object-type fields; `val_pat_field` and
// `typ_pat_field` are the pattern fields.
object Fields {
    public let a = 1;
    private let hidden = 0;
    public var b = 2;
    public let renamed = { newX = a; var y = b };
    public func method() : Nat { a };
};
func take({ x; y = renamed } : { x : Nat; y : Nat }) : Nat { x };
func annotated({ a : Nat } : { a : Nat }) : Nat { a };
