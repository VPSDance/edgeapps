import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const args = process.argv.slice(2);

function loadDotEnv(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (!quoted) {
        const hash = value.indexOf('#');
        if (hash >= 0) value = value.slice(0, hash).trim();
      }
      if (quoted) value = value.slice(1, -1);
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    return;
  }
}

loadDotEnv(envPath);

const dryRun = args.includes('--dry-run');
const shortIndex = args.indexOf('-o');
const cliOnly = shortIndex >= 0 ? args[shortIndex + 1] : '';

const cfName = process.env.CF_NAME || '';
const cfToken = process.env.CF_TOKEN || '';
const cfAccount = process.env.CF_ACCOUNT || '';
const cfCompat = process.env.CF_COMPAT_DATE || '2026-01-29';

const eoName = process.env.EO_NAME || '';
const eoToken = process.env.EO_TOKEN || '';
const deployOnly = (cliOnly || '').toLowerCase();

function run(cmd, cmdArgs, envOverrides = {}) {
  if (dryRun) {
    console.log(`[DRY] ${cmd} ${cmdArgs.join(' ')}`);
    return;
  }
  execFileSync(cmd, cmdArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...envOverrides }
  });
}

run('node', ['scripts/build.mjs']);

const onlyMap = { eo: 'edgeone', cf: 'cf' };
const onlyTarget = deployOnly ? onlyMap[deployOnly] : '';

if (deployOnly && !onlyTarget) {
  console.error('-o must be "cf" or "eo"');
  process.exit(1);
}

const doEdgeOne = !onlyTarget || onlyTarget === 'edgeone';
const doCf = !onlyTarget || onlyTarget === 'cf';

if (doEdgeOne) {
  if (!eoName || !eoToken) {
    console.error('Missing EdgeOne config: EO_NAME/EDGEONE_PROJECT_NAME and EO_TOKEN/EDGEONE_API_TOKEN');
    process.exit(1);
  }
  run('npx', ['-y', 'edgeone', 'pages', 'deploy', 'dist/edgeone', '-n', eoName, '-t', eoToken]);
}

if (doCf) {
  if (!cfName || !cfToken || !cfAccount) {
    console.error('Missing Cloudflare config: CF_NAME/CF_WORKER_NAME, CF_TOKEN, CF_ACCOUNT');
    process.exit(1);
  }
  const cfArgs = ['-y', 'wrangler', 'deploy', 'dist/cf/index.js', '--config', 'wrangler.toml', '--name', cfName, '--keep-vars'];
  if (cfCompat) cfArgs.push('--compatibility-date', cfCompat);
  run('npx', cfArgs, {
    CLOUDFLARE_API_TOKEN: cfToken,
    CLOUDFLARE_ACCOUNT_ID: cfAccount
  });
}
