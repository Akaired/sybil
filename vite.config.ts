import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'

// Custom plugin to handle ?import&react syntax (alias to ?react)
const svgImportPlugin = () => ({
  name: 'svg-import-alias',
  resolveId(id: string) {
    // Transform ?import&react to ?react for vite-plugin-svgr
    if (id.includes('?import&react')) {
      return id.replace('?import&react', '?react');
    }
    return null;
  },
});

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(),
    tailwindcss(),
    svgImportPlugin(),
    svgr({
      // Support named ReactComponent export (for ?react syntax)
      svgrOptions: {
        exportType: 'named',
        namedExport: 'ReactComponent',
        ref: true,
        svgo: false,
        titleProp: true,
      },
      include: '**/*.svg?react',
    }),
  ],
  server: {
    allowedHosts: true as const,
    hmr: false,
    // Mirrors public/_redirects, which only takes effect on Netlify — without
    // this, /docs/md/:slug, /llms.txt and /llms-full.txt 404 in local dev.
    proxy: {
      '/docs/md': {
        target: 'https://uhrqlwoejawnnhdeabob.supabase.co',
        changeOrigin: true,
        rewrite: (path: string) => {
          const slug = path.replace(/^\/docs\/md\//, '');
          return `/functions/v1/docs-public?slug=${encodeURIComponent(slug)}`;
        },
      },
      '/llms.txt': {
        target: 'https://uhrqlwoejawnnhdeabob.supabase.co',
        changeOrigin: true,
        rewrite: () => '/functions/v1/docs-public?index=1',
      },
      '/llms-full.txt': {
        target: 'https://uhrqlwoejawnnhdeabob.supabase.co',
        changeOrigin: true,
        rewrite: () => '/functions/v1/docs-public?full=1',
      },
    },
  },
}))
