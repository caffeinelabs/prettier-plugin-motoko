import { MotokoSyntaxError, parse } from '../parser/parse.ts';
import type {
    NormalBranch,
    NormalChild,
    NormalNode,
} from '../parser/normalize.ts';

interface Edit {
    start: number;
    end: number;
    text: string;
}

type Rule = (root: NormalBranch) => Edit[];

function* branches(node: NormalBranch): Generator<NormalBranch> {
    yield node;
    for (const c of node.children) {
        if (c.nodeType === 'Branch') yield* branches(c);
    }
}

function field(node: NormalBranch, name: string): NormalBranch | null {
    const c = node.children.find(
        (c): c is NormalBranch => c.nodeType === 'Branch' && c.field === name,
    );
    return c ?? null;
}

function nodes(node: NormalBranch): NormalNode[] {
    return node.children.filter((c): c is NormalNode => c.nodeType !== 'Text');
}

function isBlock(node: NormalBranch | null): boolean {
    return node !== null && node.kind === 'block_exp';
}

function brace(node: NormalBranch): Edit[] {
    return [
        { start: node.startIndex, end: node.startIndex, text: '{ ' },
        { start: node.endIndex, end: node.endIndex, text: ' }' },
    ];
}

/** Every control body gets braces: `if`/`else` branches, `while`/`for`/`loop` bodies, `case` and `catch` arms. */
const braceBodies: Rule = (root) => {
    const edits: Edit[] = [];
    for (const n of branches(root)) {
        const bodies: (NormalBranch | null)[] = [];
        if (n.kind === 'if_exp') {
            bodies.push(field(n, 'then'));
            const otherwise = field(n, 'else');
            if (otherwise?.kind !== 'if_exp') bodies.push(otherwise);
        } else if (
            ['while_exp', 'for_exp', 'loop_exp', 'case', 'catch'].includes(
                n.kind,
            )
        ) {
            bodies.push(field(n, 'body'));
        }
        for (const body of bodies) {
            if (body !== null && !isBlock(body)) edits.push(...brace(body));
        }
    }
    return edits;
};

/** Expression kinds moc accepts bare in a head. Statement-like forms and records keep their parens. */
const HEAD_KINDS = new Set([
    'var_exp',
    'lit_exp',
    'call_exp',
    'dot_exp',
    'proj_exp',
    'array_idx_exp',
    'bin_exp',
    'not_exp',
    'unop_exp',
    'bang_exp',
    'coalesce_exp',
]);

/** The head's nodes outside nested parentheses, where moc reads an ordinary expression. */
function* topLevel(node: NormalBranch): Generator<NormalBranch> {
    yield node;
    for (const c of node.children) {
        if (c.nodeType === 'Branch' && c.kind !== 'par_exp') yield* topLevel(c);
    }
}

const PREFIX_SHAPED_OPS = new Set(['-', '+', '^', '#']);

/** The gap before a call's argument or an index's `[`, if there is one: `f x`, `f<T> (x)`, `a [i]`. */
function spacedArg(n: NormalBranch): NormalChild | null {
    const kids = n.children;
    const gap =
        n.kind === 'call_exp'
            ? kids[kids.length - 2]
            : n.kind === 'array_idx_exp'
              ? kids[1]
              : undefined;
    return gap?.nodeType === 'Text' ? gap : null;
}

/** Whether a head can drop its parens; with `glue`, once `glueHeadCalls` has glued its spaced arguments. */
function headSafe(inner: NormalBranch, glue = false): boolean {
    if (!HEAD_KINDS.has(inner.kind) || inner.text.includes('\n')) return false;
    for (const n of topLevel(inner)) {
        const kids = n.children;
        // `{` in a head is read as a record.
        if (kids.some((c) => c.nodeType === 'Token' && c.text === '{'))
            return false;
        // A spaced argument or `(`/`[` after a head starts the branch instead of continuing the head.
        if (!glue && spacedArg(n) !== null) return false;
        // So does a prefix-shaped `-`/`+`/`^`/`#` (spaced before, glued after), which the grammar reads as binary.
        const op = kids.findIndex(
            (c) =>
                c.nodeType === 'Branch' &&
                c.kind === 'bin_op' &&
                PREFIX_SHAPED_OPS.has(c.text.trim()),
        );
        if (
            op > 0 &&
            kids[op - 1].nodeType === 'Text' &&
            kids[op + 1]?.nodeType !== 'Text'
        )
            return false;
    }
    return true;
}

