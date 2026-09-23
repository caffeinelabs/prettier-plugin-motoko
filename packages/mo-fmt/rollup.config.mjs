// import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
// import { terser } from 'rollup-plugin-terser';
import json from '@rollup/plugin-json';

export default {
    input: 'src/cli.js',
    output: {
        dir: 'dist',
        format: 'cjs',
        exports: 'auto',
    },
    plugins: [
        // nodeResolve(),
        commonjs(),
        // terser(),
        json(),
    ],
};
