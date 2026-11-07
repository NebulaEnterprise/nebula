import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  base: './',
  server: {
    port: 4178,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3850' },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
