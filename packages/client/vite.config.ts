import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // La version compilée va dans dist/client à la racine, à côté du serveur compilé (dist/serveur).
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    // En développement, le serveur de jeu tourne à côté sur le port 3001.
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
});
