// Object, module, actor and class bodies, and the anonymous `object { ... }` / `actor { ... }`
// expressions. `obj_body` recurses, so each nesting level is deliberate.
let anon = object {
    public let x = 1;
    public func f() : Nat { 1 };
};
let anonEmpty = object {};
let actorExp = actor {
    public func f() : Nat { 1 };
    public func g() : Nat { 2 };
};
let annotated = actor : actor { f : () -> async Nat } {
    public func f() : async Nat { 1 };
};
module Inner {
    public let g = 1;
};
object Named {
    public func h() : Nat { 1 };
};
class Klass(x : Nat) {
    public let v = x;
    public func get() : Nat { v };
};
shared actor class Boxed<T>(init : T) {
    public var value = init;
    public func set(v : T) : () { value := v };
};
let mix = mixin (y : Nat) {
    public let m = y;
};
actor Palindrome {};
