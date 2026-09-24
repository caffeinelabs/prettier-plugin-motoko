// An import binding nothing is dropped; the other import on the same path is not, and the
// destructured one fills in the fields.
import Array "mo:base/Array";
import {} "mo:base/Empty";
import { map; filter } "mo:base/Array";

actor {};
