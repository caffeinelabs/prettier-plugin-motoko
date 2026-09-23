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

/** The deliberately-wrong regex, kept so the harness can demonstrate the difference. */
export const FENCE_OPEN_COL0 = /^(`{3,})[ \t]*([^\s`]*)(.*)$/;

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
 */
export function extractFences(text) {
    const lines = text.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const m = FENCE_OPEN.exec(lines[i]);
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
 * Count fence *spellings* in a file, for the two regexes, so a test can assert the real one is
 * strictly better. Returns `{ anchored, unanchored, motokoAnchored, motokoUnanchored }`.
 */
export function proveFenceRegex(text) {
    const lines = text.split('\n');
    let anchored = 0;
    let motokoAnchored = 0;
    for (const line of lines) {
        const m = FENCE_OPEN_COL0.exec(line);
        if (!m) continue;
        anchored += 1;
        if (m[2] === 'motoko') motokoAnchored += 1;
    }
    const unanchored = extractFences(text);
    return {
        anchored,
        unanchored: unanchored.length,
        motokoAnchored,
        motokoUnanchored: unanchored.filter((f) => f.infoWord === 'motoko')
            .length,
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
