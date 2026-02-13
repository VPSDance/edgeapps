import { build, context } from 'esbuild';
import { resolve, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, statSync, rmSync, mkdirSync, cpSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = resolve(root, '../../packages/core/src');
const publicDir = resolve(root, 'public');
const watch = process.argv.includes('--watch');
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
        `{ req: getExport(p${idx}, 'handlePluginRequest'), res: getExport(p${idx}, 'handlePluginResponse'), scope: getExport(p${idx}, 'scope'), appliesTo: getExport(p${idx}, 'appliesTo') }`
    )
    .join(', ');
  return `
${imports}
const handlers = [${handlers}].filter((p) => typeof p.req === 'function' || typeof p.res === 'function');
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
`;
}

function getPlugins() {
  if (!pluginEntries.length) return [];
  return [
    {
      name: 'plugin-alias',
      setup(build) {
        build.onResolve({ filter: /^@edgeapps\/core\/plugins$/ }, () => ({
          path: 'edgeapps-plugin:entry',
          namespace: 'edgeapps-plugin'
        }));
        build.onResolve({ filter: /^@edgeapps\/core\/(.+)$/ }, (args) => ({
          path: resolve(coreRoot, `${args.path.split('/').pop()}.js`)
        }));
        build.onResolve({ filter: /^edgeapps-plugin-file:/ }, (args) => ({
          path: decodeURIComponent(
            args.path.replace(/^edgeapps-plugin-file:/, '')
          )
        }));
        build.onLoad({ filter: /.*/, namespace: 'edgeapps-plugin' }, () => ({
          contents: buildPluginModule(pluginEntries),
          loader: 'js'
        }));
      }
    }
  ];
}

const sharedOptions = {
  absWorkingDir: root,
  plugins: getPlugins(),
  bundle: true,
  treeShaking: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'info'
};

function copyPublicAssets(targetDir) {
  if (!existsSync(publicDir)) return;
  cpSync(publicDir, targetDir, { recursive: true });
}

if (watch) {
  mkdirSync(resolve(root, 'dist/cf'), { recursive: true });
  mkdirSync(resolve(root, 'dist/eo'), { recursive: true });
  copyPublicAssets(resolve(root, 'dist/cf'));
  copyPublicAssets(resolve(root, 'dist/eo'));

  const cfCtx = await context({
    ...sharedOptions,
    entryPoints: ['src/cf/index.js'],
    outfile: 'dist/cf/_worker.js'
  });
  const eoCtx = await context({
    ...sharedOptions,
    entryPoints: [
      'src/edgeone/edge-functions/[[default]].js',
      'src/edgeone/edge-functions/index.js'
    ],
    outdir: 'dist/eo/edge-functions',
    outbase: 'src/edgeone/edge-functions'
  });
  await cfCtx.watch();
  await eoCtx.watch();
  console.log('watching...');
} else {
  rmSync(resolve(root, 'dist'), { recursive: true, force: true });
  mkdirSync(resolve(root, 'dist/cf'), { recursive: true });
  mkdirSync(resolve(root, 'dist/eo/edge-functions'), { recursive: true });
  copyPublicAssets(resolve(root, 'dist/cf'));
  copyPublicAssets(resolve(root, 'dist/eo'));

  await build({
    ...sharedOptions,
    entryPoints: ['src/cf/index.js'],
    outfile: 'dist/cf/_worker.js'
  });

  await build({
    ...sharedOptions,
    entryPoints: [
      'src/edgeone/edge-functions/[[default]].js',
      'src/edgeone/edge-functions/index.js'
    ],
    outdir: 'dist/eo/edge-functions',
    outbase: 'src/edgeone/edge-functions'
  });
}
