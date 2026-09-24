actor {
    let decimal = 1_000_000;

    let hex = 0xdead_beef;
    let hexUpper = 0xDEADBEEF;

    let floatSimple = 1.5;
    let floatFraction = 1.0;
    let floatExp = 1e10;
    let floatExpSigned = 1.5e-3;
    let floatExpDot = 1.e+3;
    let floatHex = 0x1.8p3;
    let floatHexFraction = 0x1.8p-3;

    let yes = true;
    let no = false;
    let nothing = null;

    let letter = 'a';
    let quote = '\'';
    let backslash = '\\';

    let plain = "hello";
    let escaped = "a\nb\t\"c\\d";
    let numericEscape = "\00\ff";
    let empty = "";

    let accented = "é";
    let cjk = "你好";
    let emoji = "😀🎉";
    let mixed = "a😀é你🎉z";
    let accentedChar = 'é';

    /// A doc comment.
    // An ordinary line comment.
    /* A block comment. */
    /* A nested /* block */ comment. */

    func callee() : Nat { 1 };
    let call = callee /* between callee and args */ ();

    let tail = 1; // trailing
    let tricky = 2; // a `*/` inside a line comment is not a terminator

    ignore (
        decimal,
        hex,
        hexUpper,
        floatSimple,
        floatFraction,
        floatExp,
        floatExpSigned,
        floatExpDot,
        floatHex,
        floatHexFraction,
        yes,
        no,
        nothing,
        letter,
        quote,
        backslash,
        plain,
        escaped,
        numericEscape,
        empty,
        accented,
        cjk,
        emoji,
        mixed,
        accentedChar,
        call,
        tail,
        tricky,
    );
};
