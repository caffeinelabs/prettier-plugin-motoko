/**
 * `organize/imports.ts` — rewrite a file's leading import section, as **text**, before it is parsed.
 *
 * ## Why the rewrite is text and not a tree
 *
 * Organizing imports is the one feature that *must* change a token sequence: combining two
 * `import { map } "p"` / `import { filter } "p"` statements into one deletes an `import` keyword and
 * a `;`, and dropping `import {} "mo:base/Empty"` deletes a whole statement. `preserve` may do
 * neither — `src/verify.ts` compares token texts and a separator is a token — so the guard is
 * satisfied the way it already is for `moc2`: **tell it the tree the output should have.** The
 * rewrite produces new source text, that text is re-parsed, and the *re-parsed* tree is what both the
 * printer and the guard see. `src/verify.ts`'s `verifyOutput` doc comment names this pattern
 * ("for `moc2` the caller passes the *rewritten* tree"); this module is the second caller of it.
 *
 * The alternative — permuting nodes inside the printer and passing a hand-built expectation tree to
 * `verifyOutput` — was rejected for two reasons. It needs a synthetic tree whose token texts match
 * what re-parsing emits, which is exactly the fiddly, silently-vacuous place a guard stops guarding;
 * and for the combine/drop cases no tree built from the *input's* nodes can be right, because the
 * input has nodes the output does not. Re-parsing the real text removes both problems and makes the
 * guard *stronger* here, not weaker: it compares genuine parse trees on both sides, with no
 * `TOLERATED_KINDS` entry and no change to `compareShapes`.
 *
 * ## Why the pass refuses rather than repairs
 *
 * Every "I do not understand this" path returns `null` — leave the source alone and format it as
 * written. That is the safe direction, and it is what keeps a half-understood file from being
 * silently mangled: a section this pass cannot read is a section it does not touch.
 *
 * The refusals, each of which was measured rather than assumed:
 *
 *  - a non-import, non-comment item *before* the first import (the preamble is not understood);
 *  - an import node that is not exactly the shapes this module reads (a comment *inside* an import
 *    statement is the real case: `import /* c *\/ A "mo:a";` parses, and the comment is a child of the
 *    `import` branch, so a pass reading only siblings would silently drop it);
 *  - a `=`-spelled import whose spelling disagrees with the mode being honoured (see `honourEquals`);
 *  - any item the section walk cannot classify.
 *
 * ## What the pass deliberately does NOT do
 *
 * It does not format. Spacing *inside* the emitted imports is canonical (`import { a; b } "p"`),
 * because the statement is being rebuilt from its parts; but the printer still owns the section's
 * blank lines and the rest of the file, and re-running it twice must be a fixed point. That is why
 * the emitted text is exactly what the printer would print for those same imports, and why the
 * section is emitted at all only when the result actually differs from the source.
 */

import type {
    NormalBranch,
    NormalChild,
    NormalToken,
} from '../parser/normalize.ts';
import { parse as parseMotoko } from '../parser/parse.ts';
import { isComment, isImport } from '../printer/parts.ts';

/**
 * Path groups, in emit order. A path matches the first prefix it starts with; `''` is the catch-all
 * so it must stay last. `ic:` and `canister:` are the IC's own namespaces, `mo:` is Mops, and
 * everything else (`./utils`, `../lib`) is a local file — grouped last because a local import's
 * identity is its path, not a package.
 */
const IMPORT_GROUPS: readonly string[] = ['ic:', 'canister:', 'mo:', ''];

/** `import A "mo:a";` / `import { map } "mo:a";` / `import { map = m } "mo:a";`, decoded. */
interface ImportClause {
    /** The path as written between the quotes, e.g. `mo:base/Array`. */
    path: string;
    /** The path's literal token text, quotes included — reused verbatim so escapes survive. */
    pathText: string;
    /** The bound name of a plain import, or `null` for the destructured form. */
    name: string | null;
    /** Destructured fields as `[name, alias]`, where `name === alias` when there is no alias. */
    fields: [string, string][];
    /** Whether this statement was spelled with an explicit `=` (`import X = "p"`). */
    equals: boolean;
}

