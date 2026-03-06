import {
    Token,
    TokenTree,
    GroupType,
} from './../../parsers/motoko-tt-parse/parse';
import { doc, AstPath, Doc, ParserOptions } from 'prettier';
import spaceConfig, { doesTokenTreeMatchPattern } from './spaceConfig';
import {
    getToken,
    getTokenText,
    getTokenTreeText,
    withoutLineBreaks,
} from './utils';
import { transformTreeWithOrganizedImports } from './organizeImports';

export type Space =
    | (
          | 'nil'
          | 'space'
          | 'line'
          | 'softline'
          | 'hardline'
          | 'wrap'
          | 'softwrap'
          | 'keep'
          | 'keep-space'
      )
    | Space[];

// Documentation: https://github.com/prettier/prettier/blob/main/commands.md
const {
    builders: {
        group,
        fill,
        ifBreak,
        breakParent,
        indent,
        indentIfBreak,
        // label,
        line,
        softline,
        hardline,
        lineSuffix,
        hardlineWithoutBreakParent,
        literallineWithoutBreakParent,
    },
} = doc;

const space = ' ';
// const wrapIndent = indent(line);
const wrapIndent = line;

export function parseSpace(
    input: Space,
    a: TokenTree,
    b: TokenTree,
    leftMap: Map<TokenTree, TokenTree>,
    rightMap: Map<TokenTree, TokenTree>,
): Doc {
    if (typeof input === 'string') {
        switch (input) {
            case 'nil':
                return [];
            case 'space':
                return space;
            case 'line':
                return line;
            case 'softline':
                return softline;
            case 'hardline':
                return hardline;
            case 'wrap':
                // return ifBreak(wrapIndent, space);
                return line;
            case 'softwrap':
                // return ifBreak(wrapIndent);
                return softline;
            case 'keep':
            case 'keep-space':
                let right = rightMap.get(a);
                if (right === b) {
                    return input === 'keep-space' ? space : [];
                }
                let result: Doc = space;
                do {
                    const token = getToken(right);
                    if (token) {
                        if (token.token_type === 'MultiLine') {
                            return printToken(token);
                        }
                        if (token.token_type === 'Line') {
                            result = printToken(token);
                        }
                    }
                    right &&= rightMap.get(right);
                } while (right !== b);
                return result;
            default:
                throw new Error(`Unimplemented space type: ${input}`);
        }
    } else if (Array.isArray(input)) {
        return input.map((x) => parseSpace(x, a, b, leftMap, rightMap));
    }
    throw new Error(`Unknown space: ${JSON.stringify(input)}`);
}

const removeTokenTypes = ['Space', 'Line'];

export default function print(
    path: AstPath<TokenTree>,
    options: ParserOptions<TokenTree>,
    print: (path: AstPath<TokenTree>) => Doc,
    args?: unknown,
): Doc {
    let tree = path.getValue();
    if (tree === null) {
        return '';
    }
    
    // Organize imports if option is enabled
    if ((options as any).motokoOrganizeImports && tree.token_tree_type === 'Group') {
        tree = transformTreeWithOrganizedImports(tree);
    }
    
    const doc = printTokenTree(tree, path, options, print, args);
    return doc || (Array.isArray(doc) && doc.length)
        ? [doc, literallineWithoutBreakParent]
        : doc;
}

function shouldSkipTokenTree(tree: TokenTree): boolean {
    const token = getToken(tree);
    return !!token && removeTokenTypes.includes(token.token_type);
}

function getGroupDelimToken(
    groupType: GroupType,
    hasWithKeyword: boolean,
): Token {
    return {
        token_type: 'Delim',
        data:
            groupType === 'Unenclosed' ||
            groupType === 'Curly' ||
            hasWithKeyword
                ? [';', 'Semi']
                : [',', 'Comma'],
    };
}

