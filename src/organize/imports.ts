/**
 * Rewrites a file's leading import section as text, before it is parsed.
 *
 * Organizing changes the token sequence: combining statements deletes an `import` and a `;`, and dropping `import {} "p"` deletes one.
 * So the rewritten text is re-parsed, and the runtime guard compares the printer's output with the organized tree.
 * The guard can't see the rewrite itself, which is why `bindingsPreserved` checks that every binding survives it.
 * Anything this pass doesn't understand returns `null` rather than a partial rewrite, so a section it can't read is left as written.
 * The emitted imports are exactly what the printer would print for them, so a second run is a fixed point.
 */

import type {
    NormalBranch,
    NormalChild,
    NormalToken,
} from '../parser/normalize.ts';
import { MotokoSyntaxError, parse as parseMotoko } from '../parser/parse.ts';
import { isComment, isImport } from '../printer/parts.ts';

/** Emit order: `ic:`, `canister:`, `mo:`, then relative paths. `''` is the catch-all, so it must stay last. */
const IMPORT_GROUPS: readonly string[] = ['ic:', 'canister:', 'mo:', ''];

interface ImportClause {
    /** Decoded; used for grouping and sorting. */
    path: string;
    /** The literal as written, quotes included, reused verbatim so escapes survive. */
    pathText: string;
    /** `null` for the destructured form. */
    name: string | null;
    /** `[name, alias]`, with `name === alias` when there is no alias. */
    fields: [string, string][];
    /** Spelled with an explicit `=` (`import X = "p"`). */
    equals: boolean;
}

interface Section {
    /** The first import, not the file start, so a header comment stays in `head`. */
    start: number;
    end: number;
    imports: ImportClause[];
    comments: string[];
    sawEquals: boolean;
}

function elementChildren(node: NormalBranch): NormalChild[] {
    return node.children;
}

function tokenOf(child: NormalChild): NormalToken | null {
    return child.nodeType === 'Token' ? child : null;
}

function leadingTokenText(node: NormalChild): string | null {
    let current: NormalChild = node;
    while (current.nodeType === 'Branch') {
        const first = current.children.find((c) => c.nodeType !== 'Text');
        if (first === undefined) return null;
        current = first;
    }
    return current.text;
}

/**
 * Detects an import missing its `;` before another import.
 *
 * The grammar accepts `import` as an identifier in expression position, so the next `import Text "mo:base/Text"` parses as a call.
 * `isImport` rightly rejects that node, but ending the section there leaves the remaining imports in `tail`, which gets re-spaced,
 * so the output is no longer a fixed point. moc rejects the shape, so the pass refuses rather than inventing the missing `;`.
 */
function beginsWithImportKeyword(node: NormalChild): boolean {
    return leadingTokenText(node) === 'import';
}

/** Returns `null` for any shape it doesn't recognise, which makes the whole pass refuse. */
function readImport(node: NormalBranch): ImportClause | null {
    let pathText: string | null = null;
    let name: string | null = null;
    const fields: [string, string][] = [];
    let sawEquals = false;
    let sawPattern = false;

    for (const child of elementChildren(node)) {
        if (child.nodeType === 'Text') continue;

        if (child.nodeType === 'Token') {
            if (child.type === 'text_literal') {
                if (pathText !== null) return null;
                pathText = child.text;
            } else if (child.text === '=') {
                sawEquals = true;
            }
            continue;
        }

        // A comment here is a child of the import, so re-emitting the statement from its parts would drop it.
        if (isComment(child)) return null;

        if (child.kind === 'var_pat') {
            if (sawPattern) return null;
            const identifier = elementChildren(child).find(
                (c) => c.nodeType === 'Token' && c.type === 'identifier',
            );
            if (!identifier || identifier.nodeType !== 'Token') return null;
            name = identifier.text;
            sawPattern = true;
            continue;
        }

        if (child.kind === 'obj_pat') {
            if (sawPattern) return null;
            for (const field of elementChildren(child)) {
                if (field.nodeType === 'Text') continue;
                if (field.nodeType === 'Token') {
                    if (
                        field.text !== '{' &&
                        field.text !== '}' &&
                        field.text !== ';'
                    )
                        return null;
                    continue;
                }
                if (field.kind !== 'val_pat_field') return null;
                const read = readField(field);
                if (read === null) return null;
                fields.push(read);
            }
            sawPattern = true;
            continue;
        }

        return null;
    }

    if (pathText === null || !sawPattern) return null;
    if (name !== null && fields.length > 0) return null;

    // Decoded rather than unquoted so escapes compare correctly; the emitted text still reuses `pathText` verbatim.
    let path: string;
    try {
        const decoded: unknown = JSON.parse(pathText);
        if (typeof decoded !== 'string') return null;
        path = decoded;
    } catch {
        return null;
    }

    return { path, pathText, name, fields, equals: sawEquals };
}

