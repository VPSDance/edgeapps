import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  source: {
    entry: {
      index: './src/cf/admin-app.source.jsx'
    }
  },
  html: {
    title: 'NPM Registry Admin',
    template: './src/cf/admin-index.html'
  },
  plugins: [pluginReact()]
});
