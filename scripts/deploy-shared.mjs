import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

export function loadDotEnvFiles(paths) {
  for (const path of paths) {
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
      // Optional env files are best-effort.
    }
  }
}

export function parseDeployArgs(argv) {
  const args = argv.slice(2);
  const oIndex = args.indexOf('-o');
  const deployOnly = oIndex >= 0 && args[oIndex + 1] ? args[oIndex + 1] : '';
  return {
    dryRun: args.includes('--dry-run'),
    skipBuild: args.includes('--skip-build'),
    deployOnly
  };
}

export function resolveDeployTarget(value) {
  const key = String(value || '').toLowerCase();
  if (!key) return '';
  const map = {
    cf: 'cf',
    eo: 'eo'
  };
  return map[key] || '';
}

export function createRunner({ cwd, dryRun = false, baseEnv = {} }) {
  return function run(cmd, cmdArgs, envOverrides = {}) {
    if (dryRun) {
      console.log(`[DRY] ${cmd} ${cmdArgs.join(' ')}`);
      return;
    }
    execFileSync(cmd, cmdArgs, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...baseEnv,
        ...envOverrides
      }
    });
  };
}

export function ensurePath(path, hint) {
  if (existsSync(path)) return;
  console.error(`[Error] Missing build artifact: ${path}`);
  if (hint) {
    console.error(`[Hint] ${hint}`);
  }
  process.exit(1);
}

export function ensureRequiredEnv(items, messagePrefix) {
  const missing = items.filter((item) => !item.value).map((item) => item.key);
  if (!missing.length) return;
  const prefix = messagePrefix || '[Error] Missing required env';
  console.error(`${prefix} ${missing.join(', ')}`);
  process.exit(1);
}

export function deployCloudflarePages({ run, projectName, dir = 'dist/cf', branch = 'main' }) {
  run('npx', [
    '-y',
    'wrangler',
    'pages',
    'deploy',
    dir,
    '--project-name',
    projectName,
    '--branch',
    branch,
    '--commit-dirty=true'
  ]);
}

export function deployEdgeOnePages({ run, projectName, token, dir = 'dist/eo' }) {
  run('npx', ['-y', 'edgeone', 'pages', 'deploy', dir, '-n', projectName, '-t', token]);
}
