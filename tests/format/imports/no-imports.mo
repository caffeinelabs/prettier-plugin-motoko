/// A file with no imports at all: the rule asks for no leading blank line, and a leading one in the
/// source is dropped by the ordinary blank-line rule rather than kept. The contrast with
/// `glued-section.mo` is the whole assertion — this file's first line is a declaration, not an
/// import, so nothing is invented.
let x = 1;

let y = 2;
