/**
 * The normalised tree: plain objects we own, with no wasm handles, safe to compare and to walk.
 *
 * Why not use tree-sitter's `Node` objects directly? Two reasons, both load-bearing:
 *
 * 1. **Lifetime.** `Node` values are views into wasm memory owned by a `Tree`. The moment the tree
 *    is deleted the nodes are garbage. The runtime guard (`verify.ts`) holds onto the *input*
 *    tree's shape after the printer has run, and rewrites need to build new shapes. Plain objects
 *    make both possible without lifetime discipline.
 * 2. **The token round-trip check.** Re-concatenating every token plus the gaps between them must
 *    reproduce the input byte for byte. That check is what proves the normaliser loses nothing,
 *    which is the precondition for trusting the printer's output to be a function of the whole
 *    input. It needs tokens as first-class children with offsets, and it needs `Text` for the
 *    whitespace/comments *between* them, which a plain-object tree can hold.
 *
 * Design notes that a reader will otherwise trip over:
 *
 * - `type` is the **alias** name as the tree reports it (`call_exp_object`), while `kind` is the
 *   alias suffix stripped (`call_exp`) and `mode` is which suffix it was (`object`). The generated
 *   `NODE_KINDS` is keyed by `kind`, so a printer `switch` on `kind` is exhaustive over the
 *   grammar, and each case can consult `mode`. See `docs/normalize.md`.
 * - `set` distinguishes a grammar field set to `null` from an absent field, exactly as tree-sitter
 *   does. Do not drop it: it is part of the shape comparison.
 * - Comments are *not* stripped here. They stay in the tree as ordinary children so the corpus
 *   harness's round-trip can see them. A later pass (M2, Prettier comment attachment) decides how
 *   they are attached for printing. `collapsed` is reserved for that pass and is always `false` at
 *   M1.
 */

import type { Node as TsNode, Point } from 'web-tree-sitter';

import { HEAD_SYMBOL_IDS, NODE_KINDS } from './nodes.generated.ts';
import type { NodeKind, NodeMode } from './nodes.generated.ts';

/** A source position. `row` is 0-based; `column` counts characters, not bytes (see `toDiagnostic`). */
export interface NormalPoint {
    row: number;
    column: number;
}

/** A source span, in byte offsets and in positions. */
export interface NormalSpan {
    startIndex: number;
    endIndex: number;
    startPosition: NormalPoint;
    endPosition: NormalPoint;
}

/** A terminal: a leaf with no children and no fields. Either a named token (`identifier`, a
 * literal part) or an anonymous one (`{`, `;`, `=`, `if`). */
export interface NormalToken extends NormalSpan {
    nodeType: 'Token';
    type: string;
    named: boolean;
    extra: boolean;
    /** Sliced from the source at `[startIndex, endIndex)`. */
    text: string;
    /** tree-sitter's `isError`: this leaf is unmatched input. Fatal to formatting. */
    error: boolean;
    /** tree-sitter's `isMissing`: a zero-width token the grammar required but the source lacked. */
    missing: boolean;
}

