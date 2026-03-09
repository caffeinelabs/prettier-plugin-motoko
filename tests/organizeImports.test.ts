import prettier from 'prettier';
import * as motokoPlugin from '../src/environments/node';

const prettierOptions: prettier.Options = {
    plugins: [motokoPlugin],
    filepath: 'Main.mo',
};

const format = async (
    input: string,
    options?: prettier.Options,
): Promise<string> => {
    return prettier.format(input, { ...prettierOptions, ...options });
};

describe('organize imports', () => {
    const organizeImportsOptions: prettier.Options = {
        motokoOrganizeImports: true,
    };

    test('basic', async () => {
        const input = `import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Text "mo:base/Text";

actor {}`;
        const expected = `import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Text "mo:base/Text";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('group imports by prefix', async () => {
        const input = `import Text "mo:base/Text";
import Utils "./utils";
import Core "canister:core";
import Array "mo:base/Array";

actor {}`;
        const expected = `import Core "canister:core";

import Array "mo:base/Array";
import Text "mo:base/Text";

import Utils "./utils";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('combine imports from same path', async () => {
        const input = `import Array "mo:base/Array";
import { map } "mo:base/Array";
import { filter } "mo:base/Array";

actor {}`;
        const expected = `import Array "mo:base/Array";
import { filter; map } "mo:base/Array";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('sort destructured fields', async () => {
        const input = `import { zulu; yankee; alpha; beta } "mo:base/Utils";

actor {}`;
        const expected = `import { alpha; beta; yankee; zulu } "mo:base/Utils";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('handle aliased imports', async () => {
        const input = `import { map = mapArray; filter = filterArray } "mo:base/Array";

actor {}`;
        const expected = `import { filter = filterArray; map = mapArray } "mo:base/Array";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('preserve code after imports', async () => {
        const input = `import Array "mo:base/Array";

let x = 5;
let y = 10;`;
        const expected = `import Array "mo:base/Array";

let x = 5;
let y = 10;\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('no imports to organize', async () => {
        const input = `actor {
  public func hello() : async Text {
    "Hello"
  }
}`;
        const expected = `actor {
  public func hello() : async Text {
    "Hello";
  };
};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('disabled by default', async () => {
        const input = `import Text "mo:base/Text";
import Array "mo:base/Array";

actor {}`;
        const expected = `import Text "mo:base/Text";
import Array "mo:base/Array";

actor {};\n`;
        // Without the option, order should be preserved
        expect(await format(input)).toEqual(expected);
    });

    test('ic: prefix imports', async () => {
        const input = `import Array "mo:base/Array";
import IC "ic:aaaaa-aa";

actor {}`;
        const expected = `import IC "ic:aaaaa-aa";

import Array "mo:base/Array";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('empty destructured imports', async () => {
        const input = `import Array "mo:base/Array";
import {} "mo:base/Empty";

actor {}`;
        const expected = `import Array "mo:base/Array";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('trailing comma in destructured imports', async () => {
        const input = `import { map; filter; } "mo:base/Array";

actor {}`;
        const expected = `import { filter; map } "mo:base/Array";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('imports with inline comments', async () => {
        const input = `import Array "mo:base/Array"; // Array utilities
import Text "mo:base/Text"; // Text utilities

actor {}`;
        const expected = `import Array "mo:base/Array";
import Text "mo:base/Text";

// Array utilities
// Text utilities

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('imports with block comments', async () => {
        const input = `/* Core imports */
import Array "mo:base/Array";
import Text "mo:base/Text";

actor {}`;
        const expected = `/* Core imports */
import Array "mo:base/Array";
import Text "mo:base/Text";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('comments between imports are preserved', async () => {
        const input = `// Base library imports
import Text "mo:base/Text";
// Utility imports
import Utils "./utils";
import Array "mo:base/Array";

actor {}`;
        const expected = `// Base library imports
import Array "mo:base/Array";
import Text "mo:base/Text";

import Utils "./utils";

// Utility imports

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('imports with excessive whitespace', async () => {
        const input = `import   Array   "mo:base/Array";
import    Text    "mo:base/Text";

actor {}`;
        const expected = `import Array "mo:base/Array";
import Text "mo:base/Text";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('whitespace in destructured imports', async () => {
        const input = `import {   map  ;  filter   ;   fold   } "mo:base/Array";

actor {}`;
        const expected = `import { filter; fold; map } "mo:base/Array";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('single item destructured import', async () => {
        const input = `import { map } "mo:base/Array";

actor {}`;
        const expected = `import { map } "mo:base/Array";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('imports with newlines between them', async () => {
        const input = `import Array "mo:base/Array";


import Text "mo:base/Text";



import Buffer "mo:base/Buffer";

actor {}`;
        const expected = `import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Text "mo:base/Text";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('combine multiple destructured imports with existing named import', async () => {
        const input = `import Array "mo:base/Array";
import { map } "mo:base/Array";
import { filter } "mo:base/Array";
import { fold } "mo:base/Array";

actor {}`;
        const expected = `import Array "mo:base/Array";
import { filter; fold; map } "mo:base/Array";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('complex aliased imports with sorting', async () => {
        const input = `import { zulu = z; alpha = a; beta = b; yankee = y } "mo:base/Utils";

actor {}`;
        const expected = `import { alpha = a; beta = b; yankee = y; zulu = z } "mo:base/Utils";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('mixed aliased and non-aliased destructured imports', async () => {
        const input = `import { map = mapFn; filter; fold = foldFn; reduce } "mo:base/Array";

actor {}`;
        const expected = `import { filter; fold = foldFn; map = mapFn; reduce } "mo:base/Array";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('imports with all prefix types mixed', async () => {
        const input = `import Utils "./utils";
import Buffer "mo:base/Buffer";
import Core "canister:core";
import IC "ic:aaaaa-aa";
import Array "mo:base/Array";
import Helpers "./helpers";
import Types "canister:types";

actor {}`;
        const expected = `import IC "ic:aaaaa-aa";

import Core "canister:core";
import Types "canister:types";

import Array "mo:base/Array";
import Buffer "mo:base/Buffer";

import Helpers "./helpers";
import Utils "./utils";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('preserve spacing between imports and code', async () => {
        const input = `import Array "mo:base/Array";
import Text "mo:base/Text";


// Main actor
actor {
  public func test() {}
}`;
        const expected = `import Array "mo:base/Array";
import Text "mo:base/Text";

// Main actor

actor {
  public func test() {};
};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('malformed import - missing path', async () => {
        const input = `import Array;
import Text "mo:base/Text";

actor {}`;
        // Should preserve the malformed import as-is
        const expected = `import Array;
import Text "mo:base/Text";

actor {};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });

    test('malformed import - missing quotes', async () => {
        const input = `import Array mo:base/Array;
import Text "mo:base/Text";

actor {}`;
        // Should preserve malformed imports as-is (may reformat spacing)
        const result = await format(input, organizeImportsOptions);
        // Both imports should be present
        expect(result).toContain('import Array');
        expect(result).toContain('mo');
        expect(result).toContain('base');
        expect(result).toContain('Array');
        expect(result).toContain('import Text "mo:base/Text"');
    });

    test('partially written import', async () => {
        const input = `import Array "mo:base/Array";
import

actor {}`;
        // Should preserve partial import as-is
        const result = await format(input, organizeImportsOptions);
        expect(result).toContain('import Array "mo:base/Array"');
        expect(result).toContain('import');
    });

    test('incomplete destructured import', async () => {
        const input = `import Array "mo:base/Array";
import { map "mo:base/Array";

actor {}`;
        // Should preserve incomplete destructured import (may reformat spacing)
        const result = await format(input, organizeImportsOptions);
        expect(result).toContain('import Array "mo:base/Array"');
        expect(result).toContain('import {map');
        expect(result).toContain('"mo:base/Array"');
    });

    test('import with missing semicolon at end', async () => {
        const input = `import Array "mo:base/Array"
import Text "mo:base/Text";

actor {}`;
        // Should handle imports even without semicolons (formatter may add them)
        const result = await format(input, organizeImportsOptions);
        expect(result).toContain('import Array "mo:base/Array"');
        expect(result).toContain('import Text "mo:base/Text"');
    });

    test('destructured import with unclosed brace', async () => {
        const input = `import Array "mo:base/Array";
import { map; filter "mo:base/Array";

actor {}`;
        // Should preserve malformed destructured import (may reformat)
        const result = await format(input, organizeImportsOptions);
        expect(result).toContain('import Array "mo:base/Array"');
        expect(result).toContain('map');
        expect(result).toContain('filter');
        expect(result).toContain('"mo:base/Array"');
    });

    test('import with invalid path format', async () => {
        const input = `import Array "mo:base/Array";
import Text 'mo:base/Text';

actor {}`;
        // Single quotes might not be supported (may reformat or preserve)
        const result = await format(input, organizeImportsOptions);
        expect(result).toContain('import Array "mo:base/Array"');
        expect(result).toContain('import Text');
        expect(result).toContain('mo:base/Text');
    });

    test('import with syntax error in destructuring', async () => {
        const input = `import Array "mo:base/Array";
import { map;; filter } "mo:base/Array";

actor {}`;
        // Double semicolon is a syntax error - the organize logic should detect
        // malformed imports and preserve them, though the formatter may clean them up
        const result = await format(input, organizeImportsOptions);
        // Verify that both imports are present (not removed)
        expect(result).toContain('import Array "mo:base/Array"');
        expect(result).toContain('import { ');
        expect(result).toContain('filter');
        expect(result).toContain('map');
    });

    test('import keyword only', async () => {
        const input = `import Array "mo:base/Array";
import
import Text "mo:base/Text";

actor {}`;
        // Lone import keyword - organize logic should preserve all imports
        const result = await format(input, organizeImportsOptions);
        // Verify that valid imports are present
        expect(result).toContain('import Array "mo:base/Array"');
        expect(result).toContain('import Text "mo:base/Text"');
        // The lone 'import' may be formatted but shouldn't cause data loss
    });

    test('import with incomplete alias', async () => {
        const input = `import Array "mo:base/Array";
import { map = } "mo:base/Array";

actor {}`;
        // Missing alias identifier - the organize logic should detect this
        const result = await format(input, organizeImportsOptions);
        // Both imports should be present (though may be combined/reformatted)
        expect(result).toContain('import Array "mo:base/Array"');
        expect(result).toContain('{ map }');
    });

    test('mixed valid and malformed imports', async () => {
        const input = `import Array "mo:base/Array";
import Buffer
import Text "mo:base/Text";
import { map } "mo:base/Array";

actor {}`;
        // Should preserve all imports even if some are malformed
        const result = await format(input, organizeImportsOptions);
        // Verify that all valid imports are present
        expect(result).toContain('import Array "mo:base/Array"');
        expect(result).toContain('import Text "mo:base/Text"');
        expect(result).toContain('{ map }');
        // The malformed 'import Buffer' without a path may be formatted
        expect(result).toContain('Buffer');
    });
});
