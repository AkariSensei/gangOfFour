import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // En développement, le serveur de jeu tourne à côté sur le port 3001.
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
});
