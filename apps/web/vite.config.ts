import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  server: {
    allowedHosts: ['web.plt.local'],
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    command === 'build' && nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    viteReact(),
  ],
}))

export default config
