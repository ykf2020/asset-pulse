import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['shared/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
        },
      },
      {
        // api/ 用到 node:crypto 與 child_process，跑在 node 環境
        extends: true,
        test: {
          name: 'api',
          environment: 'node',
          include: ['api/**/*.test.ts'],
        },
      },
    ],
  },
})
