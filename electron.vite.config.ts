import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  main: {},
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    // Keep mutable optimizer caches outside Dropbox/OneDrive checkouts on Windows.
    cacheDir: join(
      tmpdir(),
      'textra-vite-cache',
      createHash('sha256').update(process.cwd()).digest('hex').slice(0, 16),
    ),
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      noDiscovery: true,
      include: [
        'react',
        'react-dom/client',
        'zustand',
        '@radix-ui/react-dialog',
        'lucide-react',
        'monaco-editor/editor/editor.api.js',
        'pdfjs-dist',
      ],
    },
    server: { host: '127.0.0.1' },
  },
});
