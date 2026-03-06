import { Token, TokenTree } from '../../parsers/motoko-tt-parse/parse';
import { getToken, getTokenText } from './utils';

interface ImportStatement {
    name?: string;
    path: string;
    fields: Array<[string, string]>;
}

const importGroups = [
    { prefix: 'ic:' },
    { prefix: 'canister:' },
    { prefix: 'mo:' },
    { prefix: '' }, // Everything else
];

/**
 * Extracts all import statements from a token tree.
 */
export function extractImports(tree: TokenTree): ImportStatement[] {
    if (tree.token_tree_type !== 'Group') {
        return [];
    }

    const [trees, groupType] = tree.data;
    if (groupType !== 'Unenclosed') {
        return [];
    }

    const imports: ImportStatement[] = [];

    // Walk through the top-level statements
    for (let i = 0; i < trees.length; i++) {
        const token = getToken(trees[i]);
        if (!token || token.token_type !== 'Ident' || token.data !== 'import') {
            continue;
        }

        // Parse the import statement
        const importStmt = parseImportStatement(trees, i);
        if (importStmt) {
            imports.push(importStmt);
        }
    }

    return imports;
}

/**
 * Parses a single import statement starting at the given index.
 * Returns the parsed import or null if parsing fails.
 */
function parseImportStatement(
    trees: TokenTree[],
    startIndex: number,
): ImportStatement | null {
    let i = startIndex + 1; // Skip 'import' keyword

    // Skip whitespace
    while (i < trees.length && isWhitespace(trees[i])) {
        i++;
    }

    const import_: ImportStatement = {
        path: '',
        fields: [],
    };

    // Check if it's a destructured import (starts with '{')
    if (i < trees.length && trees[i].token_tree_type === 'Group') {
        const [groupTrees, groupType] = trees[i].data;
        if (groupType === 'Curly') {
            // Parse destructured fields
            import_.fields = parseDestructuredFields(groupTrees);
            i++;
        }
    } else {
        // Parse module name
        const nameToken = getToken(trees[i]);
        if (nameToken && nameToken.token_type === 'Ident') {
            import_.name = nameToken.data;
            i++;
        }
    }

    // Skip whitespace
    while (i < trees.length && isWhitespace(trees[i])) {
        i++;
    }

    // Parse import path (string literal)
    if (i < trees.length) {
        const pathToken = getToken(trees[i]);
        if (pathToken && pathToken.token_type === 'Literal') {
            const [text, literalType] = pathToken.data;
            if (literalType === 'Text') {
                // Remove quotes from the path
                import_.path = JSON.parse(text);
            }
        }
    }

    return import_.path ? import_ : null;
}

/**
 * Parses destructured import fields from a curly-braced group.
 */
function parseDestructuredFields(trees: TokenTree[]): Array<[string, string]> {
    const fields: Array<[string, string]> = [];
    let currentName: string | null = null;
    let expectingAlias = false;

    for (let i = 0; i < trees.length; i++) {
        const token = getToken(trees[i]);
        if (!token || isWhitespace(trees[i])) {
            continue;
        }

        if (token.token_type === 'Ident') {
            if (expectingAlias) {
                // This is the alias
                if (currentName) {
                    fields.push([currentName, token.data]);
                    currentName = null;
                    expectingAlias = false;
                }
            } else {
                // Save previous field if exists
                if (currentName) {
                    fields.push([currentName, currentName]);
                }
                currentName = token.data;
            }
        } else if (token.token_type === 'Assign' && token.data === '=') {
            expectingAlias = true;
        } else if (token.token_type === 'Delim') {
            // Delimiter - save current field
            if (currentName) {
                fields.push([currentName, currentName]);
                currentName = null;
                expectingAlias = false;
            }
        }
    }

    // Add last field
    if (currentName) {
        fields.push([currentName, currentName]);
    }

    return fields;
}

/**
 * Checks if a token tree represents whitespace or comments.
 */
function isWhitespace(tree: TokenTree): boolean {
    const token = getToken(tree);
    return (
        !!token &&
        ['Space', 'Line', 'MultiLine', 'LineComment', 'BlockComment'].includes(
            token.token_type,
        )
    );
}

/**
 * Organizes and formats import statements.
 */
