// The import section is left alone when a statement in it is missing its `;`.
//
// The grammar accepts `import` as an ordinary identifier in expression position, so once the first
// statement has no terminator the second one stops being an `import` branch at all and is parsed as a
// **call expression** `import(Text)("mo:base/Text")`. A pass that walked sibling nodes and stopped at
// the first non-import would read a section one import long, leave the rest in the tail, and re-space
// it — a partial rewrite, so `format(format(x))` differed from `format(x)` on the blank line between
// the two imports. The pass now refuses a section containing such a node, leaving the file exactly as
// written. moc rejects this input too (`unexpected token 'import'`), so there is no correct rewrite to
// be had; the only obligation is to not half-apply one.
import Array "mo:base/Array"
import Text "mo:base/Text";

actor {};