/** A non-terminal: a node with children. */
export interface NormalBranch extends NormalSpan {
    nodeType: 'Branch';
    /** The alias as the tree reports it, e.g. `call_exp_object`. */
    type: string;
    /** The alias suffix stripped. Keyed into `NODE_KINDS`; a printer switch is exhaustive over it. */
    kind: NodeKind;
    /** Which alias family `type` came from, or `null` when the kind has no mode family. */
    mode: NodeMode | null;
    /**
     * tree-sitter's `grammarId` — the id of the rule that produced this node, *before* aliasing.
     *
     * Kept because it is the only way to recover head mode later: an aliased head node reports a
     * visible `type` it shares with a non-head node, so any pass that wants to re-ask "was this
     * head?" (the M3 rewrite, the runtime guard) needs the id, not the name. Cheap to carry, and
     * dropping it would force re-derivation from a tree the normaliser no longer has.
     */
    grammarId: number;
    named: boolean;
    extra: boolean;
    /** Field name of this node in its parent, or `null`. */
    field: string | null;
    /** Children in source order, tokens included, plus any `Text` gaps (see `normalize`). */
    children: NormalChild[];
    /** Populated by the corpora that carry explicit fields on the node itself (`cards: [ _age ]`). */
    fields: Record<string, NormalNode>;
    /** Fields that were present but explicitly `null` in the grammar's field set. */
    set: string[];
    /** M2 comment attachment sets this. Always `false` at M1. */
    collapsed: boolean;
    /** tree-sitter's `isError` on this branch. Fatal to formatting, like the token flag. */
    error: boolean;
    /** tree-sitter's `isMissing` on this branch. Rare (branches are usually `ERROR`), but carried
     * for the same reason the token flag is: `parse.ts` must not have to guess. */
    missing: boolean;
    /**
     * tree-sitter's `hasError` on this branch: some node at or below here failed to match.
     *
     * Carried separately from `error` because the two disagree in exactly the case `parse.ts` has to
     * handle — the grammar can recover from a failure by inserting a zero-width node and flagging
     * only the *enclosing* node, leaving no `isError`/`isMissing` anywhere in the subtree. Without
     * this flag there is nothing to point at and no way to tell "the source is bad" from "we lost
     * the error", so `parse.ts`'s offender walk needs it to locate the failure.
     */
    hasError: boolean;
    /** Reconstructed from `children`. For a root/file node this is the whole input. */
    text: string;
}

export type NormalNode = NormalToken | NormalBranch;

/** `NormalNode` covers the semantic nodes; `NormalChild` additionally allows the whitespace gaps. */
export type NormalChild = NormalNode | NormalText;

/**
 * The gap between two child nodes: whitespace, and nothing else.
 *
 * Comments are tree children (`extras`), so a gap never contains one — but a gap may be non-empty
 * purely because of whitespace, and the round-trip needs it. `position` shifts when a source text
 * node (`template_chunk`) appears, because that changes the byte↔offset mapping; `adjust` applies it.
 */
export interface NormalText extends NormalSpan {
    nodeType: 'Text';
    text: string;
    /** Set only inside a source-text container, to shift the following offsets. */
    position: number | null;
    adjust: number;
}

/** Suffix families the grammar aliases nodes into. Mirrors `tools/gen-node-types.ts`. */
const MODE_SUFFIXES: readonly string[] = ['_block', '_object'];

/**
 * Node kinds that are **leaves to us even though tree-sitter reports children for them**.
 *
 * `comment_text` is `repeat1(token(prec(1, /.|\n|\r/)))` — one token per character. A nested block
 * comment inside it is therefore a real child node, but the surrounding characters are separate
 * per-character tokens that the CST API hides, so `comment_text`'s span is *not* the union of its
 * children's spans. Reconstructing it from children is impossible; slicing it from the source is
 * exact. Treating it as a leaf is what makes the round-trip hold.
 *
 * The consequence is deliberate: a nested block comment is not a node in our tree, it is characters
 * inside `comment_text`. That loses nothing a printer needs — Prettier emits comment text verbatim.
 */
const SOURCE_TEXT_KINDS: ReadonlySet<string> = new Set(['comment_text']);

/**
 * Strip an alias suffix, if any, and report which mode it denoted.
 *
 * This half is purely lexical: it reads `node.type`, so it can only see the *visible* name. Head
 * mode is handled separately in `modeOf` — the visible name cannot express it, which is the whole
 * reason `HEAD_SYMBOL_IDS` exists.
 */
function stripModeSuffix(type: string): {
    kind: NodeKind;
    mode: NodeMode | null;
} {
    for (const suffix of MODE_SUFFIXES) {
        if (type.endsWith(suffix)) {
            const kind = type.slice(0, -suffix.length);
            if (kind in NODE_KINDS) {
                return {
                    kind: kind as NodeKind,
                    mode: suffix.slice(1) as NodeMode,
                };
            }
        }
    }
    // A kind the generator already knows, with no mode family.
    if (type in NODE_KINDS) return { kind: type as NodeKind, mode: null };
    // Unknown: a kind added by a grammar bump that the generated types have not caught up with.
    // Returning it as-is keeps the normaliser honest; the printer's exhaustive switch is what fails.
    return { kind: type as NodeKind, mode: null };
}

