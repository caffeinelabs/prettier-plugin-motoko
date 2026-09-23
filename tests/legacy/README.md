# Legacy suites (0.13, pre-rewrite)

These four suites exercise the **engine that M1 deleted** — the `motoko-tt-parse` parser and the
`motoko-tt-ast` printer, reached through `src/environments/node`. That entry point no longer exists,
so every one of them fails to import. They are kept, not deleted, because they are the source of the
golden pairs the new printer is measured against.

| Suite                     | Cases | Status                                                                    |
| ------------------------- | ----- | ------------------------------------------------------------------------- |
| `formatter.test.ts`       | 68    | Holds the 68 `(input, expected)` pairs `docs/formatter-rework.md` names.  |
| `organizeImports.test.ts` | 34    | Holds the 34 organize-imports pairs the same section names.               |
| `compiler.test.ts`        | 1     | A skipped generator that walks `../motoko/test/**` and writes diff files. |
| `cli.test.ts`             | 1     | A version-sync check between this package and `packages/mo-fmt`.          |

They are moved here rather than rewritten so the M2 port has the originals to read against, and
because rewriting them now would mean writing assertions against a printer that does not exist yet.

## Why they are not in the run

`vitest.config.ts` includes `tests/**/*.test.ts`. These files live under `tests/legacy/`, so they are
still matched — but the three engine-dependent ones cannot be _collected_, let alone run, and
Vitest treats an unimportable file as a failed suite. The M1 PR therefore excludes this directory:

```ts
exclude: ['**/node_modules/**', 'tests/test-webapp/**', 'tests/legacy/**'],
```

The plan is explicit that this is temporary: `docs/formatter-rework.md:146` —

> **Unit fixtures.** `tests/format/**` and `tests/rewrite/**` use Vitest snapshots. Every fixture
> also asserts idempotence. The 68 formatter tests and 34 organize-imports tests from 0.13 are
> ported as fixtures. Each is kept, changed on purpose (with a note), or deleted as a bug.

## What happens to each

- **`formatter.test.ts` / `organizeImports.test.ts`** — ported to `tests/format/**` and
  `tests/format/imports/**` in M2, one area at a time, as the printers for those areas land. Each
  ported case is either kept, changed deliberately (with a note in the fixture), or dropped as a bug
  in the old engine. `git mv` them out of this directory as they are ported, so what remains here is
  exactly the not-yet-ported set.
- **`compiler.test.ts`** — superseded by `tests/corpus.test.ts`, which does the same sweep as a real
  test instead of a skipped generator. Delete it once the M2 corpus job is green.
- **`cli.test.ts`** — still a valid check (the plugin and `mo-fmt` share one version). It fails here
  only because it is CommonJS using Jest's globals; M4 moves it to Vitest ESM with the rest of the
  CLI work.

Deleting this directory is an M2/M4 task, not an M1 one.
