import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  base: '/prixo/', // Configuration pour GitHub Pages. Si le repo s'appelle autrement, il faudra l'adapter, mais "prixo" est un bon pari d'après le contexte
})
