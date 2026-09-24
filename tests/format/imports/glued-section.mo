/// The import section, glued: the source wrote no blank line after the last import, and the rule
/// wants exactly one. This is the case the printer *invents* a blank for, and the one that makes
/// the rule an exception to "a blank line is never invented" (`docs/style.md:114-130`).
import A "A";
import B "B";
actor {};