/**
 * The `kind`/`mode` pair for a node.
 *
 * `mode` is **not** just "which suffix the visible name carries". Head mode is registered in the
 * grammar as `<name>_head` and then aliased — either back onto the bare `<name>` (`not_exp`,
 * `par_exp`, …) or onto `<name>_block` (`call_exp_block`, …). In the first case the visible name
 * says nothing at all, and in the second it says "block", which is *nearly* right but arrives by
 * luck rather than by rule. `node.grammarId` is the id of the rule that actually produced the node,
 * alias not applied, so membership in `HEAD_SYMBOL_IDS` is the only sound test.
 *
 * Why it matters: head vs block decides whether a `{` after the node opens a body or a record, so
 * getting this wrong is a silent parse change (`docs/normalize.md` §4.2). Head mode is reported as
 * `'block'` because for a printer's purposes that is what it is — a position where `{` opens a
 * body. The extra head restrictions are layout rules and live in the printer's adjacency table.
 *
 * The plausible-looking alternative, `grammarId !== canonicalIdFor(type)`, is wrong in both
 * directions and `docs/normalize.md` §4.4 shows the 12 corpus nodes where the two disagree: an
 * `_object` node can be non-canonical for unrelated reasons (`42.toText`), and a head node can
 * happen to be canonical. Do not reintroduce it.
 */
function modeOf(node: TsNode): { kind: NodeKind; mode: NodeMode | null } {
    const stripped = stripModeSuffix(node.type);
    // `grammarId` is a number on every node; the set is the generated 20. A head-mode node keeps
    // its stripped `kind` (the alias it was given), only the mode is corrected.
    if (HEAD_SYMBOL_IDS.has(node.grammarId)) {
        return { kind: stripped.kind, mode: 'block' };
    }
    return stripped;
}

function toPoint(p: Point): NormalPoint {
    return { row: p.row, column: p.column };
}

function span(node: TsNode, startIndex: number, endIndex: number): NormalSpan {
    return {
        startIndex,
        endIndex,
        startPosition: toPoint(node.startPosition),
        endPosition: toPoint(node.endPosition),
    };
}

/** The position just past the last character of `text`. Used to close the widened root span. */
function endPointOf(text: string): NormalPoint {
    let row = 0;
    let column = 0;
    for (let i = 0; i < text.length; i += 1) {
        const c = text.charCodeAt(i);
        if (c === 10 /* \n */) {
            row += 1;
            column = 0;
        } else if (c === 13 /* \r */) {
            // A `\r\n` pair counts as one line break; the `\n` branch does the increment.
            if (text.charCodeAt(i + 1) !== 10) {
                row += 1;
                column = 0;
            }
        } else {
            column += 1;
        }
    }
    return { row, column };
}

/**
 * Utf16StringSource holds the source text and answers "what is between these two byte offsets?".
 *
 * The buffer is a `Uint16Array` over the string's char codes so the underlying tree-sitter
 * convention (offsets are UTF-16 code units, which is why the round-trip works on a JS string)
 * is explicit rather than accidental.
 */
class Utf16StringSource {
    /** The original text. */
    readonly text: string;

    constructor(text: string) {
        this.text = text;
    }

    /**
     * The string content of `[startIndex, endIndex)`.
     *
     * Returned verbatim: `String.prototype.slice` on a UTF-16 string is already code-unit
     * addressed, and then we only continue to concatenate them.
     */
    toString(startIndex: number, endIndex: number): string {
        return this.text.slice(startIndex, endIndex);
    }
}

/**
 * Normalise a tree-sitter tree into plain objects.
 *
 * `node.text` is not used: text is always sliced from `source`, because comment text in particular
 * cannot be reconstructed from child tokens. See the module doc comment.
 *
 * The root is widened to cover the whole input. tree-sitter's `source_file` starts at the first
 * token and ends at the last — a file's leading blank lines and final newline are *outside* it —
 * but `root.text` must equal `source` for the round-trip to hold and for Prettier's
 * `locStart`/`locEnd` to be able to address every character. The uncovered head and tail are
 * whitespace by construction; anything else is an ERROR tree and is rejected before we get here.
 */
