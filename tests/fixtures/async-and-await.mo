// Asynchrony: `async`, `async*`, the three `await` forms, and the sibling unary operators that share
// their production (`debug_show`, `from_candid`, `to_candid`, `debug`).
//
// These are rare in the corpus — `async*` and `await*`/`await?` are near-absent outside the compiler's
// own tests — and the three `await` forms differ only by a one-character suffix on the keyword, so a
// printer that grouped them by a shared prefix would corrupt two of the three without any corpus file
// noticing. Each is spelled out with its own binding so the round-trip has to keep them apart.
//
// `await?` and `await*` are single tokens (`awaitquest_exp`, `awaitstar_exp`), not `await` followed by
// an operator, and `async*` is the *composite* future flavour rather than a typo for `async`.

actor {
    // async_exp: the plain future, both as an expression and awaited.
    func plain() : async Nat {
        let f = async { 1 };
        await f;
    };

    // asyncstar_exp. `async*` takes no parenthetical and no `<system>`.
    func compositeFut() : async* Nat {
        1;
    };

    // The literal is the construct under test here, in a position where it is the whole expression.
    func compositeLit() : async* Nat {
        await* (async* { 2 });
    };

    // awaitstar_exp — the matching consumer. Awaiting an `async*` needs `await*`; a bare `await` is a
    // type error, so the distinction is load-bearing rather than cosmetic.
    func awaitComposite() : async Nat {
        let f : async* Nat = compositeFut();
        await* f;
    };

    // awaitquest_exp. `await?` is a single token and its operand is an *expression*, not a body, so
    // `await? async { 1 }` is a syntax error in moc as well as here. Bind first instead.
    func awaitMaybe(f : async Nat) : async Nat {
        let g = await? f;
        g;
    };

    // The `await` operands share a production with the other `_exp_nest` unaries.
    func unaries(f : async Nat, c : Bool) : async () {
        let shown = debug_show (1, c);
        let truth = debug c;
        debug c;
        ignore (shown, truth, await f);
    };

    // to_candid_exp is a parenthesised *list*; from_candid_exp is a unary operator over an
    // expression. `from_candid` needs a known type from context, hence the annotation.
    func candid() : async () {
        let bytes : Blob = to_candid (1, 2);
        let back : (Nat, Nat) = from_candid bytes;
        ignore back;
    };

    // The await family in head position. `await f { }` reads `{ }` as the head's *body*, so these are
    // the aliased `*_head` rules that `HEAD_SYMBOL_IDS` has to catch.
    func awaitHead(f : async Bool) : Nat {
        if await f { 1 } else { 0 };
    };

    func awaitStarHead(f : async* Bool) : Nat {
        if await* f { 1 } else { 0 };
    };

    // `shared`/`query`/`<system>` on the declaration, which is where asynchrony meets visibility.
    public query func readonly() : async Nat { 1 };
    public shared func write() : async () {};
    public shared ({ caller }) func withCaller() : async () { ignore caller };
    public shared func awaitInside() : async () { await async {} };
};
