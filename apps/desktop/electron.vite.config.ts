import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: { lib: { entry: 'electron/main/index.ts' } },
  },
  renderer: {
    root: 'src',
    build: { rolldownOptions: { input: resolve('src/index.html') } },
    plugins: [react(), tailwindcss()],
  },
})
