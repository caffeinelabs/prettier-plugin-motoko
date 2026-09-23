/**
 * `parse.ts` — text to normalised tree, with syntax errors surfaced rather than swallowed.
 *
 * The contract with Prettier is narrow: a Prettier `parse` function either returns an AST or throws.
 * It must **never** return a partial tree that the printer then formats into wrong output. So this
 * module's whole job beyond calling the parser is to decide, before anything downstream runs,
 * whether the input is well-formed enough to format.
 *
 * "Well-formed enough" is stricter than "tree-sitter produced a tree". tree-sitter is an error-
 * recovering parser: it always produces *a* tree, inserting `ERROR` nodes for text it cannot match
 * and `MISSING` nodes for tokens the grammar required but the source did not supply. A tree
 * containing either is not the program the user wrote, so formatting it would silently rewrite code
 * the printer never understood. Both are therefore fatal here.
 *
 * The error carries a `loc` in the shape Prettier expects (`{ start: { line, column } }`,
 * 1-based line, 0-based column) so the editor puts the caret in the right place.
 *
 * A note on offsets: web-tree-sitter reports `startIndex`/`endIndex` as UTF-16 code-unit indices
 * into the string it parsed, which is exactly `String.prototype.slice`'s addressing. Every text
 * slice in this codebase therefore uses them directly against the original source string, and the
 * corpus round-trip check is what proves that convention holds for non-ASCII input too.
 */

import type { Tree } from 'web-tree-sitter';

import { createParser } from './tree-sitter.ts';
import { normalize } from './normalize.ts';
import type {
    NormalBranch,
    NormalChild,
    NormalNode,
    NormalToken,
} from './normalize.ts';

/** Prettier's expected shape for a parse error. 1-based line, 0-based column, both on `start`. */
export interface SyntaxErrorLocation {
    start: { line: number; column: number };
    end?: { line: number; column: number };
}

/**
 * A syntax error the user can act on.
 *
 * `codeFrame` is included because Prettier and the CLI print it verbatim when present, and a bare
 * "unexpected ERROR node" tells a Motoko author nothing. Keep the frame small (a few lines) so the
 * message stays readable in an editor's error banner, not just in a terminal.
 */
export class MotokoSyntaxError extends SyntaxError {
    readonly loc: SyntaxErrorLocation;
    readonly codeFrame: string;

    constructor(message: string, loc: SyntaxErrorLocation, codeFrame: string) {
        super(message);
        this.name = 'MotokoSyntaxError';
        this.loc = loc;
        this.codeFrame = codeFrame;
    }
}

/** A parse problem found by scanning the tree, before it becomes an exception. */
interface Problem {
    /** `error` for an unmatched span, `missing` for a token the grammar required but did not find. */
    kind: 'error' | 'missing';
    name: string;
    startIndex: number;
    endIndex: number;
    row: number;
    column: number;
    endRow: number;
    endColumn: number;
}

/** The result of a successful parse: the tree Prettier prints from, plus the input it came from. */
export interface ParseResult {
    /** The normalised root. `children` holds the whole file, tokens included. */
    root: NormalBranch;
    /** The source this tree was built from. Prettier's `locStart`/`locEnd` slice into it. */
    source: string;
    /** Every `ERROR`/`MISSING`-free tree has none; a non-empty list means `parse` would have thrown. */
    problems: Problem[];
}

/**
 * Find the most specific `ERROR` or `MISSING` node in the tree, in source order.
 *
 * "Most specific" matters: tree-sitter wraps an unrecognised token in an *outer* `ERROR` spanning
 * the whole failed construct. `let x = @@@ ;` produces `ERROR [6,11) "= @@@"` wrapping
 * `ERROR [8,11) "@@@"`. Reporting the outer one points the caret at the `=` and blames the wrong
 * token; the inner one is what the user actually mistyped. So an error node is reported only if
 * none of its descendants is itself an error.
 *
 * Reporting the *first* offender rather than all of them is deliberate too: one bad token often
 * produces a cascade, and listing the cascade buries the cause. `hasError` on the root is the cheap
 * pre-filter, so this walk only runs on inputs that need it.
 *
 * The flags come from the normaliser, which copies them off the wasm nodes — see `NormalToken` and
 * `NormalBranch`. Inferring them from shape instead would be a guess (a legitimate zero-width token
 * versus a `MISSING` one), and a wrong guess here means formatting unparseable code.
 */
