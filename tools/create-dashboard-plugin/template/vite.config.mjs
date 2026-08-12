import { defineConfig } from 'vite';
import hostReact from './vite-plugin-host-react.mjs';

/**
 * AgentTeams Dashboard plugin dev/build configuration.
 *
 * `react` / `react-dom` / `react/jsx-runtime` are NOT bundled: they resolve
 * to the Dashboard host's React instance (window.__AGENTTEAMS_DASHBOARD_HOST__),
 * which is required for hooks/context to work across the boundary.
 */
export default defineConfig({
  plugins: [hostReact()],
  server: {
    port: 5173,
    strictPort: true,
    cors: true,
    origin: 'http://localhost:5173',
  },
  build: {
    lib: {
      entry: 'src/main.jsx',
      formats: ['es'],
      fileName: 'main',
    },
    outDir: 'dist',
    minify: false,
  },
});
