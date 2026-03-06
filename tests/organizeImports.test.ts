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

actor {
  public func test() {};
};\n`;
        expect(await format(input, organizeImportsOptions)).toEqual(expected);
    });
});