export function normalize(root: TsNode, source: string): NormalBranch {
    const src = new Utf16StringSource(source);

    /**
     * Build a node's children with gaps interleaved, in source order.
     *
     * `from`/`to` are the *effective* span, which is the node's own for every node but the root.
     * Passing them in rather than reading `node.startIndex`/`endIndex` inside keeps one code path
     * for the head gap, the between-children gaps and the tail gap — three places the round-trip
     * can silently lose text if they are written separately.
     */
    function buildChildrenOf(
        node: TsNode,
        from: number,
        to: number,
    ): NormalChild[] {
        const out: NormalChild[] = [];
        const kids = node.children;
        let previous: TsNode | null = null;

        /** Record `[start, end)` as a gap. Non-whitespace here means our model is broken. */
        const gap = (start: number, end: number, at: TsNode): void => {
            if (end < start) return;
            const text = src.toString(start, end);
            if (!text) return;
            if (text.trim() !== '') {
                throw new Error(
                    `normalize: unexpected non-whitespace between nodes at [${start},${end}): ` +
                        `${JSON.stringify(text.slice(0, 40))}. A token that is not a child of the ` +
                        'tree would make the round-trip lossy, so this is fatal rather than ignored.',
                );
            }
            out.push({
                nodeType: 'Text',
                text,
                position: null,
                adjust: 0,
                ...span(at, start, end),
            });
        };

        for (let i = 0; i < kids.length; i += 1) {
            const child = kids[i];
            // The head gap belongs to the first child; every later one follows its predecessor.
            // Comments are never in these gaps: they are tree children, and the loop visits them
            // in order, so a gap between two children is whitespace only.
            gap(previous ? previous.endIndex : from, child.startIndex, child);

            // `fieldNameForChild` indexes `node.children` — anonymous tokens included — which is
            // exactly the loop counter, since the synthetic `Text` gaps are ours, not children.
            out.push(buildChild(child, node.fieldNameForChild(i)));
            previous = child;
        }

        // The tail. A node's span routinely runs past its last child: the file node ends at the
        // last newline, and `source_file`'s children stop at the last `;`. Without this the
        // round-trip is short by exactly the trailing whitespace of every file.
        gap(previous ? previous.endIndex : from, to, node);

        return out;
    }

    function buildChild(
        node: TsNode,
        field: string | null,
    ): NormalToken | NormalBranch {
        // A leaf — no children at all — is a token. `named` distinguishes `identifier` from `{`.
        // `comment_text` and string fragments are leaves too and are treated the same way: their
        // text comes from the source slice, never from re-joining.
        if (node.childCount === 0 || SOURCE_TEXT_KINDS.has(node.type)) {
            return {
                nodeType: 'Token',
                type: node.type,
                named: node.isNamed,
                extra: node.isExtra,
                error: node.isError,
                missing: node.isMissing,
                text: src.toString(node.startIndex, node.endIndex),
                ...span(node, node.startIndex, node.endIndex),
            };
        }

        return finish(
            node,
            field,
            buildChildrenOf(node, node.startIndex, node.endIndex),
        );
    }

    /**
     * Wrap up a node. For every node but the root the span is the node's own; the root passes
     * `bounds` to widen its span to the whole input (see `normalize`).
     */
    function finish(
        node: TsNode,
        field: string | null,
        children: NormalChild[],
        bounds?: { startIndex: number; endIndex: number },
    ): NormalBranch {
        const { kind, mode } = modeOf(node);

        // Reconstruct the node's text from its children. For any well-formed subtree this equals
        // `src.toString(startIndex, endIndex)`, and the corpus round-trip asserts exactly that.
        let text = '';
        for (const c of children) text += c.text;

        const own = span(node, node.startIndex, node.endIndex);
        // Widening only ever covers whitespace, and only the root is widened, so its positions are
        // recomputed straight from the source rather than by shifting the node's own.
        const fixed = bounds
            ? {
                  ...own,
                  ...bounds,
                  startPosition: { row: 0, column: 0 },
                  endPosition: endPointOf(source),
              }
            : own;

        return {
            nodeType: 'Branch',
            type: node.type,
            kind,
            mode,
            grammarId: node.grammarId,
            named: node.isNamed,
            extra: node.isExtra,
            field,
            children,
            fields: {},
            set: [],
            collapsed: false,
            error: node.isError,
            missing: node.isMissing,
            hasError: node.hasError,
            text,
            ...fixed,
        };
    }

    // The root's effective span is the whole input, not the node's own: `source_file` starts at
    // the first token and ends at the last, so a file's leading blank lines and its final newline
    // lie *outside* it. `buildChildrenOf` needs that span to emit the head and tail gaps, and
    // `finish` needs it so `root.text` equals `source` for the round-trip.
    const bounds = { startIndex: 0, endIndex: source.length };
    return finish(
        root,
        null,
        buildChildrenOf(root, bounds.startIndex, bounds.endIndex),
        bounds,
    );
}

