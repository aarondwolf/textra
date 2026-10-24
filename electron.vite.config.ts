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
      minify: true,
      // Emit the ~1,200 file-type SVGs as files instead of inlining them into the bundle.
      assetsInlineLimit: (file) => (file.includes('material-icon-theme') ? false : undefined),
    },
    optimizeDeps: {
      noDiscovery: true,
      include: [
        'react',
        'react-dom/client',
        'zustand',
        // useChat pulls in the AI SDK core, which fails to load as raw modules.
        '@ai-sdk/react',
        '@radix-ui/react-dialog',
        '@radix-ui/react-context-menu',
        '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-popover',
        '@radix-ui/react-toast',
        '@dnd-kit/core',
        '@dnd-kit/sortable',
        '@dnd-kit/utilities',
        '@tanstack/react-virtual',
        'cmdk',
        'diff',
        'jsonc-parser',
        'zod',
        'react-markdown',
        'remark-gfm',
        // Discovery is disabled: renderer/shared imports added during refactors must
        // be listed here, including ESM packages with CommonJS transitive dependencies.
        // Otherwise the browser rejects raw modules (for example unified's is-buffer).
        '@retorquere/bibtex-parser',
        '@unified-latex/unified-latex-util-parse',
        '@unified-latex/unified-latex-util-to-string',
        '@unified-latex/unified-latex-util-visit',
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
        'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js',
        'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols.js',
        'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js',
        'monaco-editor/editor/contrib/hover/browser/hoverContribution.js',
        'monaco-editor/editor/contrib/inlayHints/browser/inlayHints.js',
        'pdfjs-dist',
      ],
    },
    server: { host: '127.0.0.1' },
  },
});
