import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, 'gh-proxy.env');
const repoEnvPath = resolve(root, '..', '..', '..', 'gh-proxy.env');
const workspaceEnvPath = resolve(root, '..', '..', 'gh-proxy.env');
const args = process.argv.slice(2);
const useColor = process.stdout.isTTY;
const color = (code, value) => (useColor ? `\x1b[${code}m${value}\x1b[0m` : value);
const green = (value) => color('32', value);
const red = (value) => color('31', value);
const yellow = (value) => color('33', value);
const gray = (value) => color('90', value);
const cfPrefix = () => `${gray('[CF]')}${green('[✔]')}`;
const cfErrorPrefix = () => `${gray('[CF]')}${red('[✖]')}`;
const dryPrefix = () => `${yellow('[DRY]')}`;

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

loadDotEnv(repoEnvPath);
loadDotEnv(workspaceEnvPath);
loadDotEnv(envPath);

const dryRun = args.includes('--dry-run');
const shortIndex = args.indexOf('-o');
const cliOnly = shortIndex >= 0 ? args[shortIndex + 1] : '';

const cfName = process.env.CF_NAME || '';
const cfToken = process.env.CF_TOKEN || '';
const cfAccount = process.env.CF_ACCOUNT || '';
const cfCompat = process.env.CF_COMPAT_DATE || '2026-01-29';
const cfKeepBindingsRaw = 'kv_namespace,plain_text,secret_text,r2_bucket,d1';

const eoName = process.env.EO_NAME || '';
const eoToken = process.env.EO_TOKEN || '';
const deployOnly = (cliOnly || '').toLowerCase();

function run(cmd, cmdArgs, envOverrides = {}) {
  if (dryRun) {
    console.log(`${dryPrefix()} ${cmd} ${cmdArgs.join(' ')}`);
    return;
  }
  execFileSync(cmd, cmdArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...envOverrides }
  });
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function deployCfViaApi() {
  const scriptPath = resolve(root, 'dist/cf/index.js');
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/workers/scripts/${cfName}`;
  const keepBindings = parseCsv(cfKeepBindingsRaw);
  const metadata = {
    main_module: 'index.js',
    compatibility_date: cfCompat,
    keep_bindings: keepBindings
  };
  if (dryRun) {
    console.log(`${dryPrefix()} CF API deploy: ${url}`);
    return;
  }
  console.log(`${cfPrefix()} API deploy -> ${cfName}`);
  const scriptBuf = readFileSync(scriptPath);
  console.log(`${cfPrefix()} upload size=${scriptBuf.length} bytes`);
  const form = new FormData();
  form.set('metadata', JSON.stringify(metadata));
  form.set(
    'index.js',
    new Blob([scriptBuf], { type: 'application/javascript+module' }),
    'index.js'
  );
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${cfToken}` },
    body: form
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CF API deploy failed (${res.status}): ${body}`);
  }
  const json = await res.json().catch(() => null);
  if (json && json.success === false) {
    throw new Error(`CF API deploy failed: ${JSON.stringify(json.errors || json)}`);
  }
  const resultId = json?.result?.id || json?.result?.script_id || '';
  if (resultId) {
    console.log(`${cfPrefix()} API deploy done (id=${resultId})`);
  } else {
    console.log(`${cfPrefix()} API deploy done`);
  }
}

async function main() {
  run('node', ['scripts/build.mjs']);

  const onlyMap = { eo: 'edgeone', cf: 'cf' };
  const onlyTarget = deployOnly ? onlyMap[deployOnly] : '';

  if (deployOnly && !onlyTarget) {
    console.error(`${cfErrorPrefix()} -o must be "cf" or "eo"`);
    process.exit(1);
  }

  const doEdgeOne = !onlyTarget || onlyTarget === 'edgeone';
  const doCf = !onlyTarget || onlyTarget === 'cf';

  if (doEdgeOne) {
    if (!eoName || !eoToken) {
      console.error(`${cfErrorPrefix()} Missing EdgeOne config: EO_NAME/EDGEONE_PROJECT_NAME and EO_TOKEN/EDGEONE_API_TOKEN`);
      process.exit(1);
    }
    run('npx', ['-y', 'edgeone', 'pages', 'deploy', 'dist/edgeone', '-n', eoName, '-t', eoToken]);
  }

  if (doCf) {
    if (!cfName || !cfToken || !cfAccount) {
      console.error(`${cfErrorPrefix()} Missing Cloudflare config: CF_NAME/CF_WORKER_NAME, CF_TOKEN, CF_ACCOUNT`);
      process.exit(1);
    }
    await deployCfViaApi();
  }
}

main().catch((err) => {
  console.error(`${cfErrorPrefix()} ${err?.message || err}`);
  process.exit(1);
});
