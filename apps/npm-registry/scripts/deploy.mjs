import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  createRunner,
  deployCloudflarePages,
  ensurePath,
  ensureRequiredEnv,
  loadDotEnvFiles,
  parseDeployArgs,
  resolveDeployTarget
} from '../../../scripts/deploy-shared.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, 'npm-registry.env');
const workspaceEnvPath = resolve(root, '..', '..', 'npm-registry.env');
const repoEnvPath = resolve(root, '..', '..', '..', 'npm-registry.env');
loadDotEnvFiles([repoEnvPath, workspaceEnvPath, envPath]);

const { dryRun, skipBuild, deployOnly } = parseDeployArgs(process.argv);

const cfProject = process.env.CF_NAME || '';
const cfToken = process.env.CF_TOKEN || '';
const cfAccount = process.env.CF_ACCOUNT || '';

const distDir = resolve(root, 'dist');
const cfDir = resolve(distDir, 'cf');
const cfWorkerPath = resolve(cfDir, '_worker.js');

const run = createRunner({
  cwd: root,
  dryRun,
  baseEnv: {
    CLOUDFLARE_API_TOKEN: cfToken,
    CLOUDFLARE_ACCOUNT_ID: cfAccount
  }
});

function ensureBuildOutputs() {
  ensurePath(distDir, 'Run `pnpm -F npm-registry build` before deploy.');
  ensurePath(cfWorkerPath, 'Cloudflare deploy requires dist/cf/_worker.js.');
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

  console.log(`[NPM-Registry] Deploying to Cloudflare Pages (project: ${cfProject})...`);
  deployCloudflarePages({
    run,
    projectName: cfProject,
    dir: 'dist/cf'
  });
}

async function main() {
  const onlyTarget = resolveDeployTarget(deployOnly);
  if (deployOnly && !onlyTarget) {
    console.error('[Error] -o must be "cf"');
    process.exit(1);
  }
  if (onlyTarget && onlyTarget !== 'cf') {
    console.error('[Error] npm-registry currently supports Cloudflare only (-o cf).');
    process.exit(1);
  }

  if (!skipBuild) {
    console.log('[NPM-Registry] Building app artifacts...');
    run('node', ['scripts/build.mjs']);
  }

  ensureBuildOutputs();
  await deployCf();
}

main().catch((err) => {
  console.error(`[Error] ${err?.message || err}`);
  process.exit(1);
});
