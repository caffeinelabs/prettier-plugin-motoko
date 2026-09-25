# mo-fmt

A standalone Motoko formatter: the [Prettier](https://prettier.io/) plugin from this repository and Prettier itself, bundled into one file.

## Usage

```sh
# Format every .mo file under the current directory, in place
mo-fmt .

# Format some files and directories
mo-fmt src/main.mo lib/

# Check without writing: list the files that would change, and exit 1 if any would
mo-fmt --check .

# Format stdin as the file at the given path (for editors), and print the result
mo-fmt --stdin-filepath src/main.mo < src/main.mo
```

Directories are searched for `.mo` files, skipping `node_modules` and dot-directories such as `.git` and `.mops`. Files matched by `.gitignore` or `.prettierignore` in the current directory are skipped, even when named.

Exit codes: `0` done, `1` `--check` found files that need formatting, `2` a usage error or a file that failed to format.

## Configuration

Each file is formatted with the options Prettier resolves for it from `.prettierrc` and `.editorconfig`, so mo-fmt and Prettier with the plugin format the same file the same way. A `plugins` entry is ignored, since mo-fmt brings its own.

To rewrite legacy syntax to the moc 2.0 forms, set:

```json
{ "motokoSyntax": "moc2" }
```

## Building

From the repository root:

```sh
npm ci
npm run build:mo-fmt
node packages/mo-fmt/dist/mo-fmt.cjs --help
```

`dist/` holds the bundle and the two wasm files it loads from beside itself. mo-fmt has the same version as the plugin.
