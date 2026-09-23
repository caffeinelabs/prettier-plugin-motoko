// Read-only access to the pinned motoko checkout, at an arbitrary revision.
//
// All reads go through `git show <rev>:<path>` rather than a checkout, so the harness never touches
// the working tree and never needs a second clone. `git ls-tree` gives the file list at a revision.
//
// The checkout is validated once, loudly, at startup: if MOTOKO_REPO is not a git repo or either pin
// is missing, `assertCheckout` throws with an actionable message. A harness that silently ran over
// the current working tree instead of the pinned revisions would be worse than one that refused.

import { execFileSync } from 'node:child_process';

import { BASE, HEAD, MOTOKO_REPO } from './config.mjs';

/** Run git in the motoko checkout and return stdout as a string. Throws on non-zero exit. */
export function git(...args) {
    return execFileSync('git', ['-C', MOTOKO_REPO, ...args], {
        maxBuffer: 1 << 30,
        encoding: 'utf8',
    });
}

/** Run git and return stdout, or null if it exits non-zero (missing path, bad revision). */
export function gitOrNull(...args) {
    try {
        return git(...args);
    } catch {
        return null;
    }
}

/** `git show <rev>:<path>`, or null when the path is absent at that revision. */
export function show(rev, path) {
    return gitOrNull('show', `${rev}:${path}`);
}

/** Is `rev` present in the checkout? */
export function hasRevision(rev) {
    return gitOrNull('rev-parse', '--verify', `${rev}^{commit}`) !== null;
}

/**
 * Every file path tracked at `rev`, as repo-relative POSIX paths.
 *
 * `-r` recurses, `--name-only` drops modes. Binary and non-UTF-8 files are *not* filtered here; the
 * unit builder filters by extension, and a `.mo`/`.md` file that does not decode is reported as an
 * unreadable unit rather than skipped.
 */
export function listFiles(rev) {
    return git('ls-tree', '-r', '--name-only', rev, '--', '.')
        .split('\n')
        .filter(Boolean);
}

/**
 * Verify the checkout is usable and both pins exist. Throws an Error with a one-screen message
 * otherwise. Called by every entry point before any work, so a mis-set MOTOKO_REPO fails at the top.
 */
export function assertCheckout() {
    const problems = [];
    try {
        git('rev-parse', '--git-dir');
    } catch {
        problems.push(
            `MOTOKO_REPO=${MOTOKO_REPO} is not a git checkout (or git is not on PATH). ` +
                `Set MOTOKO_REPO to a clone of caffeinelabs/motoko.`,
        );
    }
    if (problems.length === 0) {
        for (const [name, rev] of [
            ['BASE', BASE],
            ['HEAD', HEAD],
        ]) {
            if (!hasRevision(rev)) {
                problems.push(
                    `${name}=${rev} is not present in ${MOTOKO_REPO}. ` +
                        `Fetch it (git -C ${MOTOKO_REPO} fetch origin ${rev}) or re-pin in lib/config.mjs.`,
                );
            }
        }
    }
    if (problems.length) {
        throw new Error(
            `validate-moc2: motoko checkout unusable:\n  - ${problems.join('\n  - ')}`,
        );
    }
}

/** A reader over a fixed revision. `read(path)` returns text or null. */
export function readerFor(rev) {
    const cache = new Map();
    return (path) => {
        if (!cache.has(path)) cache.set(path, show(rev, path));
        return cache.get(path);
    };
}