/** `name` or `name = alias`, where the alias is a `var_pat` branch wrapping the identifier, not a token. */
function readField(node: NormalBranch): [string, string] | null {
    const parts = elementChildren(node).filter((c) => c.nodeType !== 'Text');
    const name = parts[0] === undefined ? null : tokenOf(parts[0]);
    if (name === null || name.type !== 'identifier') return null;

    if (parts.length === 1) return [name.text, name.text];
    if (parts.length === 3) {
        const eq = parts[1] === undefined ? null : tokenOf(parts[1]);
        const alias = parts[2];
        if (eq === null || eq.text !== '=') return null;
        if (alias.nodeType !== 'Branch' || alias.kind !== 'var_pat')
            return null;
        const aliasName = elementChildren(alias)
            .map((c) => tokenOf(c))
            .find((t) => t !== null && t.type === 'identifier');
        if (aliasName === undefined || aliasName === null) return null;
        return [name.text, aliasName.text];
    }
    return null;
}

/**
 * The leading run of imports and comments, starting at the first import, or `null` when there is nothing to touch.
 *
 * Comments before the first import are the file's header and stay in `head`.
 * Comments inside the section move below the organized imports, since combining and sorting leaves them no position to keep.
 */
function readSection(root: NormalBranch): Section | null {
    const items: NormalChild[] = [];
    for (const child of elementChildren(root)) {
        if (child.nodeType === 'Text') continue;
        items.push(child);
    }

    let firstImport = -1;
    let end = -1;
    const imports: ImportClause[] = [];
    const comments: string[] = [];
    let sawEquals = false;
    let previousWasImport = false;

    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];

        // An import's `;` is a root-level sibling of the `import` branch.
        // Without absorbing it, the rewrite would leave the `;` on a line of its own, which does not re-parse.
        if (
            previousWasImport &&
            item.nodeType === 'Token' &&
            item.text === ';'
        ) {
            end = i;
            previousWasImport = false;
            continue;
        }
        previousWasImport = false;

        if (isImport(item)) {
            if (item.nodeType !== 'Branch') return null;
            const clause = readImport(item);
            if (clause === null) return null;
            if (clause.equals) sawEquals = true;
            imports.push(clause);
            if (firstImport === -1) firstImport = i;
            end = i;
            previousWasImport = true;
            continue;
        }

        if (isComment(item)) {
            if (firstImport === -1) continue;
            comments.push(item.text);
            end = i;
            continue;
        }

        // See `beginsWithImportKeyword`.
        if (beginsWithImportKeyword(item)) return null;

        break;
    }

    if (firstImport === -1) return null;

    const first = items[firstImport];
    const last = items[end];
    return {
        start: first.startIndex,
        end: last.endIndex,
        imports,
        comments,
        sawEquals,
    };
}

