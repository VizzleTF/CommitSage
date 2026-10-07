// Runs `vscode-test` and fails when no test passed. VS Code can exit 0
// without running the suite at all (seen with `--log=error`), so the exit
// code alone does not prove the tests ran.
import { spawn } from 'node:child_process';

const child = spawn('npx', ['vscode-test', ...process.argv.slice(2)], {
    stdio: ['inherit', 'pipe', 'pipe'],
});

let output = '';
for (const [src, dst] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    src.on('data', (chunk) => {
        output += chunk;
        dst.write(chunk);
    });
}

child.on('close', (code) => {
    const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
    if (code === 0 && !/\b[1-9]\d* passing\b/.test(plain)) {
        console.error('\nE2E: vscode-test exited 0 but reported no passing tests.');
        process.exit(1);
    }
    process.exit(code ?? 1);
});
