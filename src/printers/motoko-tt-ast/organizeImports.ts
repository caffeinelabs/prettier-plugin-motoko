import { Token, TokenTree } from '../../parsers/motoko-tt-parse/parse';
import { getToken } from './utils';

interface ImportStatement {
    name?: string;
    path: string;
    fields: Array<[string, string]>;
}

const IMPORT_GROUPS = ['ic:', 'canister:', 'mo:', ''];
const WHITESPACE_TYPES = [
    'Space',
    'Line',
    'MultiLine',
    'LineComment',
    'BlockComment',
];

function isWhitespace(tree: TokenTree): boolean {
    const token = getToken(tree);
    return !!token && WHITESPACE_TYPES.includes(token.token_type);
}

function skipWhitespace(trees: TokenTree[], start: number): number {
    let i = start;
    while (i < trees.length && isWhitespace(trees[i])) i++;
    return i;
}

function isImportKeyword(tree: TokenTree): boolean {
    const token = getToken(tree);
    return !!token && token.token_type === 'Ident' && token.data === 'import';
}

function extractImports(tree: TokenTree): ImportStatement[] {
    if (tree.token_tree_type !== 'Group') return [];
    const [trees, groupType] = tree.data;
    if (groupType !== 'Unenclosed') return [];

    return trees
        .map((tree, i) =>
            isImportKeyword(tree) ? parseImportStatement(trees, i) : null,
        )
        .filter((imp): imp is ImportStatement => !!imp?.path);
}

function parseImportStatement(
    trees: TokenTree[],
    startIndex: number,
): ImportStatement | null {
    try {
        let i = skipWhitespace(trees, startIndex + 1);
        if (i >= trees.length) return null;

        const import_: ImportStatement = { path: '', fields: [] };

        // Check for destructured import
        if (trees[i].token_tree_type === 'Group') {
            const [groupTrees, groupType] = trees[i].data;
            if (groupType === 'Curly') {
                import_.fields = parseDestructuredFields(groupTrees);
                i++;
            }
        } else {
            const nameToken = getToken(trees[i]);
            if (nameToken?.token_type === 'Ident') {
                import_.name = nameToken.data;
                i++;
            }
        }

        i = skipWhitespace(trees, i);

        // Parse import path
        const pathToken = getToken(trees[i]);
        if (pathToken?.token_type === 'Literal') {
            const [text, literalType] = pathToken.data;
            if (literalType === 'Text') {
                try {
                    import_.path = JSON.parse(text);
                } catch {
                    return null;
                }
            }
        }

        return import_.path ? import_ : null;
    } catch {
        return null;
    }
}

function parseDestructuredFields(trees: TokenTree[]): Array<[string, string]> {
    const fields: Array<[string, string]> = [];
    let current: string | null = null;
    let expectAlias = false;

    for (const tree of trees) {
        const token = getToken(tree);
        if (!token || isWhitespace(tree)) continue;

        if (token.token_type === 'Ident') {
            if (expectAlias && current) {
                fields.push([current, token.data]);
                current = null;
                expectAlias = false;
            } else {
                if (current) fields.push([current, current]);
                current = token.data;
            }
        } else if (token.token_type === 'Assign' && token.data === '=') {
            expectAlias = true;
        } else if (token.token_type === 'Delim') {
            if (current) fields.push([current, current]);
            current = null;
            expectAlias = false;
        }
    }

    if (current) fields.push([current, current]);
    return fields;
}

