import { defineConfig } from 'vitest/config';

/**
 * Vitest replaces Jest and ts-jest. The tests run the TypeScript sources directly, so there is no
 * transform configuration here and no build step before `npm test`.
 *
 * `web-tree-sitter` is a wasm-backed binding and must not be inlined or externalised into a worker
 * pool, so it is kept in the Node module graph for the tests that load the grammar.
 */
export default defineConfig({
    test: {
        // Test files live under tests/ and are named *.test.ts.
        include: ['tests/**/*.test.ts'],
        // The legacy Jest suites exercise the pre-rewrite plugin through Prettier and are rewritten
        // per milestone; they are not part of the parser lane's run.
        //
        // `tests/legacy` holds the four 0.13 suites that import `src/environments/node`, which M1
        // deleted. They are preserved deliberately rather than dropped — they carry the 68
        // formatter and 34 organize-imports golden pairs the M2 printer is measured against — but
        // they cannot be collected while that entry point is gone, so they stay out of the run.
        // `tests/legacy/README.md` records the port plan; this exclude goes away as it is carried
        // out, one directory at a time.
        exclude: [
            '**/node_modules/**',
            'tests/test-webapp/**',
            'tests/legacy/**',
        ],
        environment: 'node',
    },
});
