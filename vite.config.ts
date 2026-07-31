import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // shadcn sources are vendored verbatim; they import from "@/…". Some
    // registry files also import each other through the registry's OWN
    // source-tree path (dialog.tsx pulls Button from
    // "@/registry/new-york-v4/ui/button") — aliasing that prefix to our
    // components dir keeps those files unedited too. Most specific first.
    alias: [
      {
        find: /^@\/registry\/[^/]+\/ui\//,
        replacement: path.resolve(import.meta.dirname, 'src/components/ui') + '/',
      },
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
    ],
  },
})
