import { build as esbuild } from 'esbuild';
import { resolve, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import {
  existsSync,
  readdirSync,
  statSync,
  rmSync,
  mkdirSync,
  cpSync,
  readFileSync
} from 'fs';
import { execFileSync } from 'child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = resolve(root, '../../packages/core/src');
const distDir = resolve(root, 'dist');
const webDir = resolve(root, '.build-web');
const cfDir = resolve(distDir, 'cf');
const defaultPluginDir = resolve(root, '../../../private/plugins');
const watch = process.argv.includes('--watch');

function resolveOverlayPath(value) {
  if (!value) return '';
  if (isAbsolute(value)) return value;
  const base = process.env.INIT_CWD || process.cwd();
  return resolve(base, value);
}

const pluginEnv =
  process.env.EDGEAPPS_PLUGIN ||
  process.env.EDGEAPPS_OVERLAY ||
  (existsSync(defaultPluginDir) ? defaultPluginDir : '');
const pluginPath = pluginEnv ? resolveOverlayPath(pluginEnv) : '';
const pluginExists = pluginPath && existsSync(pluginPath);
if (pluginEnv && !pluginExists) {
  console.warn(`[plugin] file not found: ${pluginPath}`);
}

let pluginEntries = [];
if (pluginExists) {
  const stat = statSync(pluginPath);
  if (stat.isDirectory()) {
    pluginEntries = readdirSync(pluginPath)
      .filter(
        (name) =>
          (name.endsWith('.js') || name.endsWith('.mjs')) &&
          !name.startsWith('_') &&
          !name.startsWith('.')
      )
      .sort()
      .map((name) => resolve(pluginPath, name));
  } else {
    pluginEntries = [pluginPath];
  }
}

function run(cmd, args) {
  execFileSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env }
  });
}

function readAdminHtml(inputDir) {
  const indexPath = resolve(inputDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`missing admin index.html: ${indexPath}`);
  }
  return readFileSync(indexPath, 'utf8');
}

function copyWebAssets(targetDir) {
  cpSync(webDir, targetDir, {
    recursive: true,
    filter: (src) => !src.endsWith('index.html')
  });
}

function buildPluginModule(entries) {
  const imports = entries
    .map(
      (entry, idx) =>
        `import * as p${idx} from "edgeapps-plugin-file:${encodeURIComponent(entry)}";`
    )
    .join('\n');
  const handlers = entries
    .map(
      (_, idx) =>
        `{ req: getExport(p${idx}, 'handlePluginRequest'), res: getExport(p${idx}, 'handlePluginResponse'), adminEntries: getExport(p${idx}, 'getAdminEntries'), scope: getExport(p${idx}, 'scope'), appliesTo: getExport(p${idx}, 'appliesTo') }`
    )
    .join(', ');
  return `
${imports}
const handlers = [${handlers}].filter((p) =>
  typeof p.req === 'function' ||
  typeof p.res === 'function' ||
  typeof p.adminEntries === 'function'
);
function getExport(mod, name) {
  return Object.prototype.hasOwnProperty.call(mod, name) ? mod[name] : undefined;
}
function shouldRun(plugin, ctx) {
  const app = ctx?.meta?.app;
  const platform = ctx?.meta?.platform;
  if (plugin.scope) {
    const apps = plugin.scope.apps;
    const platforms = plugin.scope.platforms;
    if (Array.isArray(apps) && apps.length && (!app || !apps.includes(app))) return false;
    if (Array.isArray(platforms) && platforms.length && (!platform || !platforms.includes(platform))) return false;
  }
  return true;
}
export async function handlePluginRequest(ctx) {
  for (const plugin of handlers) {
    if (typeof plugin.req !== 'function') continue;
    if (!shouldRun(plugin, ctx)) continue;
    if (typeof plugin.appliesTo === 'function') {
      const ok = await plugin.appliesTo(ctx);
      if (!ok) continue;
    }
    const res = await plugin.req(ctx);
    if (res) return res;
  }
  return null;
}
export async function handlePluginResponse(ctx) {
  for (const plugin of handlers) {
    if (typeof plugin.res !== 'function') continue;
    if (!shouldRun(plugin, ctx)) continue;
    if (typeof plugin.appliesTo === 'function') {
      const ok = await plugin.appliesTo(ctx);
      if (!ok) continue;
    }
    const res = await plugin.res(ctx);
    if (res) return res;
  }
  return null;
}
export async function getPluginAdminEntries(ctx) {
  const items = [];
  for (const plugin of handlers) {
    if (typeof plugin.adminEntries !== 'function') continue;
    if (!shouldRun(plugin, ctx)) continue;
    if (typeof plugin.appliesTo === 'function') {
      const ok = await plugin.appliesTo(ctx);
      if (!ok) continue;
    }
    const res = await plugin.adminEntries(ctx);
    if (!Array.isArray(res)) continue;
    for (const item of res) {
      if (item && typeof item === 'object') {
        items.push(item);
      }
    }
  }
  return items;
}
`;
}

function getPlugins() {
  if (!pluginEntries.length) return [];
  return [
    {
      name: 'plugin-alias',
      setup(buildConfig) {
        buildConfig.onResolve({ filter: /^@edgeapps\/core\/plugins$/ }, () => ({
          path: 'edgeapps-plugin:entry',
          namespace: 'edgeapps-plugin'
        }));
        buildConfig.onResolve({ filter: /^@edgeapps\/core\/(.+)$/ }, (args) => ({
          path: resolve(coreRoot, `${args.path.split('/').pop()}.js`)
        }));
        buildConfig.onResolve({ filter: /^edgeapps-plugin-file:/ }, (args) => ({
          path: decodeURIComponent(args.path.replace(/^edgeapps-plugin-file:/, ''))
        }));
        buildConfig.onLoad({ filter: /.*/, namespace: 'edgeapps-plugin' }, () => ({
          contents: buildPluginModule(pluginEntries),
          loader: 'js'
        }));
      }
    }
  ];
}

function buildAdminSpa() {
  rmSync(distDir, { recursive: true, force: true });
  run('pnpm', ['exec', 'rsbuild', 'build']);

  rmSync(webDir, { recursive: true, force: true });
  cpSync(distDir, webDir, { recursive: true });
  return readAdminHtml(webDir);
}

async function bundleCloudflare(adminHtml) {
  await esbuild({
    absWorkingDir: root,
    plugins: getPlugins(),
    loader: {
      '.html': 'text',
      '.css': 'text'
    },
    bundle: true,
    treeShaking: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'info',
    define: {
      __ADMIN_SPA_HTML__: JSON.stringify(adminHtml)
    },
    entryPoints: ['src/cf/index.js'],
    outfile: 'dist/cf/_worker.js'
  });
}

async function main() {
  if (watch) {
    console.warn('[NPM-Registry] --watch currently rebuilds worker only. Re-run after frontend changes.');
  }

  console.log('[NPM-Registry] Building admin SPA (Rsbuild)...');
  const adminHtml = buildAdminSpa();

  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(cfDir, { recursive: true });

  console.log('[NPM-Registry] Bundling Cloudflare worker...');
  await bundleCloudflare(adminHtml);
  copyWebAssets(cfDir);

  rmSync(webDir, { recursive: true, force: true });

  console.log('[NPM-Registry] Build complete: dist/cf');
}

main().catch((err) => {
  console.error(`[Error] ${err?.message || err}`);
  process.exit(1);
});
