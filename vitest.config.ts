import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/**/*.unit.test.ts',
            'apps/**/*.unit.test.ts',
            'apps/**/*.unit.test.tsx',
          ],
        },
      },
      {
        test: {
          name: 'contract',
          include: ['packages/**/*.contract.test.ts', 'apps/**/*.contract.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/**/*.integration.test.ts', 'apps/**/*.integration.test.ts'],
          fileParallelism: false,
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['packages/**/*.e2e.test.ts', 'apps/**/*.e2e.test.ts'],
          fileParallelism: false,
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
