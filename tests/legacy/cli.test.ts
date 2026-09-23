const pluginPackage = require('../package.json');
const cliPackage = require('../packages/mo-fmt/package.json');

describe('mo-fmt CLI', () => {
    test('is up-to-date', () => {
        expect(cliPackage.dependencies['prettier-plugin-motoko']).toStrictEqual(
            `^${pluginPackage.version}`,
        );
        // expect(cliPackage.version).toStrictEqual(`^${pluginPackage.version}`);
    });
});
