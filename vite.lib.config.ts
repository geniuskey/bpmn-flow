/**
 * Library build of @geniuskey/bpmn-flow (see packages/bpmn-flow). Dependencies
 * stay external: the consumer's bundler resolves them from the package's
 * dependency list, so nothing third-party is copied into the bundle except the
 * diagram-js base stylesheet (MIT, noted in the package's NOTICE).
 */
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const external = /^(bpmn-moddle|diagram-js|didi|elkjs|tiny-svg|react|react-dom)(\/|$)/;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'packages/bpmn-flow/dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'es2022',
    copyPublicDir: false,
    cssCodeSplit: true,
    lib: {
      entry: {
        index: 'src/sdk/index.ts',
        editor: 'src/sdk/editor.ts',
        react: 'src/sdk/react.tsx',
        style: 'src/sdk/style.css',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) => external.test(id),
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
