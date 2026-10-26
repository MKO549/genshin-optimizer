// viteStaticCopy contains some `require`, so we need to have our config as .mts instead of .ts.
// https://vitejs.dev/guide/troubleshooting.html#this-package-is-esm-only

import { resolve } from 'node:path'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import pkg from '../../package.json' with { type: 'json' }

// Only these public settings may be embedded in browser code.
const publicEnvKeys = [
  'NX_GA_TRACKINGID',
  'NX_SHOW_DEV_COMPONENTS',
  'NX_URL_DISCORD_GO',
  'NX_URL_DISCORD_GDEV',
  'NX_URL_PATREON_FRZYC',
  'NX_URL_PAYPAL_FRZYC',
  'NX_URL_GITHUB_GO',
  'NX_URL_GITHUB_GO_CURRENT_VERSION',
  'NX_URL_GITHUB_API_GO_RELEASES',
  'NX_URL_GITHUB_FRZYC',
  'NX_URL_GITHUB_LANTUA',
  'NX_URL_GITHUB_VAN',
  'NX_URL_TWITCH_FRZYC',
  'NX_URL_TWITTER_FRZYC',
  'NX_URL_YOUTUBE_TUTPL',
  'NX_URL_WEBSITE_KQM',
  'NX_URL_KQM_MULTI_GUIDE',
  'NX_URLS_GUIDES',
]

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'NX_')

  return {
    base: '',
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/apps/frontend',

    resolve: {
      alias: [
        {
          // MUI v5 deep icon imports otherwise load CommonJS alongside its ESM
          // components, causing Emotion initialization errors in lazy pages.
          find: /^@mui\/icons-material\/(?!esm\/)(.+)$/,
          replacement: '@mui/icons-material/esm/$1',
        },
      ],
    },

    server: {
      port: 4200,
      host: 'localhost',
    },

    preview: {
      port: 4300,
      host: 'localhost',
    },

    plugins: [
      react(),
      nxViteTsPaths(),
      // Nx executor for vite does not support `assets` prop for copying files.
      // So we need to do it with this plugin. This works for both `build` and `serve`.
      viteStaticCopy({
        targets: [
          {
            src: normalizePath(
              resolve('../../libs/common/localization/assets/locales')
            ),
            dest: 'assets',
          },
          {
            src: normalizePath(
              resolve('../../libs/gi/localization/assets/locales')
            ),
            dest: 'assets',
          },
          {
            src: normalizePath(
              resolve('../../libs/gi/dm-localization/assets/locales')
            ),
            dest: 'assets',
          },
          {
            src: normalizePath(
              resolve('../../libs/gi/silly-wisher-names/assets/locales')
            ),
            dest: 'assets',
          },
          {
            src: normalizePath(resolve('../../apps/frontend/assets/*')),
            dest: 'assets',
          },
        ],
        // Force page to reload if we change any of the above files
        watch: {
          reloadPageOnChange: true,
        },
      }),
    ],

    define: {
      ...Object.fromEntries(
        publicEnvKeys.map((key) => [
          `process.env.${key}`,
          JSON.stringify(env[key]) ?? 'undefined',
        ])
      ),
      __VERSION__: `"${pkg.version}"`,
    },

    // Uncomment this if you are using workers.
    worker: {
      // https://vitejs.dev/guide/migration#worker-plugins-is-now-a-function
      plugins: () => [nxViteTsPaths()],
    },

    build: {
      outDir: '../../dist/apps/frontend',
      reportCompressedSize: true,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },

    test: {
      watch: false,
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
      reporters: ['default'],
      coverage: {
        reportsDirectory: '../../coverage/apps/frontend',
        provider: 'v8',
      },
    },
  }
})
