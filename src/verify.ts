/**
 * The runtime guard: every format call re-parses its own output and compares trees.
 *
 * `docs/formatter-rework.md` §"Verification" layer 2 makes this the plugin's central safety
 * property, and it is the reason the printer can be built one kind at a time:
 *
 * > **Runtime guard** (`verify.ts`, always on, no opt-out). **A failure throws.** The format errors
 * > with the first differing node and its location, and never writes output. Re-parse the output.
 * > It must contain no `ERROR`/`MISSING`. Its normalised tree (types, fields, token texts) must
 * > equal the input tree, or the rewritten tree for `moc2`. The comment texts must match in order.
 * > Prettier's own "comment was not printed" check covers dropped comments.
 *
 * What that buys: a printer bug is caught by a *parse* rather than by review, so a wrong area
 * printer cannot ship a silent meaning change even if its fixtures miss the case. The guard is
 * compared against the input tree (`options.originalText` re-parsed), never the printed text, so it
 * is a statement about meaning and not about layout.
 *
 * ## Why the comparison is structural and not textual
 *
 * Reformatting moves every offset and changes every `Text` gap, so a textual comparison would fail
 * on the first correctly-formatted file. `shapeOf` (`parser/normalize.ts`) projects a tree onto
 * `[kind, mode, children]` with tokens as `type:text` strings — kinds, fields and token texts, no
 * positions — which is exactly the tuple this module's spec names. It reports *everything*, and the
 * tolerance list below is the rewrite's edit log, applied here rather than baked into `shapeOf`, so
 * that a rewrite which adds an unforgiven node still fails.
 *
 * ## Cost
 *
 * One extra parse per format call. `tree-sitter.ts` memoises the wasm parser, so this is the parse
 * itself and not the initialisation, and it is the price the plan explicitly accepts in exchange for
 * never writing wrong code.
 */

import { parse } from './parser/parse.ts';
import { shapeOf } from './parser/normalize.ts';
import type {
    NormalBranch,
    NormalChild,
    NormalNode,
} from './parser/normalize.ts';

/**
 * A guard failure, carrying the location a reader needs to see the bug.
 *
 * A plain `Error` rather than a `SyntaxError`: the input was well-formed — that is a precondition of
 * reaching the guard — and what went wrong is the *printer*. Prettier surfaces this as a format
 * failure and writes nothing, which is the required behaviour.
 */
export class VerifyError extends Error {
    /** 1-based line, 0-based column, the shape Prettier's own errors use. */
    readonly loc: { line: number; column: number };

    constructor(message: string, loc: { line: number; column: number }) {
        super(`prettier-plugin-motoko: internal error — ${message}`);
        this.name = 'VerifyError';
        this.loc = loc;
    }
}

/** A node kind the printer is allowed to have introduced or removed, with the plan row that grants it. */
interface Tolerance {
    /** `docs/formatter-rework.md` §"Units"/§"Goal 1" names these; the string is the report's wording. */
    readonly reason: string;
}

/**
 * Kinds whose absence or presence the guard forgives.
 *
 * Deliberately empty in the M2 skeleton, and that is the honest state rather than an oversight: with
 * no rewrite passes compiled in, `preserve` must be *exactly* structure-preserving, so the correct
 * number of forgiven differences is zero. `M3` adds entries here as it adds rewrite rules, one per
 * rule, each citing the row of `docs/formatter-rework.md` that permits it — a `ParP` it unwrapped, a
 * single-expression `BlockE` it added, a `;` it dropped. A guard that forgave these by default would
 * be unable to see the bugs the plan's self-test plants (dropping a juxtaposed-application head's
 * parens, bracing a `func … = e` body), so the list is the *tolerance*, not the mechanism.
 */
const TOLERATED_KINDS: ReadonlyMap<string, Tolerance> = new Map();

/** Whether a shape node is one the tolerance list forgives. */
function tolerated(shape: unknown): boolean {
    if (!Array.isArray(shape) || typeof shape[0] !== 'string') return false;
    return TOLERATED_KINDS.has(shape[0]);
}

