/** Isolate the construct at qr/list.mo:87 that the new parser rejects while moc accepts it. */
import { parse } from '../../../src/parser/parse.ts';
import prettier from 'prettier';
import plugin from '../../../src/index.ts';

const cands: [string, string][] = [
    ['space before < in type position', `let f : List <T> = x;`],
    ['no space', `let f : List<T> = x;`],
    [
        'func<T> decl w/ spaced annot',
        `let g = func<T>(l : List <T>, i : Nat) : Bool { true };`,
    ],
    [
        'func<T> decl no space',
        `let g = func<T>(l : List<T>, i : Nat) : Bool { true };`,
    ],
    [
        'annotated let = func<T>',
        `public let h : <T> (List<T>, Nat) -> Bool = func<T>(l : List<T>) : Bool { true };`,
    ],
    [
        'the exact 87 line in a block',
        `module M {\n  let lenIsEqLessThan : <T> (List<T>, Nat) -> Bool =\n    func<T>(l : List <T>, i : Nat) : Bool {\n      true\n    };\n}`,
    ],
    [
        'same, no space before <',
        `module M {\n  let lenIsEqLessThan : <T> (List<T>, Nat) -> Bool =\n    func<T>(l : List<T>, i : Nat) : Bool {\n      true\n    };\n}`,
    ],
];
for (const [name, src] of cands) {
    let p = 'ok',
        f = 'ok';
    try {
        await parse(src + '\n');
    } catch (e: any) {
        p = e.message.split('\n')[0];
    }
    try {
        await prettier.format(src + '\n', {
            parser: 'motoko-tt-parse',
            plugins: [plugin],
            printWidth: 80,
        });
    } catch (e: any) {
        f = e.message.split('\n')[0];
    }
    console.log(
        `${p === 'ok' && f === 'ok' ? 'OK    ' : 'FAIL  '} ${name.padEnd(32)} parse=${p}  format=${f}`,
    );
}
