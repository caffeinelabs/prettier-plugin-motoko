// Objects, records, classes, actors and mixins, including the field forms.
//
// `obj_body` recurses, so a test that only ever sees one level of nesting can miss an entire
// grammar production. Each nesting level below is deliberate, and the four field token kinds
// (`val_tf`/`var_tf`/`func_tf`/`typ_tf`) each appear at least once.

persistent actor Objects {
    // A plain record: exp_field with the shorthand, the rename and the mutable form.
    let a = 1;
    var b = 2;
    let rec1 = { a = 1; b = 2 };
    let rec2 = { a; b };
    let rec3 = { x = a; y = var b };
    let rec4 = { nested = { inner = { deep = 1 } } };

    // object_exp: an object literal with its own body and both field forms
    let obj = object {
        public let c = 1;
        public var d = 2;
        public func e() : Nat { c + d };
        private func hidden() : Nat { 0 };
        let f = hidden();
    };

    // module / include_dec
    //
    // `include` takes an *expression*, not a bare module name: the grammar's `INCLUDE x=id e=exp`
    // production requires the `exp`, and real moc agrees — `include Inner;` is rejected with
    // "unexpected token ';', expected ... <exp(ob)>". The `()` is load-bearing.
    module Inner {
        public let g = 1;
    };
    include Inner();

    // obj_dec: a named object declaration
    object Named {
        public func h() : Nat { 1 };
    };

    // class_dec with a constructor parameter and a type parameter
    class Klass(x : Nat) {
        public let v = x;
        public func get() : Nat { v };
    };

    // A class with a typ_bind and a supertype
    class Boxed<T>(init : T) {
        public var value = init;
        public func set(v : T) : () { value := v };
    };

    // mixin_dec, including the parameterised mixin
    let mix = mixin (y : Nat) {
        public let m = y;
    };

    // A private / public / shared actor field, and an actor class instantiation
    let instance = Klass(1);

    // dec_field with the `shared`/`query` function forms, which attach a shared_pat
    public query func q() : async Nat { 1 };
    public shared func s() : async () {};
    public shared ({ caller }) func withCaller() : async () { ignore caller };

    // The pattern in the record shorthand is a val_pat_field, not an exp_field.
    let rec5 = { a; b = b; x = a };

    ignore (rec1, rec2, rec3, rec4, obj, obj.get, Named, mix, instance, rec5);
};
