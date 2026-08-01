import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const at = (...p: string[]) => path.resolve(import.meta.dirname, ...p)

// Two trees, one repo:
//
//   src/   the three-ui library. Its public surface is src/index.ts, and
//          nothing inside it may import from app/.
//   app/   the lab application. A CONSUMER — it reaches the library only
//          through the `three-ui` specifier below, exactly as an outside
//          project would, so anything missing from the barrel fails the
//          build instead of quietly slipping past it on a relative path.
//
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Most specific first.
    alias: [
      // The library's public API and its required stylesheet, under the
      // names a published package would expose.
      { find: 'three-ui/style.css', replacement: at('src/three-ui.css') },
      { find: 'three-ui', replacement: at('src/index.ts') },
      // shadcn sources are vendored verbatim; they import from "@/…". Some
      // registry files also import each other through the registry's OWN
      // source-tree path (dialog.tsx pulls Button from
      // "@/registry/new-york-v4/ui/button") — aliasing that prefix to our
      // components dir keeps those files unedited too.
      {
        find: /^@\/registry\/[^/]+\/ui\//,
        replacement: at('app/components/ui') + '/',
      },
      { find: '@', replacement: at('app') },
    ],
  },
})
