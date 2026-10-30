import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

let inputData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  let payload = {};
  try {
    if (inputData.trim()) {
      payload = JSON.parse(inputData);
    }
  } catch (e) {
    // Ignore JSON parse errors
  }

  // Do not block if user canceled or if already in terminal error state
  if (
    payload.terminationReason === 'USER_CANCELED' ||
    payload.terminationReason === 'TERMINAL_CUSTOM_HOOK' ||
    payload.terminationReason === 'ERROR'
  ) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  try {
    // Quality Gate: Ensure TypeScript compiles cleanly
    execSync('npm run typecheck', { cwd: repoRoot, stdio: 'pipe' });
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  } catch (err) {
    const output =
      (err.stdout ? err.stdout.toString() : '') +
      (err.stderr ? err.stderr.toString() : '');
    const summary = output.slice(0, 1000);
    process.stdout.write(
      JSON.stringify({
        decision: 'continue',
        reason: `Automated Quality Gate Check: TypeScript typecheck failed with errors. Please fix:\n${summary}`
      })
    );
  }
});
