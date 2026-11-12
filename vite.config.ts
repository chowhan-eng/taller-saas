/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Multi-page build: every route is a real index.html in dist/, so deep links (/onboarding, the Stripe
// success_url /onboarding/gracias/) work on Base44 hosting without relying on SPA rewrites.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    resolve: { alias: { '@': r('./src') } },
    build: {
      rollupOptions: {
        input: {
          home: r('./index.html'),
          onboarding: r('./onboarding/index.html'),
          gracias: r('./onboarding/gracias/index.html'),
          privacidad: r('./privacidad/index.html'),
          dashboard: r('./dashboard/index.html'),
          login: r('./login/index.html'),
          register: r('./register/index.html'),
          forgot: r('./forgot-password/index.html'),
          reset: r('./reset-password/index.html'),
        },
      },
    },
    // Local dev: forward /functions/* to the deployed Base44 app (VITE_BASE44_APP_URL in .env.local).
    server: env.VITE_BASE44_APP_URL
      ? { proxy: { '/functions': { target: env.VITE_BASE44_APP_URL, changeOrigin: true } } }
      : {},
    test: { include: ['tests/**/*.test.ts'] },
  };
});