/** The section's span and contents. */
interface Section {
    /** Byte offset of the first import — **not** the file start; a header comment stays in `head`. */
    start: number;
    /** Byte offset just past the last import-section item. */
    end: number;
    /** The imports, in source order. */
    imports: ImportClause[];
    /** Comment items *inside* the section, in source order. */
    comments: string[];
    /** Whether any import was spelled with an explicit `=`. */
    sawEquals: boolean;
}

/** Every token and branch child of a node, in source order. */
function elementChildren(node: NormalBranch): NormalChild[] {
    return node.children;
}

/** The text of a token child, or `null` when the child is not a token. */
function tokenOf(child: NormalChild): NormalToken | null {
    return child.nodeType === 'Token' ? child : null;
}

/**
 * Read one `import` branch into an `ImportClause`, or `null` when it is not a shape this pass knows.
 *
 * Written as a total function over *observed* shapes rather than a grammar walk. The three children
 * that carry meaning are the pattern (a `var_pat` with one `identifier`, or an `obj_pat` of
 * `val_pat_field`s), an optional `=` token, and the `text_literal` path. Anything else — an extra
 * branch, a missing path, a comment inside — makes this return `null`, and the caller then refuses
 * to touch the file.
 *
 * The `fields` of a `val_pat_field` are read positionally, which is sound because the grammar's
 * alternatives are distinguishable by shape: `map` is one `identifier`, `map = m` is
 * `identifier`, `=`, `var_pat(identifier)`. A field with any other content is unreadable, not
 * guessed at.
 */
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
                if (pathText !== null) return null; // two paths: not an import we understand
                pathText = child.text;
            } else if (child.text === '=') {
                sawEquals = true;
            }
            continue;
        }

        // A comment inside the statement. Refusing is the safe direction: it is a child of this
        // branch, so nothing else in this module would see it, and re-emitting the statement from
        // its parts would silently drop it.
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
                    // The braces, and the `;` separators between fields.
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

        return null; // an unreadable child kind
    }

    if (pathText === null || !sawPattern) return null;
    if (name !== null && fields.length > 0) return null; // both forms at once

    // `JSON.parse` rather than stripping the quotes: a path can carry escapes, and the decoded value
    // is what groups and sorts. The emitted text reuses `pathText` verbatim, so the spelling never
    // round-trips through JSON — only the comparison key does.
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

/**
 * One `val_pat_field`: `name` or `name = alias`.
 *
 * Read positionally, which the grammar makes sound — a bare field is a lone `identifier` token,
 * and an aliased one is `identifier`, `=`, `var_pat(identifier)`. Measured shapes:
 *
 *   Branch:val_pat_field > Token:identifier "map"
 *   Branch:val_pat_field > Token:identifier "map" ; Token:= "=" ; Branch:var_pat > Token:identifier "mapArray"
 *
 * The alias is a `var_pat` **branch**, not a token, so it has to be unwrapped rather than read
 * directly; reading `parts[2]` as a token is what made the aliased forms refuse to be organized.
 */
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
 * Find the file's leading import section, or `null` when there is nothing this pass should touch.
 *
 * The section is the **maximal leading run of items that are imports or comments, provided it
 * contains an import**. A comment *before* the first import is walked past but does not open the
 * section — it is the file's header (the legacy suite's `/* Core imports *\/` case), and it stays
 * where it is. That anchoring is the one subtle part of this function: anchoring `start` on the first
 * *item* rather than the first *import* duplicates a header comment into the tail. The section's
 * `start` is therefore the first import's offset, and everything before it is copied out unchanged.
 *
 * Comment items inside the section are collected in source order and re-emitted after the organized
 * imports, which is what the legacy suite pins in its `inline comments`, `comments between imports`
 * and `preserve spacing` cases.
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

        // The `;` that terminates an import statement is a **sibling** of the `import` branch at
        // root level, not one of its children. Measured:
        //   [0] Branch(import) [0,28) "import Array \"mo:base/Array\""
        //   [1] Token(;)       [28,29) ";"
        // The section has to step over it, or `end` lands mid-statement and the rewrite emits the
        // `;` on a line of its own — which does not re-parse, so the pass's own re-parse refuses
        // the file. Only a `;` that directly follows an import is absorbed; one anywhere else
        // ends the section like any other declaration would.
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
            // A comment before any import is the file's header, not the section's content.
            if (firstImport === -1) continue;
            comments.push(item.text);
            end = i;
            continue;
        }

        break; // the section ends at the first real declaration
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

