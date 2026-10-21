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
    build: {
      // Emit the ~1,200 file-type SVGs as files instead of inlining them into the bundle.
      assetsInlineLimit: (file) => (file.includes('material-icon-theme') ? false : undefined),
    },
    optimizeDeps: {
      noDiscovery: true,
      include: [
        'react',
        'react-dom/client',
        'zustand',
        '@radix-ui/react-dialog',
        '@phosphor-icons/react',
        // Every Monaco entry point must be pre-bundled together. Contributions imported
        // outside this list load as separate raw modules whose registrations the editor
        // (bundled from editor.api.js) never sees, so the features silently do nothing.
        'monaco-editor/editor/editor.api.js',
        'monaco-editor/editor/contrib/find/browser/findController.js',
        'monaco-editor/editor/contrib/suggest/browser/suggestController.js',
        'monaco-editor/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution.js',
        'monaco-editor/editor/contrib/folding/browser/folding.js',
        'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js',
        'monaco-editor/editor/contrib/comment/browser/comment.js',
        'pdfjs-dist',
      ],
    },
    server: { host: '127.0.0.1' },
  },
});
