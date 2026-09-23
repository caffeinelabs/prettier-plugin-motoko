/**
 * Markdown fence extraction.
 *
 * The plan's unit is "a `.mo` file **or** a parseable `motoko` fence in a Markdown file", and it
 * warns about the failure mode that makes this worth doing carefully:
 *
 * > #6385's own first harness anchored the fence regex at column 0, silently matched none of
 * > `style-guide.md`'s fences, and so skipped the file with the largest diff.
 *
 * So this is a line scanner, not a column-0 regex, and it handles the three things that actually
 * occur in the corpus:
 *
 * - fences indented inside list items (`doc/md/fundamentals/types/mutable-arrays.md` has them at
 *   one space of indent);
 * - info strings with attributes (````motoko no-repl`);
 * - an unterminated fence at end of file, which is counted as an *unclosed* fence rather than
 *   silently treated as extending to EOF.
 *
 * The body is de-indented by the opening fence's indent, which is CommonMark's rule and is not
 * optional here: the first line of an indented fence would otherwise carry one extra space and
 * every such unit would be a spurious parse failure.
 */

/** A fenced block found in a Markdown document. */
export function extractMotokoFences(text) {
    const lines = text.split('\n');
    const found = [];
    let i = 0;

    while (i < lines.length) {
        const open = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n]*)$/.exec(lines[i]);
        if (!open) {
            i += 1;
            continue;
        }
        const [, indent, marker, info] = open;
        const language = (info.trim().split(/[\s,{}]+/)[0] ?? '').toLowerCase();

        // Scan for the closing fence. A closing fence uses the same character, is at least as long
        // as the opener, and carries no info string.
        const body = [];
        let j = i + 1;
        let closed = false;
        while (j < lines.length) {
            const close = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/.exec(lines[j]);
            if (
                close &&
                close[2][0] === marker[0] &&
                close[2].length >= marker.length
            ) {
                closed = true;
                break;
            }
            body.push(lines[j]);
            j += 1;
        }

        if (language === 'motoko' || language === 'mo') {
            const stripped = body
                .map((line) => {
                    let k = 0;
                    while (
                        k < indent.length &&
                        (line[k] === ' ' || line[k] === '\t')
                    ) {
                        k += 1;
                    }
                    return line.slice(k);
                })
                .join('\n');
            found.push({
                /** 1-based line of the opening fence, for the failure report. */
                line: i + 1,
                text: stripped,
                /** False when the document ended before the fence closed. */
                closed,
                indent: indent.length,
            });
        }

        i = closed ? j + 1 : j;
    }

    return found;
}

/**
 * Every fence in a document, regardless of language, so the harness can report how many it skipped
 * and why. "Not motoko" is a legitimate skip; an unreported skip is not.
 */
export function countAllFences(text) {
    const lines = text.split('\n');
    let count = 0;
    for (const line of lines) {
        if (/^[ \t]*(`{3,}|~{3,})[ \t]*[^\n]*$/.test(line)) count += 1;
    }
    // Each fence has an opener and a closer, so this over-counts by design; the caller uses it only
    // as a coarse "did we look at the whole file" signal.
    return count;
}
