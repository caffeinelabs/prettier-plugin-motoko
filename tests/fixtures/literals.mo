// Literals and comments — the parts of the source that are *text* rather than structure, which is
// where a round-trip most easily goes wrong.
//
// The corpus's convenience in every other fixture is that a mis-handled node usually still produces
// valid-looking output. Here it does not: an escape re-emitted as its decoded character, a non-ASCII
// character sliced at the wrong offset, or a comment treated as whitespace all change what the file
// means (or fail to lex) rather than merely moving a brace. `docs/normalize.md` §5.2's rule that
// `comment_text` is opaque source text exists for this file.

actor {
    // int_literal, with the digit-group underscores the grammar's `[0-9_]+` admits.
    let decimal = 1_000_000;

    // hex_literal, including the underscore form.
    let hex = 0xdead_beef;
    let hexUpper = 0xDEADBEEF;

    // float_literal: all five token alternatives, plus the `_num_dot` form where the dot ends the
    // number and is the projection operator rather than a decimal point.
    let floatSimple = 1.5;
    let floatFraction = 1.0;
    let floatExp = 1e10;
    let floatExpSigned = 1.5e-3;
    let floatExpDot = 1.e+3;
    let floatHex = 0x1.8p3;
    let floatHexFraction = 0x1.8p-3;

    // bool_literal / null_literal. `null` is its own production, not an identifier.
    let yes = true;
    let no = false;
    let nothing = null;

    // char_literal: an ordinary character, an escaped quote, and a backslash.
    let letter = 'a';
    let quote = '\'';
    let backslash = '\\';

    // text_literal. Escapes are the point: each must survive round-trip *as written*, since the
    // lexer accepts `\n` and a literal newline is a different (illegal) thing.
    let plain = "hello";
    let escaped = "a\nb\t\"c\\d";
    let numericEscape = "\00\ff";
    let empty = "";

    // Multi-byte, outside the BMP, and combining text. `web-tree-sitter` reports UTF-16 code-unit
    // indices, so an offset arithmetic mistake shows up here and nowhere else: a surrogate pair is
    // two code units but one character.
    let accented = "é";
    let cjk = "你好";
    let emoji = "😀🎉";
    let mixed = "a😀é你🎉z";
    let accentedChar = 'é';

    // Comment forms. `doc_comment` (`///`) is a *different token* from `line_comment` (`//`), and
    // the printer must not normalise one into the other — in Motoko `///` is documentation.
    /// A doc comment.
    // An ordinary line comment.
    /* A block comment. */
    /* A block comment with a `star` inside. */
    /* A nested /* block */ comment. */
    /* A block comment
       spanning several
       lines. */

    // A comment in an awkward position — between the callee and its arguments — which is the case
    // that forces the printer to keep a `Text` gap rather than re-joining children.
    func callee() : Nat { 1 };
    let call = callee /* between callee and args */ ();

    // A trailing comment at the end of a line, and a comment holding the characters that would
    // otherwise terminate it.
    let tail = 1; // trailing
    let tricky = 2; // a `*/` inside a line comment is not a terminator
    /* a `//` inside a block comment is not a line comment */

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
