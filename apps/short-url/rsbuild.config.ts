import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  source: {
    entry: {
      index: './app/main.tsx',
    },
  },
  html: {
    title: 'Short URL Admin',
    template: './app/index.html',
  },
  plugins: [
    pluginReact(),
  ],
});
