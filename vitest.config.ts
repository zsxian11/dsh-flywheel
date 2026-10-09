import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

/** Plain object: this file lives at the workspace root, while `vitest` is a
 * package-local devDependency and cannot be imported from here. */
export default {
  resolve: {
    alias: {
      '@dsh-flywheel/core': resolve(root, 'packages/core/src/index.ts'),
      '@dsh-flywheel/lexical-sqlite': resolve(root, 'packages/lexical-sqlite/src/index.ts'),
      '@deepseek-ai/dsh-llm': resolve(root, 'packages/dsh-bundle/tests/dsh-llm-stub.ts'),
      // `node:sqlite` is experimental and absent from `module.builtinModules`,
      // so vite cannot recognize it as a builtin; this bridge resolves it.
      'node:sqlite': resolve(root, 'packages/lexical-sqlite/tests/node-sqlite-shim.ts'),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'tests/**/*.spec.ts'],
  },
}
