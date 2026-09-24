// A comment before the first import is the file's header and stays above the section. Comments
// *inside* the section hoist to a block below the imports, which is the legacy suite's pinned
// behaviour. Both are separated from the code by a blank line.
// Base library imports
import Text "mo:base/Text";
// Utility imports
import Utils "./utils";
import Array "mo:base/Array";

actor {};
