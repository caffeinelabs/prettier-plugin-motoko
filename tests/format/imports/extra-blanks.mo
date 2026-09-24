/// The import section, already canonical, with a blank line inside the run and two after it. Both
/// collapse to one: the section's own blank goes where `docs/style.md:114-130` puts it, and the
/// ordinary "at most one blank" rule handles the rest.
import A "A";

import { B; C } "BC";


actor {};
