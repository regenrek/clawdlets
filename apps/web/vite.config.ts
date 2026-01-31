import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vitest/config'
import tsConfigPaths from 'vite-tsconfig-paths'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      include: [
        'src/lib/auth-utils.ts',
        'src/lib/bootstrap-gate.ts',
        'src/lib/ip-utils.ts',
        'src/lib/utils.ts',
        'src/server/env.ts',
        'src/server/paths.ts',
        'src/server/redaction.ts',
        'src/server/template-spec.ts',
        'src/sdk/run-binding.ts',
        'src/sdk/serverfn-validators.ts',
        'src/sdk/secrets-allowlist.ts',
        'src/utils/seo.ts',
        'convex/lib/env.ts',
        'convex/lib/errors.ts',
        'convex/lib/rateLimit.ts',
      ],
      exclude: ['**/*.d.ts'],
    },
  },
  ssr: {
    noExternal: ['@convex-dev/better-auth'],
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart(),
    viteReact(),
  ],
})
