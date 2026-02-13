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
const envPath = resolve(root, 'gh-proxy.env');
const repoEnvPath = resolve(root, '..', '..', '..', 'gh-proxy.env');
const workspaceEnvPath = resolve(root, '..', '..', 'gh-proxy.env');

loadDotEnvFiles([repoEnvPath, workspaceEnvPath, envPath]);

const { dryRun, skipBuild, deployOnly } = parseDeployArgs(process.argv);

const cfProject = process.env.CF_NAME || '';
const cfToken = process.env.CF_TOKEN || '';
const cfAccount = process.env.CF_ACCOUNT || '';
const eoName = process.env.EO_NAME || process.env.EDGEONE_PROJECT_NAME || '';
const eoToken = process.env.EO_TOKEN || process.env.EDGEONE_API_TOKEN || '';

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
  ensurePath(distDir, 'Run `pnpm -F gh-proxy build` before deploy.');
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

  console.log(`[GH-Proxy] Deploying to Cloudflare Pages (project: ${cfProject})...`);
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

  console.log(`[GH-Proxy] Deploying to EdgeOne Pages (project: ${eoName})...`);
  deployEdgeOnePages({ run, projectName: eoName, token: eoToken, dir: 'dist/eo' });
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
    console.log('[GH-Proxy] Building app artifacts...');
    run('node', ['scripts/build.mjs']);
  }

  ensureBuildOutputs({ needCf: doCf, needEo: doEo });

  if (doCf) await deployCf();
  if (doEo) await deployEo();
}

main().catch((err) => {
  console.error(`[Error] ${err?.message || err}`);
  process.exit(1);
});
