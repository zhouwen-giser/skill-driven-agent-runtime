import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/*.unit.test.ts'],
        },
      },
      {
        test: {
          name: 'contract',
          include: ['packages/**/*.contract.test.ts'],
        },
      },
    ],
  },
});
