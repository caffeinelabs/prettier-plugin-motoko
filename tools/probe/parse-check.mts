// Spot-check the parser on the shapes the port ledger flagged as throwing.
//
// The ledger says these inputs throw `Unexpected input`. Before treating any of them as a bug, look
// at exactly where the parse stops — the offset is what distinguishes "the grammar refuses this
// construct" from "the formatter fed the parser something of its own making".
//
// Usage: node tools/probe/parse-check.mts

import { parse } from '../../src/parser/parse.ts';

const cases: [string, string][] = [
    ['blank lines in block', '{\n\n1;\n2;\n\n3;\n\n}\n'],
    ['blank line, simple', '{\n\n1;\n}\n'],
    ['blank line middle', '{\n1;\n\n2;\n}\n'],
    ['shared actor literal', 'shared({})'],
    ['shared query', 'shared query({})'],
    ['async star spaced', 'async * T'],
    ['async star tight', 'async* T'],
    ['await star', 'await * t'],
    ['variant spaced', '# "A"'],
    ['variant tight', '#"A"'],
    ['variant number spaced', '# 5'],
    ['exponential .1e1', '.1e1'],
    ['block comment then semi', '{\n  /****\n  -----\n  ******/;\n};\n'],
    ['try comment catch', 'try {\n}\n /*c*/ catch {}'],
    ['try comment finally', 'try {\n}\n /*c*/ finally {}'],
    ['ignore comment in block', '{\n// prettier-ignore\n  123}'],
    ['ignore block comment', '/*prettier-ignore*/{\nabc\n\n1}'],
    ['zero width', 'let x​ = 123;'],
    ['with trailing comma', '(m with a = 1, b = 2,) actor {};'],
    ['record and extension', '{\na and b;}'],
    ['angle type bare', '<(xxxxxxxxxxxxxxxxxxxx, xxxxxxxxxxxxxxxxxxxx)>;\n'],
    ['fn field in type', 'f<() -> (), () -> ())>();\n'],
    ['array of blocks', '[\n  {\n  abc;\n  }\n  { 123 }\n];\n'],
    ['type array obj', 'x : [\n  { abc; }\n];\n'],
    ['invalid: a;b;c', '(a;b;c)'],
    ['invalid: {a,b,c}', '{a,b,c}'],
    ['lone quote', "// a'b\n '"],
];

for (const [label, source] of cases) {
    let line: string;
    try {
        const result = await parse(source);
        const problems = result.problems;
        if (problems.length === 0) {
            line = 'OK';
        } else {
            const p = problems[0]!;
            line =
                `ERR ${p.kind} ${p.name} @${p.row}:${p.column} ` +
                `[${p.startIndex},${p.endIndex})`;
        }
    } catch (error) {
        line = `THREW ${error instanceof Error ? error.message : String(error)}`;
    }
    console.log(`${label.padEnd(28)} ${line}`);
    console.log(`${' '.repeat(28)} source: ${JSON.stringify(source)}`);
}
