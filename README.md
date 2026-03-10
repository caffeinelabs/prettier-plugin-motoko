# Motoko Formatter &middot; [![npm version](https://img.shields.io/npm/v/prettier-plugin-motoko.svg?logo=npm)](https://www.npmjs.com/package/prettier-plugin-motoko) [![GitHub license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dfinity/prettier-plugin-motoko/issues)

> ### A [Prettier](https://prettier.io/) plugin for the [Motoko](https://internetcomputer.org/docs/current/developer-docs/build/cdks/motoko-dfinity/motoko/) programming language.

---

## Setup

After making sure [Node.js](https://nodejs.org/en/download/) is installed on your local machine, run the following command in your Motoko project directory:

```sh
npm install --save-dev prettier prettier-plugin-motoko
```

## Command-line usage

Format your Motoko files using the [Prettier CLI](https://prettier.io/docs/en/cli.html):

```sh
npx prettier --write --plugin=prettier-plugin-motoko **/*.mo
```

Check if your Motoko files are correctly formatted:

```sh
npx prettier --check --plugin=prettier-plugin-motoko **/*.mo
```

Alternatively, check out [`mo-fmt`](https://www.npmjs.com/package/mo-fmt) for a standalone Motoko formatter CLI:

```
mo-fmt **/*
mo-fmt -c **/*
```

## VS Code support

- Works out of the box with the [Motoko extension](https://marketplace.visualstudio.com/items?itemName=dfinity-foundation.vscode-motoko).
- Compatible with the the [Prettier extension](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode).

## Customization

Configure the formatter by creating a `.prettierrc` file in your project directory ([full documentation](https://prettier.io/docs/en/configuration.html)).

Add the following line to your config file:

```json
{
    "plugins": ["prettier-plugin-motoko"],
}
```

### Example `.prettierrc` configuration with default values:

```json
{
    "plugins": ["prettier-plugin-motoko"],
    "bracketSpacing": true,
    "printWidth": 80,
    "semi": true,
    "tabWidth": 2,
    "trailingComma": "es5",
    "useTabs": false
}
```

### Motoko-specific options

#### `motokoOrganizeImports` (default: `false`)

Automatically organize and sort import statements. When enabled, imports are:
- Grouped by prefix (`ic:`, `canister:`, `mo:`, and relative paths)
- Sorted alphabetically within each group
- Combined when importing from the same path
- Separated by blank lines between groups
- Comments within the import section are preserved and moved below the organized imports

Example:

```motoko
// Before formatting
import Text "mo:base/Text";
import Utils "./utils";
import Core "canister:core";
import Array "mo:base/Array";

// After formatting with motokoOrganizeImports: true
import Core "canister:core";

import Array "mo:base/Array";
import Text "mo:base/Text";

import Utils "./utils";
```

To enable this option, add it to your `.prettierrc`:

```json
{
    "plugins": ["prettier-plugin-motoko"],
    "motokoOrganizeImports": true
}
```

#### `motokoRemoveLinesAroundCodeBlocks` (default: `false`)

Remove extra blank lines at the beginning and end of code blocks.

## Multiple languages

Prettier will apply the same configuration to Motoko, JavaScript, CSS, HTML, and any other supported languages. 

You can specifically configure Motoko files using a [configuration override](https://prettier.io/docs/en/configuration.html#configuration-overrides) in your `.prettierrc` file:

```json
{
    "overrides": [{
        "files": "*.mo",
        "options": {
            "bracketSpacing": true
        }
    }]
}
```

## Ignoring code

Skip formatting a statement using a `prettier-ignore` comment:

```motoko
// prettier-ignore
func ignored<A>(a:A){a};

func formatted<B>(b : B) { b };
```

## Contributing

Feel free to [submit a GitHub issue](https://github.com/dfinity/prettier-plugin-motoko/issues/new) to report a bug or suggest a feature. 

If you're interested in becoming an open-source contributor, be sure to check out the [open issues](https://github.com/dfinity/prettier-plugin-motoko/issues) in case anything catches your eye. 