/** The single expression inside a `( … )`, or `null` for a tuple, unit or anything with a comment. */
function parenthesised(par: NormalBranch | null): NormalBranch | null {
    if (par === null || par.kind !== 'par_exp') return null;
    const inner = nodes(par);
    if (inner.length !== 3 || inner[1].nodeType !== 'Branch') return null;
    return inner[1];
}

function unwrap(
    keyword: NormalChild | undefined,
    par: NormalBranch,
    inner: NormalBranch,
    after: NormalChild | undefined,
): Edit {
    const spaceBefore = keyword?.nodeType === 'Text' ? '' : ' ';
    const spaceAfter = after?.nodeType === 'Text' ? '' : ' ';
    return {
        start: par.startIndex,
        end: par.endIndex,
        text: spaceBefore + inner.text + spaceAfter,
    };
}

/** `if (c) {` → `if c {`, likewise `while` and `switch`, and `for (p in e) {` → `for p in e {`. Only once every body is braced. */
const unparenHeads: Rule = (root) => {
    const edits: Edit[] = [];
    for (const n of branches(root)) {
        if (
            n.kind === 'if_exp' ||
            n.kind === 'while_exp' ||
            n.kind === 'switch_exp'
        ) {
            const name = n.kind === 'switch_exp' ? 'scrutinee' : 'condition';
            const par = field(n, name);
            const inner = parenthesised(par);
            if (par === null || inner === null || !headSafe(inner)) continue;
            if (n.kind === 'if_exp') {
                const otherwise = field(n, 'else');
                if (!isBlock(field(n, 'then'))) continue;
                if (
                    otherwise !== null &&
                    !isBlock(otherwise) &&
                    otherwise.kind !== 'if_exp'
                )
                    continue;
            }
            if (n.kind === 'while_exp' && !isBlock(field(n, 'body'))) continue;
            const i = n.children.indexOf(par);
            edits.push(
                unwrap(n.children[i - 1], par, inner, n.children[i + 1]),
            );
        } else if (n.kind === 'for_exp') {
            const open = n.children.findIndex(
                (c) => c.nodeType === 'Token' && c.text === '(',
            );
            const close = n.children.findIndex(
                (c) => c.nodeType === 'Token' && c.text === ')',
            );
            const iterator = field(n, 'iterator');
            if (
                open < 0 ||
                close < 0 ||
                iterator === null ||
                !headSafe(iterator)
            )
                continue;
            if (!isBlock(field(n, 'body'))) continue;
            const inside = n.children.slice(open + 1, close);
            const text = inside
                .map((c) => c.text)
                .join('')
                .trim();
            const before = n.children[open - 1]?.nodeType === 'Text' ? '' : ' ';
            const after = n.children[close + 1]?.nodeType === 'Text' ? '' : ' ';
            edits.push({
                start: n.children[open].startIndex,
                end: n.children[close].endIndex,
                text: before + text + after,
            });
        }
    }
    return edits;
};

/** `if (f x) {` → `if (f(x)) {`, only where that is all that keeps the head's parens. */
const glueHeadCalls: Rule = (root) => {
    const edits: Edit[] = [];
    for (const n of branches(root)) {
        const inner =
            n.kind === 'for_exp'
                ? field(n, 'iterator')
                : n.kind === 'switch_exp'
                  ? parenthesised(field(n, 'scrutinee'))
                  : n.kind === 'if_exp' || n.kind === 'while_exp'
                    ? parenthesised(field(n, 'condition'))
                    : null;
        if (inner === null || headSafe(inner) || !headSafe(inner, true))
            continue;
        for (const call of topLevel(inner)) {
            const gap = spacedArg(call);
            if (gap === null) continue;
            const arg = call.children[call.children.length - 1];
            const bracketed =
                call.kind === 'array_idx_exp' ||
                (arg.nodeType === 'Branch' && arg.kind === 'par_exp');
            edits.push(
                bracketed
                    ? { start: gap.startIndex, end: gap.endIndex, text: '' }
                    : {
                          start: gap.startIndex,
                          end: arg.endIndex,
                          text: `(${arg.text})`,
                      },
            );
        }
    }
    return edits;
};