/** One difference between the input tree and the output tree, with enough context to locate it. */
export interface ShapeDifference {
    /** Dotted path of child indices from the root, so a report can point at the node. */
    path: string;
    /** What the input tree had, or `null` if the output tree added this node. */
    input: unknown;
    /** What the output tree has, or `null` if the output tree dropped this node. */
    output: unknown;
}

/** A human-readable rendering of one side of a difference, shortened to stay on one report line. */
function show(shape: unknown): string {
    if (shape === null || shape === undefined) return '<absent>';
    return JSON.stringify(shape, null, 0).slice(0, 200);
}

/**
 * Whether a shape string is a line comment, whose trailing whitespace Prettier always trims.
 *
 * A shape string is `` `${named ? '' : '~'}${type}:${text}` `` (`parser/normalize.ts:513`), and a
 * line comment is a `Token` rather than a `Branch` — `parts.ts:COMMENT_KINDS` documents that split.
 * So the marker is the `` line_comment: `` / `` doc_comment: `` prefix, with or without the `~`.
 *
 * Matched on the prefix rather than by re-deriving the shape because the caller here only has the
 * `unknown` projection: threading the node through would make the comparator's signature depend on
 * the normaliser's types, which `compareShapes` deliberately avoids.
 */
function isLineCommentShape(shape: string): boolean {
    return /^~?(line_comment|doc_comment):/.test(shape);
}

/**
 * Compare two token shape strings, allowing the one difference Prettier itself introduces.
 *
 * A **line comment runs to the end of its line by definition**, so any horizontal whitespace at the
 * end of its text sits at a line end — and `printDocToString` strips trailing whitespace from every
 * line it terminates with a `hardline` or `line` (but not a `literalline`, `.probe/_trim.mts`). So
 * `/// doc ` in the source comes back as `/// doc`, and that is not a printer bug: the printer
 * emitted the text faithfully and Prettier's line writer trimmed it.
 *
 * Only the *trailing* run is forgiven, and only for a line comment. A block comment's plain-text tail
 * is left strict: mid-line it is followed by more code rather than a break, so nothing trims it, and
 * a real dropped space there should still fail. If the corpus turns up a block comment at a line end
 * whose space is trimmed, the honest fix is to extend this with a case that shows it.
 */
function sameToken(input: string, output: string): boolean {
    if (input === output) return true;
    if (!isLineCommentShape(input) || !isLineCommentShape(output)) return false;
    return input.replace(/\s+$/, '') === output.replace(/\s+$/, '');
}

/**
 * Compare two `shapeOf` trees, returning the first difference or `null` when they agree.
 *
 * Depth-first and left-to-right, so the reported difference is the first in source order — the same
 * rule `parse.ts:findProblem` uses for syntax errors, and for the same reason: an early structural
 * difference makes every later one noise.
 *
 * The walk is deliberately written against the raw `unknown` that `shapeOf` returns rather than a
 * declared type. `shapeOf`'s output is a projection of the grammar, so a typed view here would have
 * to be re-derived from `NODE_KINDS` and would drift; the actual shapes are small and the checks
 * below are exhaustive over them (`null` for a gap, a `string` for a token, an array for a branch).
 */
