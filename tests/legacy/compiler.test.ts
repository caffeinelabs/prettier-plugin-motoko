import prettier from 'prettier';
import * as motokoPlugin from '../src/environments/node';
import glob from 'fast-glob';
import { join, basename } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

describe('Motoko compiler suite', () => {
    test.skip('generate diff files from compiler tests', async () => {
        const okFiles: string[] = [];
        for (const extension of ['mo', 'did']) {
            let preOutput = '';
            let postOutput = '';
            for (const file of glob.sync(
                join(__dirname, `../../motoko/test/**/*.${extension}`),
            )) {
                try {
                    const code = readFileSync(file, 'utf-8');
                    const formatted = await prettier.format(code, {
                        filepath: file,
                        plugins: [motokoPlugin],
                    });
                    preOutput += `// >>> ${basename(file)} <<<\n\n${code}\n\n`;
                    postOutput += `// >>> ${basename(
                        file,
                    )} <<<\n\n${formatted}\n\n`;
                    okFiles.push(file);
                } catch (err) {
                    // console.error(`Error while formatting test file: ${file}`);
                }
            }
            expect(okFiles.length).toBeGreaterThan(600);

            const generatedDir = join(__dirname, 'generated');
            if (!existsSync(generatedDir)) {
                mkdirSync(generatedDir);
            }
            writeFileSync(
                join(generatedDir, `_CompilerTests_Before.${extension}_`),
                preOutput,
            );
            writeFileSync(
                join(generatedDir, `_CompilerTests_Formatted.${extension}_`),
                postOutput,
            );
        }
    });
});
