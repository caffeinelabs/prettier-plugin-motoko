/// Comments belong to the import section, not to the code below it. The header comment above the
/// imports and the note glued to the last one are both part of "the imports", so the blank goes
/// before `actor` — and *not* before the commented-out import in the middle, which is the case that
/// distinguishes "the section is the leading run of imports and comments" from "the section ends at
/// the first thing that is not an import".
//
// The commented-out third import is the point of this file; do not "fix" it.
import A "A";
// import B "B";
import C "C";
actor {};

// A note that the source separated from the section with a blank line of its own. That blank is
// the author's, and the rule keeps it — the section's blank is not added on top of it.
object Tail {
    public let x = 1;
};
