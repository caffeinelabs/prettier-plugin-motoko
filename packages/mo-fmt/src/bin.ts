import { main } from './cli.ts';

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}

main(process.argv.slice(2), {
    cwd: process.cwd(),
    readStdin,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
}).then(
    (code) => {
        process.exitCode = code;
    },
    (error: unknown) => {
        console.error(error);
        process.exitCode = 2;
    },
);