/** A braced arm needs no `;`: `case` already ends the previous one. */
const dropCaseSemis: Rule = (root) => {
    const edits: Edit[] = [];
    for (const n of branches(root)) {
        if (n.kind !== 'switch_exp') continue;
        const kids = nodes(n);
        kids.forEach((c, i) => {
            const prev = kids[i - 1];
            if (c.nodeType !== 'Token' || c.text !== ';') return;
            if (prev?.nodeType !== 'Branch' || prev.kind !== 'case') return;
            if (!isBlock(field(prev, 'body'))) return;
            edits.push({ start: c.startIndex, end: c.endIndex, text: '' });
        });
    }
    return edits;
};

/** Patterns moc accepts bare after `case`. Or-, and- and annotated patterns keep their parens. */
const BARE_PATTERNS = new Set([
    'lit_pat',
    'var_pat',
    'wild_pat',
    'quest_pat',
    'unop_pat',
    'obj_pat',
    'tup_pat',
]);

/** `case (p) {` → `case p {`, and `case (#t x) {` → `case #t(x) {`. */
const unwrapCasePatterns: Rule = (root) => {
    const edits: Edit[] = [];
    for (const n of branches(root)) {
        if (n.kind !== 'case' || !isBlock(field(n, 'body'))) continue;
        const par = field(n, 'pattern');
        if (par === null || par.kind !== 'tup_pat') continue;
        const inner = nodes(par);
        if (inner.length !== 3 || inner[1].nodeType !== 'Branch') continue;
        const pattern = inner[1];
        let text: string | null = null;
        if (BARE_PATTERNS.has(pattern.kind)) {
            text = pattern.text;
        } else if (pattern.kind === 'tag_pat') {
            const [tag, payload] = nodes(pattern);
            if (payload === undefined) text = tag.text;
            else if (
                payload.nodeType === 'Branch' &&
                payload.kind === 'tup_pat'
            )
                text = tag.text + payload.text;
            else text = `${tag.text}(${payload.text})`;
        }
        if (text === null || text.includes('\n')) continue;
        edits.push({ start: par.startIndex, end: par.endIndex, text });
    }
    return edits;
};

const RULES: Rule[] = [
    braceBodies,
    glueHeadCalls,
    unparenHeads,
    dropCaseSemis,
    unwrapCasePatterns,
];

/** Applies the edits whose ranges don't overlap an earlier one; the rest wait for the next round. */
function apply(source: string, edits: Edit[]): string {
    const chosen: Edit[] = [];
    for (const e of [...edits].sort(
        (a, b) => a.start - b.start || a.end - b.end,
    )) {
        const last = chosen[chosen.length - 1];
        if (last !== undefined && e.start < last.end) continue;
        chosen.push(e);
    }
    let out = source;
    for (const e of chosen.reverse())
        out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return out;
}

/** Rewrites legacy syntax to the moc 2.0 forms. Each rule runs to a fixed point before the next, since later rules need braced bodies. */
export async function rewriteMoc2(source: string): Promise<string> {
    let text = source;
    for (const rule of RULES) {
        for (;;) {
            const { root } = await reparse(text, text === source);
            const edits = rule(root);
            if (edits.length === 0) break;
            const next = apply(text, edits);
            if (next === text) break;
            text = next;
        }
    }
    return text;
}

async function reparse(text: string, original: boolean) {
    try {
        return await parse(text);
    } catch (error) {
        if (original || !(error instanceof MotokoSyntaxError)) throw error;
        throw new Error(
            `prettier-plugin-motoko: the moc2 rewrite produced unparseable code (${error.message}). Please report this.`,
        );
    }
}