export function organizeImports(imports: ImportStatement[]): string {
    const groupParts: string[][] = importGroups.map(() => []);

    // Combine imports with the same path
    const combinedImports: Record<
        string,
        { names: string[]; fields: Array<[string, string]> }
    > = {};

    imports.forEach((imp) => {
        const combined =
            combinedImports[imp.path] ||
            (combinedImports[imp.path] = { names: [], fields: [] });

        if (imp.name) {
            combined.names.push(imp.name);
        }
        combined.fields.push(...imp.fields);
    });

    // Sort and print imports
    Object.entries(combinedImports)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([path, { names, fields }]) => {
            let groupIndex = importGroups.findIndex((g) =>
                path.startsWith(g.prefix),
            );
            if (groupIndex === -1) {
                groupIndex = importGroups.length - 1;
            }
            const parts = groupParts[groupIndex];

            // Add module-level imports
            names.forEach((name) => {
                parts.push(`import ${name} ${JSON.stringify(path)};`);
            });

            // Add destructured imports
            if (fields.length) {
                // Remove duplicates and sort
                const uniqueFields = Array.from(
                    new Map(
                        fields.map(([name, alias]) => [
                            `${name}:${alias}`,
                            [name, alias],
                        ]),
                    ).values(),
                );

                uniqueFields.sort((a, b) => {
                    // Sort by name, then alias
                    return (
                        a[0].localeCompare(b[0]) ||
                        (a[1] || a[0]).localeCompare(b[1] || b[0])
                    );
                });

                const fieldStr = uniqueFields
                    .map(([name, alias]) =>
                        !alias || name === alias ? name : `${name} = ${alias}`,
                    )
                    .join('; ');

                parts.push(`import { ${fieldStr} } ${JSON.stringify(path)};`);
            }
        });

    // Join groups with double newlines
    return groupParts
        .map((p) => p.join('\n'))
        .filter((s) => s.length > 0)
        .join('\n\n');
}

/**
 * Finds the range of import statements in the token tree.
 * Returns [startIndex, endIndex] or null if no imports found.
 */
export function findImportRange(tree: TokenTree): [number, number] | null {
    if (tree.token_tree_type !== 'Group') {
        return null;
    }

    const [trees, groupType] = tree.data;
    if (groupType !== 'Unenclosed') {
        return null;
    }

    let firstImportIndex = -1;
    let lastImportIndex = -1;

    for (let i = 0; i < trees.length; i++) {
        const token = getToken(trees[i]);
        if (token && token.token_type === 'Ident' && token.data === 'import') {
            if (firstImportIndex === -1) {
                firstImportIndex = i;
            }

            // Find the end of this import statement (semicolon or newline)
            let j = i + 1;
            while (j < trees.length) {
                const nextToken = getToken(trees[j]);
                if (
                    nextToken &&
                    (nextToken.token_type === 'Delim' ||
                        nextToken.token_type === 'MultiLine')
                ) {
                    lastImportIndex = j;
                    break;
                }
                j++;
            }

            // Move to after this import statement
            i = j;
        } else if (firstImportIndex !== -1 && !isWhitespace(trees[i])) {
            // Found a non-import, non-whitespace token after imports
            break;
        }
    }

    return firstImportIndex !== -1 && lastImportIndex !== -1
        ? [firstImportIndex, lastImportIndex]
        : null;
}

/**
 * Transforms a token tree by organizing its import statements.
 * Returns a new tree with organized imports.
 */
export function transformTreeWithOrganizedImports(tree: TokenTree): TokenTree {
    if (tree.token_tree_type !== 'Group') {
        return tree;
    }

    const [trees, groupType, pair] = tree.data;
    if (groupType !== 'Unenclosed') {
        return tree;
    }

    // Extract imports
    const imports = extractImports(tree);
    if (imports.length === 0) {
        return tree;
    }

    // Find import range
    const range = findImportRange(tree);
    if (!range) {
        return tree;
    }

    const [startIndex, endIndex] = range;

    // Generate organized import text
    const organizedText = organizeImports(imports);

    // Parse organized imports back into token trees
    // We'll use the WASM parser here
    const wasm = require('../../wasm').default;
    const organizedTree = wasm.parse_token_tree(organizedText.trim());

    // Extract the import tokens from the organized tree
    let organizedImportTrees: TokenTree[] = [];
    if (organizedTree.token_tree_type === 'Group') {
        organizedImportTrees = organizedTree.data[0];
    }

    // Build new tree: keep everything before imports, add organized imports, keep everything after imports
    const newTrees: TokenTree[] = [
        ...trees.slice(0, startIndex),
        ...organizedImportTrees,
    ];

    // Add whitespace separation if there's content after imports
    if (endIndex + 1 < trees.length) {
        // Find the first non-whitespace token after imports
        let nextNonWhitespace = endIndex + 1;
        while (
            nextNonWhitespace < trees.length &&
            isWhitespace(trees[nextNonWhitespace])
        ) {
            nextNonWhitespace++;
        }

        if (nextNonWhitespace < trees.length) {
            // Add double newline after imports
            newTrees.push({
                token_tree_type: 'Token',
                data: [
                    { token_type: 'MultiLine', data: '\n\n' },
                    { line: 0, col: 0, span: [0, 0] },
                ],
            });
            newTrees.push(...trees.slice(nextNonWhitespace));
        }
    }

    return {
        token_tree_type: 'Group',
        data: [newTrees, groupType, pair],
    };
}