/**
 * The token round-trip check, on its own so the corpus harness and the parser both use one copy.
 *
 * Re-concatenating the tokens and the gaps between them must reproduce the source exactly. This is
 * the single check that proves the normaliser lost nothing. It is cheap and it is run on the whole
 * corpus.
 *
 * Returns the first mismatch, or `null` when the round-trip is exact.
 */
export function checkRoundTrip(
    node: NormalNode,
    source: string,
): { at: number; expected: string; got: string } | null {
    // Walk the whole tree gathering leaves and gaps in offset order, then compare against the
    // source. Gathering rather than streaming keeps the error location precise.
    const pieces: { startIndex: number; endIndex: number; text: string }[] = [];

    function walk(n: NormalChild): void {
        if (n.nodeType === 'Text') {
            pieces.push({
                startIndex: n.startIndex,
                endIndex: n.endIndex,
                text: n.text,
            });
            return;
        }
        if (n.nodeType === 'Token') {
            // Skip zero-width tokens (MISSING nodes); they contribute no text.
            if (n.endIndex > n.startIndex || n.text) {
                pieces.push({
                    startIndex: n.startIndex,
                    endIndex: n.endIndex,
                    text: n.text,
                });
            }
            return;
        }
        for (const c of n.children) walk(c);
    }

    walk(node);

    let cursor = 0;
    for (const piece of pieces) {
        if (piece.startIndex !== cursor) {
            return {
                at: cursor,
                expected: JSON.stringify(
                    source.slice(cursor, Math.min(cursor + 40, source.length)),
                ),
                got:
                    JSON.stringify(piece.text.slice(0, 40)) +
                    ` at offset ${piece.startIndex}`,
            };
        }
        cursor = piece.endIndex;
    }

    if (cursor !== source.length) {
        return {
            at: cursor,
            expected: JSON.stringify(
                source.slice(cursor, Math.min(cursor + 40, source.length)),
            ),
            got: '<end of tree>',
        };
    }
    return null;
}

/**
 * A compact, position-free shape for structural comparison.
 *
 * The runtime guard compares two trees for *semantic* equality: node kinds, fields, and token
 * texts. Source offsets must not participate — reformatting moves everything. Which differences
 * are forgiven (an unwrapped `ParP`, an added single-expression `BlockE`, a dropped `;`) is the
 * rewrite's edit log to declare, so this function deliberately reports *everything* and the caller
 * applies the tolerance.
 */
export function shapeOf(node: NormalChild): unknown {
    if (node.nodeType === 'Text') {
        // Whitespace carries no meaning for the comparison; only its existence matters.
        return null;
    }
    if (node.nodeType === 'Token') {
        return `${node.named ? '' : '~'}${node.type}:${node.text}`;
    }
    const kids = node.children.map(shapeOf).filter((k) => k !== null);
    const out: unknown[] = [node.kind];
    if (node.mode) out.push(node.mode);
    out.push(kids);
    return out;
}
