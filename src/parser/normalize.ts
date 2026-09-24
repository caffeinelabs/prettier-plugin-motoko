import type { Node as TsNode, Point } from 'web-tree-sitter';

import { HEAD_SYMBOL_IDS, NODE_KINDS } from './nodes.generated.ts';
import type { NodeKind, NodeMode } from './nodes.generated.ts';

export interface NormalPoint {
    row: number;
    column: number;
}

export interface NormalSpan {
    startIndex: number;
    endIndex: number;
    startPosition: NormalPoint;
    endPosition: NormalPoint;
}

export interface NormalToken extends NormalSpan {
    nodeType: 'Token';
    type: string;
    named: boolean;
    extra: boolean;
    text: string;
    error: boolean;
    missing: boolean;
}

export interface NormalBranch extends NormalSpan {
    nodeType: 'Branch';
    type: string;
    kind: NodeKind;
    mode: NodeMode | null;
    grammarId: number;
    named: boolean;
    extra: boolean;
    field: string | null;
    children: NormalChild[];
    error: boolean;
    missing: boolean;
    hasError: boolean;
    text: string;
}

export type NormalNode = NormalToken | NormalBranch;

export type NormalChild = NormalNode | NormalText;

export interface NormalText extends NormalSpan {
    nodeType: 'Text';
    text: string;
}

const MODE_SUFFIXES: readonly string[] = ['_block', '_object'];

// `comment_text` is lexed one character per hidden token, so only a source slice gives its exact text.
const SOURCE_TEXT_KINDS: ReadonlySet<string> = new Set(['comment_text']);

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
    return { kind: type as NodeKind, mode: null };
}

// Head rules alias onto ordinary names (`par_exp`, `call_exp_block`), so only `grammarId` reveals head mode.
function modeOf(node: TsNode): { kind: NodeKind; mode: NodeMode | null } {
    const stripped = stripModeSuffix(node.type);
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

function endPointOf(text: string): NormalPoint {
    let row = 0;
    let column = 0;
    for (let i = 0; i < text.length; i += 1) {
        const c = text.charCodeAt(i);
        if (c === 10) {
            row += 1;
            column = 0;
        } else if (c === 13) {
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

export function normalize(root: TsNode, source: string): NormalBranch {
    function buildChildrenOf(
        node: TsNode,
        from: number,
        to: number,
    ): NormalChild[] {
        const out: NormalChild[] = [];
        const kids = node.children;
        let previous: TsNode | null = null;

        const gap = (start: number, end: number, at: TsNode): void => {
            if (end <= start) return;
            const text = source.slice(start, end);
            if (text.trim() !== '') {
                throw new Error(
                    `normalize: unexpected non-whitespace between nodes at [${start},${end}): ` +
                        JSON.stringify(text.slice(0, 40)),
                );
            }
            out.push({ nodeType: 'Text', text, ...span(at, start, end) });
        };

        for (let i = 0; i < kids.length; i += 1) {
            const child = kids[i];
            gap(previous ? previous.endIndex : from, child.startIndex, child);
            out.push(buildChild(child, node.fieldNameForChild(i)));
            previous = child;
        }

        gap(previous ? previous.endIndex : from, to, node);

        return out;
    }

    function buildChild(
        node: TsNode,
        field: string | null,
    ): NormalToken | NormalBranch {
        if (node.childCount === 0 || SOURCE_TEXT_KINDS.has(node.type)) {
            return {
                nodeType: 'Token',
                type: node.type,
                named: node.isNamed,
                extra: node.isExtra,
                error: node.isError,
                missing: node.isMissing,
                text: source.slice(node.startIndex, node.endIndex),
                ...span(node, node.startIndex, node.endIndex),
            };
        }

        return finish(
            node,
            field,
            buildChildrenOf(node, node.startIndex, node.endIndex),
        );
    }

    function finish(
        node: TsNode,
        field: string | null,
        children: NormalChild[],
        bounds?: { startIndex: number; endIndex: number },
    ): NormalBranch {
        const { kind, mode } = modeOf(node);

        let text = '';
        for (const c of children) text += c.text;

        const own = span(node, node.startIndex, node.endIndex);
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
            error: node.isError,
            missing: node.isMissing,
            hasError: node.hasError,
            text,
            ...fixed,
        };
    }

    const bounds = { startIndex: 0, endIndex: source.length };
    return finish(
        root,
        null,
        buildChildrenOf(root, bounds.startIndex, bounds.endIndex),
        bounds,
    );
}

export function checkRoundTrip(
    node: NormalNode,
    source: string,
): { at: number; expected: string; got: string } | null {
    const pieces: { startIndex: number; endIndex: number; text: string }[] = [];

    function walk(n: NormalChild): void {
        if (n.nodeType === 'Branch') {
            for (const c of n.children) walk(c);
        } else if (n.endIndex > n.startIndex || n.text) {
            pieces.push(n);
        }
    }

    walk(node);

    const excerpt = (at: number) =>
        JSON.stringify(source.slice(at, Math.min(at + 40, source.length)));

    let cursor = 0;
    for (const piece of pieces) {
        if (piece.startIndex !== cursor) {
            return {
                at: cursor,
                expected: excerpt(cursor),
                got: `${JSON.stringify(piece.text.slice(0, 40))} at offset ${piece.startIndex}`,
            };
        }
        cursor = piece.endIndex;
    }

    if (cursor !== source.length) {
        return { at: cursor, expected: excerpt(cursor), got: '<end of tree>' };
    }
    return null;
}

export function shapeOf(node: NormalChild): unknown {
    if (node.nodeType === 'Text') return null;
    if (node.nodeType === 'Token') {
        return `${node.named ? '' : '~'}${node.type}:${node.text}`;
    }
    const kids = node.children.map(shapeOf).filter((k) => k !== null);
    const out: unknown[] = [node.kind];
    if (node.mode) out.push(node.mode);
    out.push(kids);
    return out;
}