function findProblem(root: NormalNode): Problem | null {
    function problemOf(n: NormalToken | NormalBranch): Problem {
        return {
            kind: n.missing ? 'missing' : 'error',
            // A missing node's `type` is the token the grammar wanted (`}`); an error node is
            // literally typed `ERROR` and carries its unmatched text in the span.
            name: n.type,
            startIndex: n.startIndex,
            endIndex: n.endIndex,
            row: n.startPosition.row,
            column: n.startPosition.column,
            endRow: n.endPosition.row,
            endColumn: n.endPosition.column,
        };
    }

    /** The same location as `problemOf`, but described as the enclosing rule rather than a token. */
    function problemOfBranch(n: NormalBranch): Problem {
        return {
            kind: 'error',
            name: n.type,
            startIndex: n.startIndex,
            endIndex: n.endIndex,
            row: n.startPosition.row,
            column: n.startPosition.column,
            endRow: n.endPosition.row,
            endColumn: n.endPosition.column,
        };
    }

    function walk(
        n: NormalChild,
        branchWithError: NormalBranch | null,
    ): Problem | null {
        if (n.nodeType === 'Text') return null;

        if (n.error || n.missing) {
            // Descend first: an error node may merely wrap a more precise one.
            if (n.nodeType === 'Branch') {
                for (const c of n.children) {
                    const inner = walk(c, n);
                    if (inner) return inner;
                }
            }
            return problemOf(n);
        }

        if (n.nodeType === 'Token') return null;

        // Not flagged, but this branch may be the outermost node carrying `hasError` — the only
        // thing left to point at when a descendant is zero-width. `problemOfBranch` rather than
        // `problemOf`, because `kind: 'missing'` here would be a guess: it is the *rule* that
        // failed to reach its end, not a token the grammar asked for by name.
        const enclosing = n.hasError ? n : branchWithError;

        // A zero-width non-root branch is a missing-token site by construction: it consumed nothing
        // and the grammar only marks a node `hasError` when something inside it failed to match.
        // Reporting it beats falling off the end of this walk and blaming the whole file.
        //
        // This is not hypothetical — `include I;` reaches it. Real Motoko wants an *expression*
        // after `include`, so `I;` fails; the grammar recovers by inserting a zero-width
        // `lit_exp > float_literal` (borrowed from the number-literal recovery rule) and setting
        // `hasError` on it. Neither `isError` nor `isMissing` is set anywhere in that tree, so the
        // flagged-node walk finds nothing. Without this clause the caller's guess-the-bug guard
        // fires and tells the user to report a normaliser bug for perfectly ordinary syntax.
        if (n.startIndex === n.endIndex && enclosing)
            return problemOfBranch(enclosing);

        for (const c of n.children) {
            const found = walk(c, enclosing);
            if (found) return found;
        }
        return null;
    }

    return walk(root, null);
}

/**
 * A short, line-numbered excerpt centred on the offending line.
 *
 * Two lines of context on each side: enough to see the construct, short enough to read in a
 * terminal. The caret line is padded to the error column, counting characters rather than bytes so
 * a multi-byte character earlier on the line does not skew it.
 */
function codeFrame(source: string, row: number, column: number): string {
    const lines = source.split('\n');
    const first = Math.max(0, row - 2);
    const last = Math.min(lines.length - 1, row + 2);
    const gutter = String(last + 1).length;
    const out: string[] = [];

    for (let i = first; i <= last; i += 1) {
        const num = String(i + 1).padStart(gutter, ' ');
        out.push(`${num} | ${lines[i]}`);
        if (i === row)
            out.push(`${' '.repeat(gutter)} | ${' '.repeat(column)}^`);
    }
    return out.join('\n');
}

/**
 * Parse Motoko source into a normalised tree.
 *
 * Throws `MotokoSyntaxError` when the grammar could not account for the whole input. Returns the
 * normalised root otherwise — which, because the round-trip check in the corpus harness runs over
 * the same tree, is guaranteed to contain every byte of `source`.
 */
export async function parse(source: string): Promise<ParseResult> {
    const parser = await createParser();
    let tree: Tree | null;
    try {
        tree = parser.parse(source);
    } finally {
        // The parser holds wasm memory; the tree we keep is a separate object and stays valid.
        // Freeing here means a long formatting run does not leak a parser per file.
        parser.delete();
    }

    if (!tree) {
        throw new MotokoSyntaxError(
            'Motoko parser returned no tree for this input.',
            {
                start: { line: 1, column: 0 },
            },
            '',
        );
    }

    try {
        const root = normalize(tree.rootNode, source);

        // `hasError` is the cheap filter; only a tree that claims an error pays for the walk.
        // It is checked against the wasm node rather than the normalised root so the filter and the
        // walk cannot disagree about whether an error exists at all.
        if (tree.rootNode.hasError) {
            const problem = findProblem(root);
            if (problem) {
                const line = problem.row + 1;
                const what =
                    problem.kind === 'error'
                        ? 'Unexpected input'
                        : `Missing ${problem.name === '}' ? 'closing brace' : `\`${problem.name}\``}`;
                const where = `${line}:${problem.column + 1}`;
                const end =
                    problem.endRow === problem.row
                        ? { line, column: problem.endColumn }
                        : {
                              line: problem.endRow + 1,
                              column: problem.endColumn,
                          };
                throw new MotokoSyntaxError(
                    `${what} at ${where}.`,
                    { start: { line, column: problem.column }, end },
                    codeFrame(source, problem.row, problem.column),
                );
            }
            // `hasError` was set but the walk still located nothing. Every reachable recovery this
            // grammar performs is covered by the zero-width clause in `findProblem`, so reaching
            // here means a recovery shape nobody has seen yet. Blaming the whole file would be a
            // lie; failing loudly is the point of the guard being upstream.
            throw new MotokoSyntaxError(
                'Parser reported an error but no offending node was found. This is a bug in the ' +
                    'normaliser, not in your code — please report it.',
                { start: { line: 1, column: 0 } },
                '',
            );
        }

        return { root, source, problems: [] };
    } finally {
        tree.delete();
    }
}
