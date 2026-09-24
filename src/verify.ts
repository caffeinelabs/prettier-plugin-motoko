/**
 * Runtime guard: every format call re-parses its own output and compares trees, throwing on a difference.
 *
 * A printer bug is caught by a parse rather than by review, so it cannot ship a silent meaning change even if fixtures miss the case.
 * The comparison is structural because reformatting moves every offset and gap, so a textual one would fail on correct output.
 * `shapeOf` reports every difference; the tolerance list below is applied here rather than inside `shapeOf`,
 * so a rewrite that adds an unforgiven node still fails.
 */

import { parse } from './parser/parse.ts';
import { shapeOf } from './parser/normalize.ts';
import type {
    NormalBranch,
    NormalChild,
    NormalNode,
} from './parser/normalize.ts';

/** A plain `Error`, not a `SyntaxError`: the input was well-formed, the printer is what went wrong. Prettier writes nothing. */
export class VerifyError extends Error {
    /** 1-based line, 0-based column, the shape Prettier's own errors use. */
    readonly loc: { line: number; column: number };

    constructor(message: string, loc: { line: number; column: number }) {
        super(`prettier-plugin-motoko: internal error — ${message}`);
        this.name = 'VerifyError';
        this.loc = loc;
    }
}

/** A node kind the printer is allowed to have introduced or removed. */
interface Tolerance {
    readonly reason: string;
}

// Empty: with no rewrite passes, `preserve` must be exactly structure-preserving. Each rewrite rule adds one entry for the kind it edits,
// never a default, so the guard still sees printer bugs like dropped parens.
const TOLERATED_KINDS: ReadonlyMap<string, Tolerance> = new Map();

function tolerated(shape: unknown): boolean {
    if (!Array.isArray(shape) || typeof shape[0] !== 'string') return false;
    return TOLERATED_KINDS.has(shape[0]);
}

/** One difference between the input tree and the output tree, with enough context to locate it. */
export interface ShapeDifference {
    /** Dotted path of child indices from the root. */
    path: string;
    /** What the input tree had, or `null` if the output tree added this node. */
    input: unknown;
    /** What the output tree has, or `null` if the output tree dropped this node. */
    output: unknown;
}

function show(shape: unknown): string {
    if (shape === null || shape === undefined) return '<absent>';
    return JSON.stringify(shape, null, 0).slice(0, 200);
}

// A token shape is `~?type:text`. Matched on the prefix because the comparator only sees the `unknown` projection, not the node.
function isLineCommentShape(shape: string): boolean {
    return /^~?(line_comment|doc_comment):/.test(shape);
}

/**
 * Token equality, forgiving trailing whitespace on a line comment.
 *
 * A line comment always ends at a line end, and `printDocToString` trims trailing whitespace there, so `/// doc ` comes back as `/// doc`.
 * A block comment stays strict: mid-line nothing trims it, so a dropped space there is a real bug.
 */
function sameToken(input: string, output: string): boolean {
    if (input === output) return true;
    if (!isLineCommentShape(input) || !isLineCommentShape(output)) return false;
    return input.replace(/\s+$/, '') === output.replace(/\s+$/, '');
}

/**
 * Compare two `shapeOf` trees, returning the first difference in source order or `null` when they agree.
 *
 * Typed as `unknown` because a typed view would have to be re-derived from `NODE_KINDS` and would drift.
 * The checks are exhaustive over the shapes: `null` for a gap, a `string` for a token, an array for a branch.
 */
export function compareShapes(
    input: unknown,
    output: unknown,
    path = '',
): ShapeDifference | null {
    if (input === null && output === null) return null;

    // `shapeOf` drops gaps from child lists, so one `null` side here means a real node on the other.
    if (typeof input === 'string' && typeof output === 'string') {
        return sameToken(input, output)
            ? null
            : { path, input: input, output: output };
    }

    if (Array.isArray(input) && Array.isArray(output)) {
        // A branch shape is `[kind, mode?, children]`: the head is compared here, the children walked below.
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

        // A tolerated kind is compared by kind only, since walking its children would re-report the edit the tolerance allows.
        if (tolerated(input) && tolerated(output) && input[0] === output[0])
            return null;

        // Reported as a count so the message is about the list, not an `undefined` child past its end.
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
 * Re-parse `printed` and throw `VerifyError` on the first difference from `expected`.
 *
 * `expected` is the input tree, not one the printer produced, or the check would be vacuous.
 * A rewriting syntax such as `moc2` passes the rewritten tree instead, since the rewrite is the intended change.
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
 * `shapeOf` drops gap nodes, so path indices skip `Text` children; the walk replays the same drop.
 * An unfollowable path stops at the deepest node reached, and the path string is in the message anyway.
 */
function locate(
    root: NormalNode,
    path: string,
): { line: number; column: number } {
    let node: NormalChild = root;
    const steps = path.split('.').slice(1); // the leading element is the empty root segment

    for (const step of steps) {
        // A typed local, since TypeScript cannot narrow `node` while the loop reassigns it.
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
