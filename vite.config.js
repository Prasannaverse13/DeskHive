import { defineConfig } from 'vite';
import path from 'node:path';

// DESKHIVE_BASE: the path the site lives under. '/' for Vercel, '/<repo>/' for GitHub Pages.
export default defineConfig({
  root: 'web',
  base: process.env.DESKHIVE_BASE || '/',
  publicDir: 'public',
  resolve: { alias: { '@shared': path.resolve('shared') } },
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
