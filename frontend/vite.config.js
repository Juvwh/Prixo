import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Un second fichier `vite.config.ts` coexistait ici. Vite ne charge que le
// premier trouvé (`vite.config.js`), si bien que le fichier TypeScript n'avait
// aucun effet — et comme il ne déclarait pas le greffon Tailwind, toute reprise
// de celui-ci aurait livré une application sans aucun style. Ses seuls réglages
// propres sont repris ci-dessous.
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  base: '/Prixo/',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 3000,
    open: false,
  },
})
