import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts', 'apps/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      '@desudn/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@desudn/diff-engine': path.resolve(__dirname, 'packages/diff-engine/src/index.ts'),
      '@desudn/chunker': path.resolve(__dirname, 'packages/chunker/src/index.ts'),
      '@desudn/manifest': path.resolve(__dirname, 'packages/manifest/src/index.ts'),
      '@desudn/dht-discovery': path.resolve(__dirname, 'packages/dht-discovery/src/index.ts'),
      '@desudn/p2p-network': path.resolve(__dirname, 'packages/p2p-network/src/index.ts'),
      '@desudn/downloader': path.resolve(__dirname, 'packages/downloader/src/index.ts'),
      '@desudn/integrity': path.resolve(__dirname, 'packages/integrity/src/index.ts'),
      '@desudn/patch-applier': path.resolve(__dirname, 'packages/patch-applier/src/index.ts'),
    },
  },
});
