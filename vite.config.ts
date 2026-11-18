/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Ships THIRD_PARTY_NOTICES.md with every build (license notices must accompany distribution). */
function thirdPartyNotices(): Plugin {
  return {
    name: 'bpmn-flow:third-party-notices',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-notices.txt',
        source: readFileSync(new URL('./THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
      });
    },
  };
}

// `BASE_PATH` lets the GitHub Pages workflow serve the SPA from /<repo>/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version,
    ),
  },
  plugins: [react(), tailwindcss(), thirdPartyNotices()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/roundtrip/**/*.test.ts'],
  },
});
