import type { Tree } from 'web-tree-sitter';

import { createParser } from './tree-sitter.ts';
import { normalize } from './normalize.ts';
import type { NormalBranch, NormalChild } from './normalize.ts';

export interface SyntaxErrorLocation {
    start: { line: number; column: number };
    end?: { line: number; column: number };
}

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

interface Problem {
    kind: 'error' | 'missing';
    name: string;
    node: Exclude<NormalChild, { nodeType: 'Text' }>;
}

export interface ParseResult {
    root: NormalBranch;
    source: string;
}

// tree-sitter nests the bad token's `ERROR` inside one spanning the failed construct, so report the innermost.
function findProblem(root: NormalBranch): Problem | null {
    function walk(
        n: NormalChild,
        enclosing: NormalBranch | null,
    ): Problem | null {
        if (n.nodeType === 'Text') return null;

        if (n.error || n.missing) {
            if (n.nodeType === 'Branch') {
                for (const c of n.children) {
                    const inner = walk(c, n);
                    if (inner) return inner;
                }
            }
            return {
                kind: n.missing ? 'missing' : 'error',
                name: n.type,
                node: n,
            };
        }

        if (n.nodeType === 'Token') return null;

        const flagged = n.hasError ? n : enclosing;
        // Zero-width recovery site with no flagged node below, e.g. `include I;` gets an empty `float_literal`.
        if (n.startIndex === n.endIndex && flagged) {
            return { kind: 'error', name: flagged.type, node: flagged };
        }

        for (const c of n.children) {
            const found = walk(c, flagged);
            if (found) return found;
        }
        return null;
    }

    return walk(root, null);
}

function codeFrame(source: string, row: number, column: number): string {
    const lines = source.split('\n');
    const first = Math.max(0, row - 2);
    const last = Math.min(lines.length - 1, row + 2);
    const gutter = String(last + 1).length;
    const out: string[] = [];

    for (let i = first; i <= last; i += 1) {
        out.push(`${String(i + 1).padStart(gutter, ' ')} | ${lines[i]}`);
        if (i === row) {
            out.push(`${' '.repeat(gutter)} | ${' '.repeat(column)}^`);
        }
    }
    return out.join('\n');
}

function syntaxError(source: string, problem: Problem): MotokoSyntaxError {
    const { startPosition: start, endPosition: end } = problem.node;
    const what =
        problem.kind === 'error'
            ? 'Unexpected input'
            : `Missing ${problem.name === '}' ? 'closing brace' : `\`${problem.name}\``}`;
    return new MotokoSyntaxError(
        `${what} at ${start.row + 1}:${start.column + 1}.`,
        {
            start: { line: start.row + 1, column: start.column + 1 },
            end: { line: end.row + 1, column: end.column + 1 },
        },
        codeFrame(source, start.row, start.column),
    );
}

export async function parse(source: string): Promise<ParseResult> {
    const parser = await createParser();
    let tree: Tree | null;
    try {
        tree = parser.parse(source);
    } finally {
        parser.delete();
    }

    if (!tree) {
        throw new MotokoSyntaxError(
            'Motoko parser returned no tree for this input.',
            { start: { line: 1, column: 0 } },
            '',
        );
    }

    try {
        const root = normalize(tree.rootNode, source);
        if (tree.rootNode.hasError) {
            const problem = findProblem(root);
            if (problem) throw syntaxError(source, problem);
            throw new MotokoSyntaxError(
                'The parser reported an error but no offending node was found. ' +
                    'This is a bug in prettier-plugin-motoko, please report it.',
                { start: { line: 1, column: 0 } },
                '',
            );
        }
        return { root, source };
    } finally {
        tree.delete();
    }
}