function printTokenTree(
    tree: TokenTree,
    path: AstPath<TokenTree>,
    options: ParserOptions<TokenTree>,
    print: (path: AstPath<TokenTree>) => Doc,
    args?: unknown,
): Doc {
    if (tree.token_tree_type === 'Group') {
        const [originalTrees, groupType, pair] = tree.data;

        if (groupType === 'Comment') {
            return getTokenTreeText(tree);
        }

        // console.log(JSON.stringify(originalTrees.map((t) => t.data), null, 2)); /////

        const leftMap = new Map<TokenTree, TokenTree>();
        const rightMap = new Map<TokenTree, TokenTree>();

        const shouldBreak = (
            tt: TokenTree & { _shouldBreak?: boolean },
        ): boolean => {
            if ('_shouldBreak' in tt) {
                // use incremental cache to reduce time complexity
                return !!tt._shouldBreak;
            }
            if (tt.token_tree_type === 'Group') {
                const [trees] = tt.data;
                tt._shouldBreak =
                    trees.some((tt) => shouldBreak(tt)) &&
                    !trees.every((tt) => {
                        // don't force break if all whitespace and/or nested groups
                        const token = getToken(tt);
                        return (
                            !token || // group
                            token.token_type === 'Line' ||
                            token.token_type === 'MultiLine'
                        );
                    });
            } else {
                const token = getToken(tt);
                if (token) {
                    tt._shouldBreak =
                        token.token_type === 'Line' ||
                        token.token_type === 'MultiLine' ||
                        token.token_type === 'LineComment';
                }
            }
            return !!tt._shouldBreak;
        };
        let shouldBreakTree = shouldBreak(tree);

        const trees = originalTrees.filter((tt, i) => {
            const left = originalTrees[i - 1];
            if (left) {
                leftMap.set(tt, left);
            }
            const right = originalTrees[i + 1];
            if (right) {
                rightMap.set(tt, right);
            }
            return (
                !shouldSkipTokenTree(tt) &&
                !(
                    // Remove empty lines at start/end of code block
                    (
                        options.motokoRemoveLinesAroundCodeBlocks &&
                        getToken(tt)?.token_type === 'MultiLine' &&
                        (i === 0 || i === originalTrees.length - 1)
                    )
                )
            );
        });

        // nested groups such as `((a, b, ...))`
        const hasNestedGroup =
            (groupType === 'Square' || groupType === 'Paren') &&
            trees.length === 1 &&
            trees[0].token_tree_type === 'Group';

        const shouldKeepSameLine = () => {
            if (groupType === 'Angle') {
                return true;
            }
            if (groupType === 'Square' || groupType === 'Paren') {
                // if (hasNestedGroup) {
                //     return false;
                // }
                // return results.length <= 1 && !shouldBreakTree;
                return !hasNestedGroup && !shouldBreakTree;
            }
            return false;
        };

        // check if the current block is possibly a record extension (see #70)
        const isPossiblyRecordExtension = () => {
            if (groupType !== 'Curly') {
                return false;
            }
            let hasWith = false;
            let hasAnd = false;
            let hasAssign = false;
            let hasDelim = false;
            trees.forEach((tree) => {
                let token = getToken(tree);
                if (!token) {
                    return false;
                } else if (token.token_type === 'Ident') {
                    if (token.data === 'and') {
                        hasAnd = true;
                    } else if (token.data === 'with') {
                        hasWith = true;
                    }
                } else if (
                    token.token_type === 'Assign' &&
                    token.data === '='
                ) {
                    hasAssign = true;
                } else if (token.token_type === 'Delim') {
                    hasDelim = true;
                }
            });
            return !hasDelim && ((hasWith && hasAssign) || hasAnd);
        };

        const results: Doc[] = [];
        let resultGroup: Doc[] = [];
        let ignoringNextStatement = false;
        let allowTrailingSeparator = false;
        const endGroup = () => {
            if (resultGroup.length) {
                results.push(fill(resultGroup));
                resultGroup = [];
                ignoringNextStatement = false;
            }
        };

        let hasWithKeyword = false;
        let importSection: boolean | undefined;
        for (let i = 0; i < trees.length; i++) {
            let a = trees[i]!;

            // check if the most recent token is a delimiter and/or line break separator
            let isDelim = false;
            let isSeparator = false;
            let comment;
            if (a.token_tree_type === 'Token') {
                const [token] = a.data;
                isDelim = token.token_type === 'Delim';
                isSeparator =
                    isDelim ||
                    ['MultiLine', 'LineComment'].includes(token.token_type);

                if (token.token_type === 'LineComment') {
                    comment = getTokenText(token).slice(2).trim();
                } else if (token.token_type === 'BlockComment') {
                    comment = getTokenText(token).slice(2, -2).trim();
                } else if (
                    token.token_type === 'Ident' &&
                    token.data == 'with'
                ) {
                    hasWithKeyword = true;
                } else if (
                    token.token_type === 'Ident' &&
                    token.data === 'import'
                ) {
                    if (importSection === undefined) {
                        importSection = true;
                    }
                } else if (
                    importSection &&
                    (resultGroup.length === 0 ||
                        token.token_type === 'MultiLine')
                ) {
                    importSection = false;
                    if (token.token_type !== 'MultiLine') {
                        resultGroup.push(hardline);
                    }
                }
            } else if (a.token_tree_type === 'Group') {
                const [, groupType] = a.data;
                if (groupType === 'Comment') {
                    comment = getTokenTreeText(a).slice(2, -2).trim();
                }
            }

            // allow trailing delimiter for everything except comments
            if (comment === undefined) {
                // allow trailing comma/semicolon if something exists in the group other than a comment
                allowTrailingSeparator = true;
            }

            const isIgnoreComment = comment === 'prettier-ignore';

            if (isSeparator) {
                endGroup();
                // reset to default
                allowTrailingSeparator = false;
            }

            if (ignoringNextStatement) {
                // print without formatting

                const ignoreDoc = [];
                let tt = a;
                do {
                    ignoreDoc.unshift(getTokenTreeText(tt));
                } while (
                    leftMap.has(tt) &&
                    shouldSkipTokenTree((tt = leftMap.get(tt)!))
                );
                resultGroup.push(ignoreDoc);
            } else {
                // format token

                const resultArray = isSeparator ? results : resultGroup;
                // add everything except trailing delimiter
                if (!isDelim || i !== trees.length - 1) {
                    resultArray.push(
                        isDelim
                            ? printToken(
                                  getGroupDelimToken(groupType, hasWithKeyword),
                              )
                            : printTokenTree(a, path, options, print, args),
                    );
                }
                if (!isIgnoreComment && i !== trees.length - 1) {
                    resultArray.push(
                        printBetween(
                            groupType,
                            trees,
                            i,
                            i + 1,
                            leftMap,
                            rightMap,
                        ),
                    );
                } else if (results.length || resultGroup.length) {
                    endGroup();

                    // trailing delimiter
                    if (
                        (allowTrailingSeparator ||
                            !results.length ||
                            isDelim) &&
                        (!isSeparator || isDelim) &&
                        !hasNestedGroup &&
                        !shouldKeepSameLine() &&
                        (groupType !== 'Paren' || results.length > 1) &&
                        (groupType === 'Unenclosed' || groupType === 'Curly'
                            ? options.semi
                            : options.trailingComma &&
                              options.trailingComma !== 'none') &&
                        !isPossiblyRecordExtension() &&
                        !(
                            groupType === 'Square' &&
                            results.length === 1 &&
                            !isSeparator
                        ) // possibly array type
                    ) {
                        const delimDoc = printToken(
                            getGroupDelimToken(groupType, hasWithKeyword),
                        );
                        results.push(
                            // special case for semicolon at end of single-line Motoko file
                            groupType === 'Unenclosed' && isSeparator
                                ? delimDoc
                                : ifBreak(delimDoc),
                        );
                    }
                }

                if (isIgnoreComment) {
                    ignoringNextStatement = true;
                }
            }
        }
        endGroup();

        const pairSpace: Doc =
            results.length === 0
                ? []
                : groupType === 'Curly' && options.bracketSpacing
                  ? line
                  : groupType === 'Angle'
                    ? []
                    : softline;

        const resultDoc = group(
            pair
                ? hasNestedGroup
                    ? [printToken(pair[0][0]), results, printToken(pair[1][0])]
                    : [
                          printToken(pair[0][0]),
                          indent([pairSpace, results]),
                          pairSpace,
                          printToken(pair[1][0]),
                      ]
                : results,
            {
                shouldBreak: shouldBreakTree,
            },
        );
        return shouldKeepSameLine() ? withoutLineBreaks(resultDoc) : resultDoc;
    } else if (tree.token_tree_type === 'Token') {
        const [token] = tree.data;
        return printToken(token);
    }

    throw new Error(`Unexpected token tree: ${JSON.stringify(tree)}`);
}

function printToken(token: Token): Doc {
    switch (token.token_type) {
        case 'Space':
            return space;
        case 'Line':
            return hardline;
        case 'MultiLine':
            return [breakParent];
        case 'LineComment':
            return ifBreak(
                token.data,
                `/* ${token.data.substring(2).trim()} */`,
            );
    }
    return getTokenText(token);
}

function printBetween(
    group: GroupType,
    trees: TokenTree[],
    aIndex: number,
    bIndex: number,
    leftMap: Map<TokenTree, TokenTree>,
    rightMap: Map<TokenTree, TokenTree>,
): Doc {
    const rule = spaceConfig.rules.find(([aPattern, bPattern]) => {
        return (
            doesTokenTreeMatchPattern(aPattern, trees, aIndex, group) &&
            doesTokenTreeMatchPattern(bPattern, trees, bIndex, group)
        );
    });
    return rule
        ? parseSpace(rule[2], trees[aIndex], trees[bIndex], leftMap, rightMap)
        : [];
}
