import { rmSync } from 'node:fs';

import { build } from 'esbuild';

import { copyWasm } from './copy-wasm.mjs';

const dir = 'packages/mo-fmt/dist';
rmSync(dir, { recursive: true, force: true });
await build({
    entryPoints: ['packages/mo-fmt/src/bin.ts'],
    outfile: `${dir}/mo-fmt.cjs`,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // A single CommonJS file, which is what a Node single executable runs, has no `import.meta`.
    define: { 'import.meta.url': 'importMetaUrl' },
    banner: {
        js: "#!/usr/bin/env node\nconst importMetaUrl = require('node:url').pathToFileURL(__filename).href;",
    },
    logLevel: 'warning',
});
copyWasm(dir);
