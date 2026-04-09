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
      includeAssets: [
        'payclock-icon.svg',
        'payclock-icon-192.png',
        'payclock-icon-512.png',
        'apple-touch-icon.png',
        'install-screenshot-wide.svg',
        'install-screenshot-narrow.svg',
      ],
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
            src: `${base}payclock-icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: `${base}payclock-icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: `${base}payclock-icon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
        shortcuts: [
          {
            name: '오늘 열기',
            short_name: '오늘',
            description: '오늘 근무 콘솔과 달력을 바로 엽니다.',
            url: `${base}?action=today`,
            icons: [
              {
                src: `${base}payclock-icon-192.png`,
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
          {
            name: '출근 시작',
            short_name: '출근',
            description: '오늘 근무를 바로 시작합니다.',
            url: `${base}?action=start`,
            icons: [
              {
                src: `${base}payclock-icon-192.png`,
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
          {
            name: '불러오기',
            short_name: '불러오기',
            description: 'JSON 또는 CSV 데이터를 가져옵니다.',
            url: `${base}?action=import`,
            icons: [
              {
                src: `${base}payclock-icon-192.png`,
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
          {
            name: '내보내기',
            short_name: '내보내기',
            description: '현재 데이터를 JSON으로 저장합니다.',
            url: `${base}?action=export-json`,
            icons: [
              {
                src: `${base}payclock-icon-192.png`,
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
        ],
        screenshots: [
          {
            src: `${base}install-screenshot-wide.svg`,
            sizes: '1280x720',
            type: 'image/svg+xml',
            form_factor: 'wide',
            label: '월 요약과 오늘 근무 콘솔이 함께 보이는 PayClock 메인 화면',
          },
          {
            src: `${base}install-screenshot-narrow.svg`,
            sizes: '720x1280',
            type: 'image/svg+xml',
            label: '모바일 너비에서 오늘 근무 패널이 먼저 보이는 PayClock 화면',
          },
        ],
        file_handlers: [
          {
            action: `${base}?action=import`,
            accept: {
              'application/json': ['.json'],
              'text/csv': ['.csv'],
            },
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
