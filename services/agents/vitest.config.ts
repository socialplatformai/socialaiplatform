import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Resolve o alias @/* → src/* (igual ao tsconfig) para os testes acharem
// @/types/pipeline etc. sem build. Vitest roda ESM/TS nativo (type:module).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
