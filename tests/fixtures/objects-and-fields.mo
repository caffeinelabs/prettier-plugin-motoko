persistent actor Objects {
    let a = 1;
    var b = 2;
    let rec1 = { a = 1; b = 2 };
    let rec2 = { a; b };
    let rec3 = { x = a; y = var b };
    let rec4 = { nested = { inner = { deep = 1 } } };

    let obj = object {
        public let c = 1;
        public var d = 2;
        public func e() : Nat { c + d };
        private func hidden() : Nat { 0 };
        let f = hidden();
    };

    module Inner {
        public let g = 1;
    };
    include Inner();

    object Named {
        public func h() : Nat { 1 };
    };

    class Klass(x : Nat) {
        public let v = x;
        public func get() : Nat { v };
    };

    class Boxed<T>(init : T) {
        public var value = init;
        public func set(v : T) : () { value := v };
    };

    let mix = mixin (y : Nat) {
        public let m = y;
    };

    let instance = Klass(1);

    public query func q() : async Nat { 1 };
    public shared func s() : async () {};
    public shared ({ caller }) func withCaller() : async () { ignore caller };

    let rec5 = { a; b = b; x = a };

    ignore (rec1, rec2, rec3, rec4, obj, obj.get, Named, mix, instance, rec5);
};
