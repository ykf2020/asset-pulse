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
        // 後端測試跑在 node 環境（用到 node:crypto、child_process）。
        // 刻意放在 api/ 之外 —— Vercel 會把 api/ 底下每個 .ts 都變成一支
        // serverless function，測試檔留在那裡會被當成端點部署出去。
        extends: true,
        test: {
          name: 'api',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
        },
      },
    ],
  },
})
