import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env: NodeJS.ProcessEnv & {
    SDAR_CONSOLE_DEV_PORT?: string;
    SDAR_CONSOLE_DEV_PROXY_URL?: string;
  } = { ...loadEnv(mode, resolve(import.meta.dirname, '../..'), 'SDAR_'), ...process.env };
  return {
    base: '/console/',
    plugins: [react()],
    server: {
      port: Number(env.SDAR_CONSOLE_DEV_PORT ?? 5173),
      proxy: {
        '/api': env.SDAR_CONSOLE_DEV_PROXY_URL ?? 'http://127.0.0.1:10998',
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
