module.exports = {
    preset: 'ts-jest',
    // Generated wasm output is not a test target; ignoring it also stops the
    // haste map colliding on the identical `wasm` package.json in each target dir.
    modulePathIgnorePatterns: ['<rootDir>/wasm/pkg/'],
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/wasm/pkg/'],
};