function organizeImports(imports: ImportStatement[]): string {
    // Combine imports by path
    const combined = new Map<
        string,
        { names: Set<string>; fields: Array<[string, string]> }
    >();

    for (const imp of imports) {
        const entry = combined.get(imp.path) || {
            names: new Set<string>(),
            fields: [],
        };
        if (!combined.has(imp.path)) combined.set(imp.path, entry);
        if (imp.name) entry.names.add(imp.name);
        entry.fields.push(...imp.fields);
    }

    // Group by prefix
    const groups = IMPORT_GROUPS.map(() => [] as string[]);

    for (const [path, { names, fields }] of Array.from(combined).sort((a, b) =>
        a[0].localeCompare(b[0]),
    )) {
        const groupIndex = IMPORT_GROUPS.findIndex((prefix) =>
            path.startsWith(prefix),
        );
        const group =
            groups[groupIndex === -1 ? groups.length - 1 : groupIndex];

        // Module-level imports
        for (const name of Array.from(names).sort()) {
            group.push(`import ${name} ${JSON.stringify(path)};`);
        }

        // Destructured imports
        if (fields.length) {
            const uniqueFields = Array.from(
                new Map(
                    fields.map(([n, a]) => [`${n}:${a}`, [n, a]] as const),
                ).values(),
            ).sort(
                (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
            );

            const fieldStr = uniqueFields
                .map(([n, a]) => (n === a ? n : `${n} = ${a}`))
                .join('; ');

            group.push(`import { ${fieldStr} } ${JSON.stringify(path)};`);
        }
    }

    return groups
        .filter((g) => g.length)
        .map((g) => g.join('\n'))
        .join('\n\n');
}

function findImportRange(tree: TokenTree): [number, number] | null {
    if (tree.token_tree_type !== 'Group') return null;
    const [trees, groupType] = tree.data;
    if (groupType !== 'Unenclosed') return null;

    let first = -1;
    let last = -1;

    for (let i = 0; i < trees.length; i++) {
        if (isImportKeyword(trees[i])) {
            if (first === -1) first = i;

            // Find end of this import statement
            let j = i + 1;
            while (j < trees.length) {
                const token = getToken(trees[j]);
                if (
                    token &&
                    (token.token_type === 'Delim' ||
                        token.token_type === 'MultiLine')
                ) {
                    last = j;
                    break;
                }
                j++;
            }
            i = j;
        } else if (first !== -1 && !isWhitespace(trees[i])) {
            break; // Found non-import after imports
        }
    }

    return first !== -1 && last !== -1 ? [first, last] : null;
}

function validateImportsPreserved(
    original: ImportStatement[],
    organized: ImportStatement[],
): boolean {
    const groupByPath = (imports: ImportStatement[]) => {
        const map = new Map<
            string,
            { names: Set<string>; fields: Set<string> }
        >();
        for (const imp of imports) {
            const entry = map.get(imp.path) || {
                names: new Set<string>(),
                fields: new Set<string>(),
            };
            if (!map.has(imp.path)) map.set(imp.path, entry);
            if (imp.name) entry.names.add(imp.name);
            for (const [name, alias] of imp.fields) {
                entry.fields.add(`${name}:${alias}`);
            }
        }
        return map;
    };

    const origMap = groupByPath(original);
    const orgMap = groupByPath(organized);

    for (const [path, orig] of origMap) {
        // Skip empty imports (intentionally dropped)
        if (orig.names.size === 0 && orig.fields.size === 0) continue;

        const org = orgMap.get(path);
        if (!org) {
            console.warn(`Path ${path} missing after organizing`);
            return false;
        }

        for (const name of orig.names) {
            if (!org.names.has(name)) {
                console.warn(
                    `Name "${name}" for path ${path} missing after organizing`,
                );
                return false;
            }
        }

        for (const field of orig.fields) {
            if (!org.fields.has(field)) {
                console.warn(
                    `Field "${field}" for path ${path} missing after organizing`,
                );
                return false;
            }
        }
    }

    for (const path of orgMap.keys()) {
        if (!origMap.has(path)) {
            console.warn(`Unexpected path ${path} added after organizing`);
            return false;
        }
    }

    return true;
}

export function transformOrganizeImports(tree: TokenTree): TokenTree {
    if (tree.token_tree_type !== 'Group') return tree;
    const [trees, groupType, pair] = tree.data;
    if (groupType !== 'Unenclosed') return tree;

    try {
        const range = findImportRange(tree);
        if (!range) return tree;

        const [start, end] = range;
        const origCount = trees
            .slice(start, end + 1)
            .filter(isImportKeyword).length;
        if (origCount === 0) return tree;

        const imports = extractImports(tree);
        const validCount = imports.length;

        // If we found fewer valid imports than original, some are malformed
        if (validCount < origCount) {
            console.warn(
                `Found ${origCount} imports but only ${validCount} parsed. Preserving original.`,
            );
            return tree;
        }

        const organizedText = organizeImports(imports);
        if (!organizedText.trim()) return tree;

        // Parse organized imports back
        const wasm = require('../../wasm').default;
        const organizedTree = wasm.parse_token_tree(organizedText.trim());

        if (organizedTree.token_tree_type !== 'Group') {
            console.warn(
                'Failed to parse organized imports. Preserving original.',
            );
            return tree;
        }

        const organizedTrees = organizedTree.data[0];
        const organizedCount = organizedTrees.filter(isImportKeyword).length;

        if (organizedCount === 0) {
            console.warn('No imports in organized tree. Preserving original.');
            return tree;
        }

        // Validate that all original imports are preserved in the organized version
        const organizedImports = extractImports(organizedTree);
        if (!validateImportsPreserved(imports, organizedImports)) {
            console.warn('Import data changed. Preserving original.');
            return tree;
        }

        // Build new tree
        const newTrees = [...trees.slice(0, start), ...organizedTrees];

        // Add spacing if there's content after imports
        const nextNonWs = skipWhitespace(trees, end + 1);
        if (nextNonWs < trees.length) {
            newTrees.push({
                token_tree_type: 'Token',
                data: [
                    { token_type: 'MultiLine', data: '\n\n' },
                    { line: 0, col: 0, span: [0, 0] },
                ],
            });
            newTrees.push(...trees.slice(nextNonWs));
        }

        return { token_tree_type: 'Group', data: [newTrees, groupType, pair] };
    } catch (error) {
        console.warn(
            'Error organizing imports:',
            error instanceof Error ? error.message : String(error),
        );
        return tree;
    }
}
