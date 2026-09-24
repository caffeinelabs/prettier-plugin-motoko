import { parse } from './parser/parse.ts';
import { shapeOf } from './parser/normalize.ts';
import type {
    NormalBranch,
    NormalChild,
    NormalNode,
} from './parser/normalize.ts';

export class VerifyError extends Error {
    readonly loc: { line: number; column: number };

    constructor(message: string, loc: { line: number; column: number }) {
        super(`prettier-plugin-motoko: internal error — ${message}`);
        this.name = 'VerifyError';
        this.loc = loc;
    }
}

interface Tolerance {
    readonly reason: string;
}

const TOLERATED_KINDS: ReadonlyMap<string, Tolerance> = new Map();

function tolerated(shape: unknown): boolean {
    if (!Array.isArray(shape) || typeof shape[0] !== 'string') return false;
    return TOLERATED_KINDS.has(shape[0]);
}

export interface ShapeDifference {
    path: string;
    input: unknown;
    output: unknown;
}

function show(shape: unknown): string {
    if (shape === null || shape === undefined) return '<absent>';
    return JSON.stringify(shape, null, 0).slice(0, 200);
}

function isLineCommentShape(shape: string): boolean {
    return /^~?(line_comment|doc_comment):/.test(shape);
}

// `printDocToString` trims trailing whitespace at a line end, so a line comment can lose its trailing spaces.
function sameToken(input: string, output: string): boolean {
    if (input === output) return true;
    if (!isLineCommentShape(input) || !isLineCommentShape(output)) return false;
    return input.replace(/\s+$/, '') === output.replace(/\s+$/, '');
}

export function compareShapes(
    input: unknown,
    output: unknown,
    path = '',
): ShapeDifference | null {
    if (input === null && output === null) return null;

    if (typeof input === 'string' && typeof output === 'string') {
        return sameToken(input, output)
            ? null
            : { path, input: input, output: output };
    }

    if (Array.isArray(input) && Array.isArray(output)) {
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

        if (tolerated(input) && tolerated(output) && input[0] === output[0])
            return null;

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

function locate(
    root: NormalNode,
    path: string,
): { line: number; column: number } {
    let node: NormalChild = root;
    const steps = path.split('.').slice(1);

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
