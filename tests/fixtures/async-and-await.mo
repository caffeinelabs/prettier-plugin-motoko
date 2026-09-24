actor {
    func plain() : async Nat {
        let f = async { 1 };
        await f;
    };

    func compositeFut() : async* Nat {
        1;
    };

    func compositeLit() : async* Nat {
        await* (async* { 2 });
    };

    func awaitComposite() : async Nat {
        let f : async* Nat = compositeFut();
        await* f;
    };

    func awaitMaybe(f : async Nat) : async Nat {
        let g = await? f;
        g;
    };

    func unaries(f : async Nat, c : Bool) : async () {
        let shown = debug_show (1, c);
        let truth = debug c;
        debug c;
        ignore (shown, truth, await f);
    };

    func candid() : async () {
        let bytes : Blob = to_candid (1, 2);
        let back : (Nat, Nat) = from_candid bytes;
        ignore back;
    };

    func awaitHead(f : async Bool) : Nat {
        if await f { 1 } else { 0 };
    };

    func awaitStarHead(f : async* Bool) : Nat {
        if await* f { 1 } else { 0 };
    };

    public query func readonly() : async Nat { 1 };
    public shared func write() : async () {};
    public shared ({ caller }) func withCaller() : async () { ignore caller };
    public shared func awaitInside() : async () { await async {} };
};
