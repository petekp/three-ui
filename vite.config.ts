import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // shadcn sources are vendored verbatim; they import from "@/…".
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
})
