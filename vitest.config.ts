import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@dsh-flywheel/core': resolve(root, 'packages/core/src/index.ts'),
      '@dsh-flywheel/lexical-sqlite': resolve(root, 'packages/lexical-sqlite/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
  },
})