/**
 * Combine the clauses by path, then group, then sort. Mirrors 0.13's `organizeImports`.
 *
 * The map is keyed on `pathText` — the literal **as written**, quotes included — and not on the
 * decoded `path`. Two literals can decode identically while being different text
 * (`"mo:base/Array"` and `"mo:base/Array"` both parse and both decode to `mo:base/Array`), and
 * keying on the decoded value would merge them and silently re-spell one of them. Combining is only
 * ever meant to fold statements that *are* the same import; different literal text is not that.
 * The decoded `path` is still what sorting and grouping use, since those are about which package the
 * import names, not how it is spelled.
 */
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
 * Every binding a clause introduces, as comparable strings: `path` for a plain import, and
 * `path`+field name (+alias) for each destructured field. A clause that binds nothing —
 * `import {} "p"` — contributes nothing, which is what makes it legitimately droppable.
 *
 * The alias is part of the key because `import { map = m }` and `import { map }` bind different
 * things: a rewrite that lost the `m` would otherwise compare equal.
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
 * Does the emitted body still bind everything the input bound?
 *
 * ## Why this exists, and exactly what it covers
 *
 * This pass is **self-authorizing**: it produces the rewritten text *and* the tree the guard will
 * compare against, so `src/verify.ts` cannot see the rewrite step itself — its only question about
 * it is "does this text re-parse", which a dropped import passes. That gap is inherent to the
 * rewritten-tree pattern this module deliberately reuses (see the header), and it is the one place
 * this feature can lose a user's import silently, so it is closed here rather than left implicit.
 *
 * The check re-parses the emitted body **with the real parser** and re-reads it with `readImport`,
 * then requires the binding set to be identical. Re-parsing is what makes it more than a restatement
 * of the emitter: the comparison is between what the emitter *meant* to write and what the grammar
 * actually *reads back*.
 *
 * Its limit, stated plainly: it is not independent of `readImport`. A `readImport` blind spot would
 * affect both sides equally and this check would not catch it. That is bounded because `readImport`
 * has exactly one failure mode — returning `null` — and it never partially reads a clause: an
 * unreadable import makes the whole pass refuse at `readSection`, so nothing unread survives into
 * either side of this comparison.
 */
async function bindingsPreserved(
    body: string,
    input: readonly ImportClause[],
): Promise<boolean> {
    const reparsed = await parseMotoko(body);
    if (reparsed.problems.length > 0) return false;

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
 * Reorganize `source`'s import section, returning the rewritten text or `null` to leave it alone.
 *
 * `mode` decides whether an explicit `=` is *kept*. `preserve` keeps each statement's spelling as the
 * source had it, so a section containing any `=` is emitted with `=` on every statement (the statements
 * are rebuilt, so per-statement spelling is not recoverable once they are combined); a section with no
 * `=` is emitted in the original bare spelling. `moc2` always emits the `=` form, which is the 2.0
 * spelling. Making the choice once per section rather than once per statement is what keeps the
 * output from mixing the two spellings inside one run of imports.
 *
 * Returns `null` — never a partial rewrite — whenever the section cannot be read, when there is no
 * import at all, when the emitted body would not bind everything the input bound (see
 * `bindingsPreserved`), or when the result would be byte-identical to the source.
 */
export async function organizeImportSection(
    source: string,
    root: NormalBranch,
    mode: 'preserve' | 'moc2',
): Promise<string | null> {
    const section = readSection(root);
    if (section === null) return null;
    if (section.imports.length === 0) return null;

    // In `preserve`, only a section the source itself spelled with `=` is emitted with `=`.
    const withEquals = mode === 'moc2' ? true : section.sawEquals;
    const body = emit(section, withEquals);
    if (body === '') return null; // every import was empty and dropped

    // The pass authors both sides of the guard's comparison here, so preservation is checked
    // against the grammar itself before the rewrite is allowed through.
    if (!(await bindingsPreserved(body, section.imports))) return null;

    const head = source.slice(0, section.start);
    const tail = source.slice(section.end);

    const commentBlock =
        section.comments.length > 0 ? `\n\n${section.comments.join('\n')}` : '';
    const tailText = tail.trim() === '' ? '' : `\n\n${tail.trimStart()}`;

    const rewritten = `${head}${body}${commentBlock}${tailText}`;
    return rewritten === source ? null : rewritten;
}
