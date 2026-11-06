// One command to run the whole project from whatever branch you're on: sets up .env,
// migrates and seeds the database, then starts the dev server. Safe to run again — db:setup
// only adds what's missing and never overwrites existing data.
// Usage: npm run go
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** @returns {string} the current git branch, or 'unknown' outside a git checkout. */
export function currentBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

/** @param {string} branch */
export function banner(branch) {
  const title = ` Lease Loop — branch ${branch} `;
  const width = Math.max(title.length, 40);
  const rule = '─'.repeat(width);
  return [`┌${rule}┐`, `│${title.padEnd(width)}│`, `└${rule}┘`].join('\n');
}

function run(command, args) {
  const result = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  return new Promise((resolve, reject) => {
    result.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))
    );
    result.on('error', reject);
  });
}

async function main() {
  console.log(banner(currentBranch()));
  console.log('🔧 Setting up the database (migrate + seed, safe to re-run)...\n');
  await run('npm', ['run', 'db:setup']);
  console.log('\n🚀 Starting the dev server...\n');
  await run('npm', ['run', 'dev']);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`✖ ${error.message}`);
    process.exit(1);
  });
}
