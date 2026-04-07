import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.BASE_URL ?? (process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : '/')

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['payclock-icon.svg'],
      manifest: {
        name: 'PayClock Web',
        short_name: 'PayClock',
        description: '브라우저와 Windows에서 사용할 수 있는 초과근무 수당 계산기',
        theme_color: '#122431',
        background_color: '#f4efe8',
        display: 'standalone',
        start_url: base,
        lang: 'ko',
        icons: [
          {
            src: `${base}payclock-icon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
