import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => {
  // Shares SERVER_PORT with the game server via the repo-root .env.
  const env = loadEnv(mode, repoRoot, 'SERVER_');
  const server = `http://localhost:${env.SERVER_PORT || 3000}`;

  return {
    plugins: [react()],
    server: {
      host: true, // reachable from phones on the LAN during development
      port: 5173,
      strictPort: true,
      proxy: {
        '/socket.io': { target: server, ws: true },
        '/api': server,
      },
    },
  };
});