export function compareShapes(
    input: unknown,
    output: unknown,
    path = '',
): ShapeDifference | null {
    if (input === null && output === null) return null;

    // A gap (`Text`) is `null` in the shape and carries no meaning, so its presence or absence is
    // not a difference — only its *neighbours* are. `shapeOf` already drops gaps from the child
    // list, so reaching here with one `null` side means a real node on the other side.
    if (typeof input === 'string' && typeof output === 'string') {
        return sameToken(input, output)
            ? null
            : { path, input: input, output: output };
    }

    if (Array.isArray(input) && Array.isArray(output)) {
        // The head of a branch shape is its kind, then optionally its mode, then the children. A
        // mismatch in any of the first two is reported at this path; the third is walked.
        const head = Math.min(input.length, output.length) - 1;
        for (let i = 0; i < head; i += 1) {
            if (input[i] !== output[i]) {
                return {
                    path: `${path}[${i}]`,
                    input: input[i],
                    output: output[i],
                };
            }
        }

        const inputKids = input[input.length - 1];
        const outputKids = output[output.length - 1];
        if (!Array.isArray(inputKids) || !Array.isArray(outputKids)) {
            return { path, input, output };
        }

        // A tolerated kind is compared *by kind only*: its children are the rewrite's business, and
        // walking them would re-report the very edit the tolerance exists to allow. `TOLERATED_KINDS`
        // is empty until M3, so this branch is unreachable today and is here so that adding a rewrite
        // rule does not also require remembering to extend the comparator.
        if (tolerated(input) && tolerated(output) && input[0] === output[0])
            return null;

        // A different number of children is itself a difference, and reporting it here rather than
        // letting the `i` loop run off the end keeps the message about the list, not about a
        // `undefined` child that never existed.
        if (inputKids.length !== outputKids.length) {
            return {
                path,
                input: inputKids.length,
                output: outputKids.length,
            };
        }

        for (let i = 0; i < inputKids.length; i += 1) {
            const diff = compareShapes(
                inputKids[i],
                outputKids[i],
                `${path}.${i}`,
            );
            if (diff) return diff;
        }
        return null;
    }

    return { path, input, output };
}

/**
 * Re-parse `printed` and check it against the tree the printer was given.
 *
 * Throws `VerifyError` on the first difference. Returns normally when the two trees agree, which is
 * the only case in which Prettier is allowed to write the output.
 *
 * `expected` is the **input** tree (`options.originalText`), not the printer's own view of it: the
 * guard's job is to prove the printer did not invent meaning, and comparing against a tree the
 * printer produced would make it vacuous for the `moc2` case where the printer's tree is a rewrite.
 * For `moc2` the caller passes the *rewritten* tree, which is the plan's wording ("or the rewritten
 * tree for `moc2`"), because the rewrite is the intended change and the guard covers what happens
 * *after* it.
 */
export async function verifyOutput(
    expected: NormalNode,
    printed: string,
): Promise<void> {
    let actual: NormalBranch;
    try {
        ({ root: actual } = await parse(printed));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new VerifyError(
            [
                'the printer produced code that does not parse.',
                '',
                message,
                '',
                'This is a bug in the printer. The input has been left unformatted rather than',
                'written in a form that means something else. Please report it with the input.',
            ].join('\n'),
            { line: 1, column: 0 },
        );
    }

    const diff = compareShapes(shapeOf(expected), shapeOf(actual));
    if (diff) {
        const at = locate(expected, diff.path);
        throw new VerifyError(
            [
                'the printer changed the meaning of this file.',
                '',
                `first difference at ${diff.path} (input line ${at.line}):`,
                `  input:  ${show(diff.input)}`,
                `  output: ${show(diff.output)}`,
                '',
                'This is a bug in the printer. The input has been left unformatted rather than',
                'written in a form that means something else. Please report it with the input.',
            ].join('\n'),
            at,
        );
    }
}

/**
 * Turn a `compareShapes` path into a source location.
 *
 * The path is a dotted chain of child indices, and `shapeOf` drops gap nodes, so it does **not**
 * address `node.children` positionally — the walk below replays the same drop. Falling back to the
 * root's own start when the path cannot be followed (a shape the walk does not recognise) is
 * deliberate: a wrong line number is worse than none, and the path string is in the message anyway
 * for a reader who needs to find it by hand.
 */
function locate(
    root: NormalNode,
    path: string,
): { line: number; column: number } {
    let node: NormalChild = root;
    const steps = path.split('.').slice(1); // the leading element is the empty root segment

    for (const step of steps) {
        // A typed local rather than a narrowing, because `node` is reassigned in this loop and
        // TypeScript cannot infer `semantic` without the loop's own reassignment feeding back in.
        const branch: NormalBranch | null =
            node.nodeType === 'Branch' ? node : null;
        if (!branch) break;
        const semantic: NormalChild[] = branch.children.filter(
            (c: NormalChild) => c.nodeType !== 'Text',
        );
        const index = Number(step);
        if (!Number.isInteger(index) || index < 0 || index >= semantic.length)
            break;
        node = semantic[index];
    }

    return {
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
    };
}
