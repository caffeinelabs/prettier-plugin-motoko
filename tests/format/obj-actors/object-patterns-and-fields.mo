object Fields {
    public let a = 1;
    private let hidden = 0;
    public var b = 2;
    public let renamed = { newX = a; var y = b };
    public func method() : Nat { a };
};
func take({ x; y = renamed } : { x : Nat; y : Nat }) : Nat { x };
func annotated({ a : Nat } : { a : Nat }) : Nat { a };

let outer = { { p = 1 } with q = 2 };
