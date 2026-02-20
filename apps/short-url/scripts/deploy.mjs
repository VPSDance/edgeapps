import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  createRunner,
  deployCloudflarePages,
  deployEdgeOnePages,
  ensurePath,
  ensureRequiredEnv,
  loadDotEnvFiles,
  parseDeployArgs,
  resolveDeployTarget
} from '../../../scripts/deploy-shared.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, 'short-url.env');
const workspaceEnvPath = resolve(root, '..', '..', 'short-url.env');
const repoEnvPath = resolve(root, '..', '..', '..', 'short-url.env');
loadDotEnvFiles([repoEnvPath, workspaceEnvPath, envPath]);

const { dryRun, skipBuild, deployOnly } = parseDeployArgs(process.argv);

// Cloudflare config
const cfProject = process.env.CF_NAME || '';
const cfToken = process.env.CF_TOKEN || '';
const cfAccount = process.env.CF_ACCOUNT || '';

// EdgeOne config
const eoName = process.env.EO_NAME || '';
const eoToken = process.env.EO_TOKEN || '';

const distDir = resolve(root, 'dist');
const cfDir = resolve(distDir, 'cf');
const cfWorkerPath = resolve(cfDir, '_worker.js');
const eoDir = resolve(distDir, 'eo');
const eoDefaultFunc = resolve(eoDir, 'edge-functions/[[default]].js');
const run = createRunner({
  cwd: root,
  dryRun,
  baseEnv: {
    CLOUDFLARE_API_TOKEN: cfToken,
    CLOUDFLARE_ACCOUNT_ID: cfAccount
  }
});

function ensureBuildOutputs({ needCf, needEo }) {
  ensurePath(distDir, 'Run `pnpm -F short-url build` before deploy.');
  if (needCf) {
    ensurePath(cfWorkerPath, 'Cloudflare deploy requires dist/cf/_worker.js.');
  }
  if (needEo) {
    ensurePath(eoDefaultFunc, 'EdgeOne deploy requires dist/eo/edge-functions/[[default]].js.');
  }
}

async function deployCf() {
  ensureRequiredEnv(
    [
      { key: 'CF_NAME', value: cfProject },
      { key: 'CF_TOKEN', value: cfToken },
      { key: 'CF_ACCOUNT', value: cfAccount }
    ],
    '[Error] Missing Cloudflare config:'
  );

  console.log(`[Short-URL] Deploying to Cloudflare Pages (project: ${cfProject})...`);
  deployCloudflarePages({
    run,
    projectName: cfProject,
    dir: 'dist/cf'
  });
}

async function deployEo() {
  ensureRequiredEnv(
    [
      { key: 'EO_NAME', value: eoName },
      { key: 'EO_TOKEN', value: eoToken }
    ],
    '[Error] Missing EdgeOne config:'
  );

  console.log(`[Short-URL] Deploying to EdgeOne Pages (project: ${eoName})...`);
  deployEdgeOnePages({ run, projectName: eoName, token: eoToken, dir: 'dist/eo' });
  console.log('[Short-URL] EdgeOne deployment finished.');
}

async function main() {
  const onlyTarget = resolveDeployTarget(deployOnly);

  if (deployOnly && !onlyTarget) {
    console.error('[Error] -o must be "cf" or "eo"');
    process.exit(1);
  }

  const doCf = !onlyTarget || onlyTarget === 'cf';
  const doEo = !onlyTarget || onlyTarget === 'eo';

  if (!skipBuild) {
    console.log('[Short-URL] Building app artifacts...');
    run('pnpm', ['run', 'build']);
  }

  ensureBuildOutputs({ needCf: doCf, needEo: doEo });

  if (doCf) await deployCf();
  if (doEo) await deployEo();
}

main().catch((err) => {
  console.error(`[Error] ${err?.message || err}`);
  process.exit(1);
});
