import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      'coverage/**',
      '.state/**',
      'source/**',
      'docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/**',
    ],
  },
  eslint.configs.recommended,
  {
    // Immutable recorded Node.js drivers retain their original bytes and evidence hashes.
    files: [
      'reports/inspection-area-v1/raw/deployment-drivers/**/*.mjs',
      'reports/ugv-zmq-phase5/governance-20261025/raw/console-validation.mjs',
    ],
    languageOptions: {
      globals: {
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['apps/console/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        Headers: 'readonly',
      },
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
