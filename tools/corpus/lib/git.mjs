/**
 * Git plumbing for the corpus harness.
 *
 * The harness reads the compiler corpus from a *local* checkout, never by cloning: the plan pins
 * revisions and the environment has no network. Every read goes through `git`, so a unit is always
 * the file *as of the pinned revision*, not as of whatever the working tree happens to contain.
 *
 * Two shapes of read:
 *
 * - `listFiles(repo, rev, suffix)` — the tracked path list at a revision.
 * - `readBlobs(repo, rev, paths)` — the file contents, in one `git cat-file --batch` call.
 *
 * The batch reader exists because the alternative, one `git show` process per file, costs about
 * 12ms of process spawn each and dominates the run at several thousand units. `--batch` reads N
 * objects on one process's stdin, which is the difference between a minute and ten.
 */

import { execFileSync } from 'node:child_process';

/** One `git` invocation, with the failure mode the harness wants (throw, never hang). */
function git(repo, args, options = {}) {
    return execFileSync('git', ['-C', repo, ...args], {
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        ...options,
    });
}

/**
 * True when `dir` looks like a git checkout. Used to resolve a remote to a local path.
 *
 * `stdio` is overridden to swallow git's own diagnostics. The scan directory is a home directory
 * full of non-repos, so the ordinary form prints `fatal: not a git repository` once per candidate
 * and buries the harness's real output. This probe is expected to fail on most candidates, which is
 * why it is the one place that does not let git speak.
 */
export function isGitRepo(dir) {
    try {
        git(dir, ['rev-parse', '--git-dir'], {
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Resolve a revision to a full commit id.
 *
 * The workflow passes `master`; the plan pins a 40-hex commit. Both must work, and both must
 * resolve *locally* — the harness never fetches. A rev that does not resolve is a hard error: a
 * silently empty corpus would make every check pass vacuously, which is the exact failure the plan
 * warns about ("no silent caps").
 *
 * `origin/<rev>` is tried when the bare rev does not resolve, and that fallback is not cosmetic.
 * `.github/workflows/corpus.yml` and the plan both name the pin `master`, and `master` is the
 * *remote's* default branch; a checkout made by `git clone --branch <other>` or one whose local
 * default was renamed carries it only as a remote-tracking ref (`refs/remotes/origin/master`).
 * Without the fallback the whole run resolves nothing and reports an empty corpus. Which spelling
 * actually resolved is recorded in the report's provenance table.
 */
export function resolveRev(repo, rev) {
    const candidates = [rev, `origin/${rev}`];
    const why = [];
    for (const candidate of candidates) {
        let out;
        try {
            out = git(
                repo,
                ['rev-parse', '--verify', `${candidate}^{commit}`],
                {
                    stdio: ['ignore', 'pipe', 'ignore'],
                },
            ).trim();
        } catch (error) {
            why.push(`${candidate}: ${String(error.message).split('\n')[0]}`);
            continue;
        }
        if (!/^[0-9a-f]{40}$/.test(out)) {
            why.push(
                `${candidate}: resolved to ${JSON.stringify(out)}, not a commit id`,
            );
            continue;
        }
        return { rev: out, ref: candidate };
    }
    throw new Error(
        `${repo}: '${rev}' did not resolve to a commit locally (tried ${candidates.join(', ')}). ` +
            why.join(' | '),
    );
}

/** The commit id and the ref spelling that produced it, for provenance in the report. */
export function resolveRevRef(repo, rev) {
    return resolveRev(repo, rev).rev;
}

/** The commit id of every ref tip, for provenance in the report. */
export function headRev(repo) {
    try {
        return resolveRev(repo, 'HEAD').rev;
    } catch {
        return null;
    }
}

/** The `origin` URL, normalised to `owner/name`, or null for a repo with no remote. */
export function originSlug(repo) {
    let url;
    try {
        url = git(repo, ['remote', 'get-url', 'origin']).trim();
    } catch {
        return null;
    }
    const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    return match ? `${match[1]}/${match[2]}` : url;
}

/** Every tracked file at `rev` whose path ends with `suffix` (`''` means every tracked file). */
export function listFiles(repo, rev, suffix = '') {
    const out = git(repo, ['ls-tree', '-r', '--name-only', rev]);
    // `git ls-tree` NUL-terminates with a trailing newline; paths with newlines are not a case the
    // corpus contains, and splitting on \n is what every other consumer here does.
    return out.split('\n').filter((p) => p !== '' && p.endsWith(suffix));
}

/** Every tracked file under any of `prefixes` at `rev`, filtered by `suffix`. */
export function listFilesUnder(repo, rev, prefixes, suffix = '') {
    return listFiles(repo, rev, suffix).filter((p) =>
        prefixes.some((prefix) => p.startsWith(prefix)),
    );
}

/**
 * Read many objects in one process.
 *
 * Returns a `Map<path, Buffer>`; a path `git` could not resolve maps to `null` rather than being
 * dropped, so the caller can count and list it (again: nothing disappears quietly).
 *
 * The stream's framing is `"<sha> blob <size>\n<size bytes>\n"` per object, with `"<spec> missing\n"`
 * for anything unresolvable. The buffer is sliced by *byte* length and only then decoded, so a
 * file in an unexpected encoding cannot desynchronise the parser for every file after it.
 */
export function readBlobs(repo, rev, paths) {
    const result = new Map();
    if (paths.length === 0) return result;

    const input = `${paths.map((p) => `${rev}:${p}`).join('\n')}\n`;
    const out = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], {
        input,
        maxBuffer: 1024 * 1024 * 1024,
    });

    let cursor = 0;
    for (const path of paths) {
        const newline = out.indexOf(0x0a, cursor);
        if (newline < 0) {
            result.set(path, null);
            continue;
        }
        const header = out.toString('utf8', cursor, newline);
        const parts = header.split(' ');
        if (parts.length !== 3 || parts[1] !== 'blob') {
            result.set(path, null);
            cursor = newline + 1;
            continue;
        }
        const size = Number(parts[2]);
        const body = out.subarray(newline + 1, newline + 1 + size);
        result.set(path, Buffer.from(body));
        // The object body is followed by exactly one newline that is not part of it.
        cursor = newline + 1 + size + 1;
    }
    return result;
}

/** Decode as UTF-8, reporting rather than throwing on invalid bytes. */
export function decodeUtf8(buffer) {
    if (buffer === null)
        return { text: null, reason: 'object not found at this revision' };
    const text = buffer.toString('utf8');
    // A round-trip through UTF-8 catches replacement characters from a bad decode. Strictness
    // matters here: a lossy decode would make the round-trip check look *better* than it is.
    if (Buffer.byteLength(text, 'utf8') !== buffer.length) {
        return { text: null, reason: 'not valid UTF-8' };
    }
    return { text, reason: null };
}
