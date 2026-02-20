import { resolve, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  cpSync,
  copyFileSync,
  readdirSync,
  statSync
} from 'fs';
import { execFileSync } from 'child_process';
import { build as esbuild } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const webDir = resolve(root, '.build-web');
const cfDir = resolve(distDir, 'cf');
const eoDir = resolve(distDir, 'eo');
const eoFuncDir = resolve(eoDir, 'edge-functions');
const defaultPluginDir = resolve(root, '../../../private/plugins');

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

function getBuildPlugins() {
  if (!pluginEntries.length) return [];
  return [
    {
      name: 'plugin-alias',
      setup(build) {
        build.onResolve({ filter: /^@edgeapps\/core\/plugins$/ }, () => ({
          path: 'edgeapps-plugin:entry',
          namespace: 'edgeapps-plugin'
        }));
        build.onResolve({ filter: /^edgeapps-plugin-file:/ }, (args) => ({
          path: decodeURIComponent(args.path.replace(/^edgeapps-plugin-file:/, ''))
        }));
        build.onLoad({ filter: /.*/, namespace: 'edgeapps-plugin' }, () => ({
          contents: buildPluginModule(pluginEntries),
          loader: 'js'
        }));
      }
    }
  ];
}

function run(cmd, args) {
  execFileSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env }
  });
}

function readSpaHtml(inputDir) {
  const indexPath = resolve(inputDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`missing SPA output: ${indexPath}`);
  }
  return readFileSync(indexPath, 'utf8');
}

function copyWebAssets(targetDir) {
  cpSync(webDir, targetDir, {
    recursive: true,
    filter: (src) => !src.endsWith('index.html')
  });
}

async function bundleCloudflare(spaHtml) {
  await esbuild({
    entryPoints: [resolve(root, 'server/cloudflare.ts')],
    plugins: getBuildPlugins(),
    loader: {
      '.html': 'text'
    },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    define: {
      __SPA_HTML__: JSON.stringify(spaHtml),
      __EDGEAPPS_PLATFORM__: '"cf"'
    },
    outfile: resolve(cfDir, '_worker.js')
  });
}

async function bundleEdgeOne(spaHtml) {
  mkdirSync(eoFuncDir, { recursive: true });

  await esbuild({
    entryPoints: [resolve(root, 'server/edgeone.ts')],
    plugins: getBuildPlugins(),
    loader: {
      '.html': 'text'
    },
    bundle: true,
    format: 'esm',
    target: 'es2020',
    platform: 'browser',
    minify: false,
    define: {
      __SPA_HTML__: JSON.stringify(spaHtml),
      __EDGEAPPS_PLATFORM__: '"eo"',
      'process.env.NODE_ENV': '"production"'
    },
    outfile: resolve(eoFuncDir, '[[default]].js')
  });

  copyFileSync(resolve(eoFuncDir, '[[default]].js'), resolve(eoFuncDir, 'index.js'));

}

async function main() {
  console.log('[Short-URL] Building SPA (Rsbuild)...');
  run('pnpm', ['run', 'build:web']);

  // Snapshot the SPA output first, then rebuild dist into target-specific folders.
  rmSync(webDir, { recursive: true, force: true });
  cpSync(distDir, webDir, { recursive: true });
  const spaHtml = readSpaHtml(webDir);
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(cfDir, { recursive: true });
  mkdirSync(eoFuncDir, { recursive: true });

  console.log('[Short-URL] Bundling Cloudflare worker...');
  await bundleCloudflare(spaHtml);
  copyWebAssets(cfDir);

  console.log('[Short-URL] Bundling EdgeOne functions...');
  await bundleEdgeOne(spaHtml);
  copyWebAssets(eoDir);
  rmSync(webDir, { recursive: true, force: true });

  console.log('[Short-URL] Build complete: dist/cf + dist/eo');
}

main().catch((err) => {
  console.error(`[Error] ${err?.message || err}`);
  process.exit(1);
});
