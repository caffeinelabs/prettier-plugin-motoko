// The pass must refuse this file, not rewrite it: the comment is a *child of the `import` branch*
// (measured), so a pass reading only siblings would silently drop it. Refusal means the option is a
// no-op here and the import is printed as written — comment, both fields, and the `⛔` path intact.
// This is a real corpus shape: motoko/test/run/file-import.mo has exactly it.
import { debugPrint; /*encodeUtf8;*/ decodeUtf8 } "mo:⛔";

actor {};
