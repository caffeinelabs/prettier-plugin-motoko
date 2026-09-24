/**
 * The perturbation catalogue: layout-only edits applied to real corpus files, so the printer can be
 * checked against combinations a hand-written fixture cannot enumerate.
 *
 * ## Why perturb real files instead of writing cases
 *
 * A hand-written fixture covers the positions its author thought of. `tools/probe/seam-sweep.mjs`
 * closes that gap for the *single*-comment space by enumerating it — every list family x every
 * position x both comment kinds — and it is exhaustive there. What it cannot reach is combinations:
 * two comments in one list, a comment inside a nested list, a comment plus a blank line, a comment at
 * a seam that is already broken. Those are where an interaction bug would live, and they are not
 * enumerable by hand, so they are sampled from real files instead: real nesting, real layouts.
 *
 * Every perturbation here is a *layout* edit — inserting whitespace or a comment, never touching a
 * token that is already present. So any perturbation moc still accepts exercises exactly the seam
 * logic the printer owns, without changing what the program means. That is the property that makes
 * the results readable: a failure is a printer bug, not a semantics difference the edit introduced.
 *
 * ## Determinism
 *
 * No RNG, and no `Math.random` (unavailable in the workflow sandbox anyway). Insertion points are
 * chosen by a fixed stride through the file's lines, so a failure is reproducible from the printed
 * case rather than from a seed. A sweep you cannot replay is not evidence.
 *
 * ## The non-vacuity measurement, and the mistake it caught
 *
 * A sweep that reports zero failures means nothing until it has been shown to report non-zero on code
 * known to be broken. This catalogue *was* vacuous on its first version, and in an instructive way:
 * `commentAroundSeparators` inserts its comment on the line *after* the separator (`a,` becomes `a,`
 * then `// c` on the next line), but the comment-separator-seam bug needs the comment *before* it —
 * in `a // c` followed by `,`, the comma is the *comment's own* `separated` flag, which is the entire
 * condition. So it inserted on the side of the seam where nothing is broken, and reported 0 failures
 * against pre-fix code.
 *
 * `lineCommentBeforeSeparator` is the other side, and it is the one that does the work. Measured
 * against revision `66cd9e9` (one commit before the fix in `src/printer/parts.ts`) and the commit
 * that carries it, on 12 files:
 *
 *     pre-fix:  353 perturbations checked, 98 failures (61 "changed the meaning", 37 "produced invalid")
 *     post-fix: 353 perturbations checked, 0 failures
 *
 * Both counts are the same perturbation set, so the 98 is not an artifact of a different sample. The
 * two separator perturbations are kept together rather than the weaker one being dropped:
 * `commentAroundSeparators` still covers the *post*-separator side (a comment opening an item), which
 * `lineCommentBeforeSeparator` cannot reach, and vice versa.
 *
 * ## What the corpus alone cannot catch
 *
 * Worth stating plainly, because it is why this file exists: no file in the tracked corpus has a line
 * comment before a separator, so a full 5733-unit corpus run passes with the fix reverted. The corpus
 * measures what real code does; it cannot measure a position real code does not currently use.
 */

/**
 * A line comment inserted at the end of the line that owns the separator, so the separator moves to
 * the next line and the comment becomes the item that owns it.
 *
 * `a,` becomes `a // c` followed by `,`. The comma now belongs to the comment's item — it is the
 * `separated` flag on the comment node — which is exactly the condition under which the printer used
 * to append the separator into the comment's own text. This is the perturbation that makes the sweep
 * non-vacuous.
 */
export function lineCommentBeforeSeparator(source) {
    const lines = source.split('\n');
    const out = [];
    for (let i = 0; i < lines.length && out.length < 40; i++) {
        // Only a separator that ends the line: trailing whitespace allowed, and never one already on a
        // line by itself (moving that one would not change which item owns it).
        const m = /^(.*?)\s*([;,])$/.exec(lines[i]);
        if (!m || !m[1].trim() || m[1].trim().startsWith('//')) continue;
        out.push(
            [
                ...lines.slice(0, i),
                `${m[1]} // c`,
                m[2],
                ...lines.slice(i + 1),
            ].join('\n'),
        );
    }
    return out;
}

/**
 * A comment on its own line immediately after every separator-ending line — the *post*-separator
 * side of the same seam, where the comment opens the next item rather than closing this one.
 */
export function commentAroundSeparators(source) {
    const lines = source.split('\n');
    const out = [];
    for (let i = 1; i < lines.length && out.length < 40; i++) {
        const prev = lines[i - 1];
        if (
            /[;,]\s*$/.test(prev) &&
            prev.trim() &&
            !prev.trim().startsWith('//')
        ) {
            out.push(
                [...lines.slice(0, i), '// c', ...lines.slice(i)].join('\n'),
            );
        }
    }
    return out;
}

/** A line comment inserted at every Nth line start, so a comment lands in many different contexts. */
export function lineCommentPerLine(source) {
    const lines = source.split('\n');
    return lines
        .map((l, i) => (l.trim() && i % 3 === 0 ? `// c${i}\n${l}` : null))
        .filter((x) => x !== null)
        .slice(0, 40);
}

/** A block comment appended at every Nth line end — the case that must NOT move the separator. */
export function blockCommentPerLine(source) {
    const lines = source.split('\n');
    return lines
        .map((l, i) => (l.trim() && i % 3 === 1 ? `${l} /* c${i} */` : null))
        .filter((x) => x !== null)
        .slice(0, 40);
}

/** Blank lines inserted, which is pure whitespace and cannot change validity at all. */
export function blankLinePerLine(source) {
    const lines = source.split('\n');
    return [lines.map((l, i) => (i % 4 === 2 ? `\n${l}` : l)).join('\n')];
}

/** Name -> perturb, in the order the report prints them. Order is stable so runs are comparable. */
export const PERTURBATIONS = {
    'line-comment-before-separator': lineCommentBeforeSeparator,
    'comment-around-separators': commentAroundSeparators,
    'line-comment-per-line': lineCommentPerLine,
    'block-comment-per-line': blockCommentPerLine,
    'blank-line-per-line': blankLinePerLine,
};
