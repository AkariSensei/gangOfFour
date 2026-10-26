import { defineConfig } from 'vite';

// « npm run build » compile le serveur en un seul fichier qui emporte ses bibliothèques (socket.io…) :
// l'hébergement n'a besoin que du dossier dist, sans node_modules.
export default defineConfig({
  build: { ssr: 'src/main.ts', outDir: '../../dist/serveur', emptyOutDir: true, target: 'node20' },
  ssr: { noExternal: true, external: ['bufferutil', 'utf-8-validate'] },
  // Les modules natifs facultatifs de ws ne sont pas emportés : on dit à ws de s'en passer.
  define: { 'process.env.WS_NO_BUFFER_UTIL': '"1"', 'process.env.WS_NO_UTF_8_VALIDATE': '"1"' },
  logLevel: 'warn',
});