/** Keyed on `pathText` so literals that decode alike but are spelled differently aren't merged and re-spelled. */
function emit(section: Section, withEquals: boolean): string {
    const byPathText = new Map<
        string,
        { path: string; names: Set<string>; fields: [string, string][] }
    >();

    for (const clause of section.imports) {
        let entry = byPathText.get(clause.pathText);
        if (!entry) {
            entry = { path: clause.path, names: new Set(), fields: [] };
            byPathText.set(clause.pathText, entry);
        }
        if (clause.name !== null) entry.names.add(clause.name);
        entry.fields.push(...clause.fields);
    }

    const groups: string[][] = IMPORT_GROUPS.map(() => []);
    const equals = withEquals ? ' =' : '';

    for (const [pathText, entry] of [...byPathText].sort((a, b) =>
        a[1].path.localeCompare(b[1].path),
    )) {
        const index = IMPORT_GROUPS.findIndex((prefix) =>
            entry.path.startsWith(prefix),
        );
        const group = groups[index === -1 ? groups.length - 1 : index];

        for (const name of [...entry.names].sort()) {
            group.push(`import ${name}${equals} ${pathText};`);
        }

        if (entry.fields.length > 0) {
            const unique = [
                ...new Map(
                    entry.fields.map(
                        ([n, a]) => [`${n}:${a}`, [n, a]] as const,
                    ),
                ).values(),
            ].sort(
                (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
            );

            const body = unique
                .map(([n, a]) => (n === a ? n : `${n} = ${a}`))
                .join('; ');

            group.push(`import { ${body} }${equals} ${pathText};`);
        }
    }

    return groups
        .filter((g) => g.length > 0)
        .map((g) => g.join('\n'))
        .join('\n\n');
}

/**
 * The alias is part of the key, since `import { map = m }` and `import { map }` bind different names.
 * `import {} "p"` binds nothing, so it can be dropped.
 */
function bindingsOf(clauses: readonly ImportClause[]): Set<string> {
    const out = new Set<string>();
    for (const clause of clauses) {
        if (clause.name !== null) out.add(`${clause.path}\u0000${clause.name}`);
        for (const [name, alias] of clause.fields) {
            out.add(`${clause.path}\u0000${name}\u0000${alias}`);
        }
    }
    return out;
}

/**
 * Re-parses the emitted imports and checks they bind exactly what the input bound.
 *
 * The guard compares the printer's output with the organized tree, so it can't see the rewrite itself,
 * and a dropped import still re-parses.
 * This isn't independent of `readImport`, but `readImport` never reads a clause partially:
 * an unreadable import refuses the pass before this runs.
 */
async function bindingsPreserved(
    body: string,
    input: readonly ImportClause[],
): Promise<boolean> {
    let reparsed;
    try {
        reparsed = await parseMotoko(body);
    } catch (error) {
        if (error instanceof MotokoSyntaxError) return false;
        throw error;
    }

    const emitted: ImportClause[] = [];
    for (const child of reparsed.root.children) {
        if (!isImport(child) || child.nodeType !== 'Branch') continue;
        const clause = readImport(child);
        if (clause === null) return false;
        emitted.push(clause);
    }

    const before = bindingsOf(input);
    const after = bindingsOf(emitted);
    if (before.size !== after.size) return false;
    for (const binding of before) if (!after.has(binding)) return false;
    return true;
}

/**
 * Reorganizes `source`'s import section, returning the rewritten text or `null` to leave it alone.
 *
 * A section containing any `=` is emitted with `=` on every statement, since combined statements have no single source spelling.
 * Returns `null`, never a partial rewrite, when the section can't be read,
 * when the emitted imports would lose a binding, or when nothing changes.
 */
export async function organizeImportSection(
    source: string,
    root: NormalBranch,
): Promise<string | null> {
    const section = readSection(root);
    if (section === null) return null;
    if (section.imports.length === 0) return null;

    const body = emit(section, section.sawEquals);
    if (body === '') return null; // every import was empty and dropped

    if (!(await bindingsPreserved(body, section.imports))) return null;

    const head = source.slice(0, section.start);
    const tail = source.slice(section.end);

    const commentBlock =
        section.comments.length > 0 ? `\n\n${section.comments.join('\n')}` : '';
    const tailText = tail.trim() === '' ? '' : `\n\n${tail.trimStart()}`;

    const rewritten = `${head}${body}${commentBlock}${tailText}`;
    return rewritten === source ? null : rewritten;
}
