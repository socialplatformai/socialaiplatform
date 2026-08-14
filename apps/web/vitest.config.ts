import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Component testing (E0.2). jsdom + Testing Library; transformamos JSX via
// plugin-react. Alias @/* → raiz do app (igual ao tsconfig). Não testamos
// estilo Tailwind, só semântica/a11y (label, hint, placeholder, erro).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['components/**/*.test.tsx', 'app/**/*.test.tsx', 'lib/**/*.test.ts'],
  },
})
