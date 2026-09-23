// Unit extraction: the definition of "a unit", and the census that counts units per file.
//
// A unit is a `.mo` file, or a parseable `motoko` fence in a Markdown file. The single subtle point,
// and the reason this is its own module, is the fence regex: #6385's first harness anchored it at
// column 0 and so silently matched none of `doc/md/reference/style-guide.md`'s fences — every one of
// them is indented under a list item — dropping the file with the largest diff from the count.
//
// So `FENCE_OPEN` is not anchored at column 0, and tolerates whitespace on both sides of the info
// string (````motoko` and ```` ``` motoko no-repl ```` are both real spellings in this repo). The
// harness proves the difference rather than asserting it: `proveFenceRegex` counts matches for a
// column-0-anchored regex and for the real one, over the same file, and the census fails unless the
// real one finds strictly more.

import { readFileSync } from 'node:fs';

/**
 * Opening fence. Groups: 1 indent, 2 fence run, 3 first info word, 4 the rest of the info string.
 *
 * `[^\s`]*` for the info word means a bare fence (```` ``` ````) yields an empty word and is not
 * treated as Motoko — only `motoko`/`motoko no-repl`/`motoko title=...` count. `~` fences are
 * accepted too; CommonMark allows them and they appear in older docs.
 */
export const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)(.*)$/;

/**
 * The deliberately-wrong regex, kept so the harness can demonstrate the difference.
 *
 * It carries the same five capture groups as `FENCE_OPEN` (an always-empty indent group followed by a
 * negative lookahead that forbids leading whitespace), so `extractFences` can run both regexes through
 * the identical scanner and only the anchoring differs.
 */
export const FENCE_OPEN_COL0 =
    /^(?![ \t])([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)(.*)$/;

/**
 * Is this fence's info string the motoko language?
 *
 * Only an exact first word counts. `motoko no-repl`, `motoko title=...` and negative forms
 * (```` ``` motoko no-repl ````) all qualify; a bare fence, or a different language (`motoc`,
 * `motoko2`), does not. `rest` is accepted for call-site symmetry and deliberately unused.
 */
export function isMotokoFence(infoWord) {
    return infoWord === 'motoko';
}

/**
 * Extract every fenced block from Markdown text, wherever it sits (including indented list items).
 *
 * Returns `{ infoWord, infoFull, indent, body, startLine, endLine, closed }` per fence. An unclosed
 * fence runs to end of file, exactly as a renderer would treat it, and is flagged `closed: false`.
 *
 * `openRe` may be overridden so the harness can run the same extractor with the deliberately-wrong
 * column-0-anchored regex and compare apples to apples (open fences both ways). The close-fence
 * regex is derived from the opener's fence run, so it stays correct either way.
 */
export function extractFences(text, openRe = FENCE_OPEN) {
    const lines = text.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const m = openRe.exec(lines[i]);
        if (!m) {
            i += 1;
            continue;
        }
        const [, indent, fenceRun, infoWord, rest] = m;
        const char = fenceRun[0];
        const closeRe = new RegExp(
            `^[ \\t]*\\${char}{${fenceRun.length},}[ \\t]*$`,
        );
        const body = [];
        let j = i + 1;
        while (j < lines.length && !closeRe.test(lines[j])) {
            body.push(lines[j]);
            j += 1;
        }
        out.push({
            infoWord,
            infoFull: `${infoWord}${rest}`.trim(),
            indent: indent.length,
            body: body.join('\n'),
            startLine: i + 1,
            endLine: j + 1,
            closed: j < lines.length,
        });
        i = j + 1;
    }
    return out;
}

/** The Motoko units of one Markdown file: one per `motoko` fence, in document order. */
export function fencesToUnits(repoPath, text) {
    return extractFences(text)
        .filter((f) => isMotokoFence(f.infoWord, f.infoFull))
        .map((f) => ({
            repoPath,
            kind: 'fence',
            label: `${repoPath}:${f.startLine} (fence)`,
            startLine: f.startLine,
            source: f.body,
        }));
}

/**
 * Count Motoko fences in a file under both regexes, so a test can assert the real one is strictly
 * better. Both counts are *open* fences extracted by the same scanner; only the opener regex differs.
 *
 * Returns `{ openAnchored, openUnanchored, motokoAnchored, motokoUnanchored, allAnchored, allUnanchored }`.
 * `open*` count every fence regardless of language; `motoko*` count only `motoko` fences.
 */
export function proveFenceRegex(text) {
    const anchoredFences = extractFences(text, FENCE_OPEN_COL0);
    const unanchoredFences = extractFences(text, FENCE_OPEN);
    const motoko = (fs) => fs.filter((f) => f.infoWord === 'motoko').length;
    return {
        openAnchored: anchoredFences.length,
        openUnanchored: unanchoredFences.length,
        motokoAnchored: motoko(anchoredFences),
        motokoUnanchored: motoko(unanchoredFences),
        // Back-compat aliases used by the census's fence check.
        anchored: anchoredFences.length,
        unanchored: unanchoredFences.length,
    };
}

/**
 * Build the unit list for one file at one revision, given a reader.
 *
 * `read(repoPath)` returns the file's text. Non-`.mo`, non-`.md` paths yield no units. A `.md` file
 * yields one unit per motoko fence. A `.mo` file yields exactly one unit even if it is empty, so that
 * a file deleted or blanked shows up as a count drop rather than vanishing.
 */
export function unitsForFile(repoPath, read) {
    if (repoPath.endsWith('.mo')) {
        return [
            {
                repoPath,
                kind: 'file',
                label: repoPath,
                source: read(repoPath),
            },
        ];
    }
    if (repoPath.endsWith('.md')) {
        return fencesToUnits(repoPath, read(repoPath));
    }
    return [];
}

/** Read a file's text, or null when it does not decode as UTF-8 / does not exist. */
export function readTextOrNull(path) {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return null;
    }
}
