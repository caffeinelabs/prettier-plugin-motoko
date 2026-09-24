// Three statements for one path fold into one: the plain binding stays its own statement, and the
// destructured fields combine and sort. `import Array ...` must not be merged into the braces.
import Array "mo:base/Array";
import { map } "mo:base/Array";
import { filter } "mo:base/Array";
import { fold } "mo:base/Array";

actor {};
