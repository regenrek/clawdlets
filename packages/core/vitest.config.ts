import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      all: true,
      include: [
        "src/doctor.ts",
        "src/doctor/deploy-checks.ts",
        "src/doctor/repo-checks.ts",
        "src/repo-layout.ts",
        "src/lib/age.ts",
        "src/lib/age-keygen.ts",
        "src/lib/clawdlets-config.ts",
        "src/lib/dot-path.ts",
        "src/lib/docs-index.ts",
        "src/lib/dotenv-file.ts",
        "src/lib/env.ts",
        "src/lib/fs-safe.ts",
        "src/lib/github.ts",
        "src/lib/hcloud.ts",
        "src/lib/mkpasswd.ts",
        "src/lib/nix-tools.ts",
        "src/lib/nix-flakes.ts",
        "src/lib/nix-host.ts",
        "src/lib/path-expand.ts",
        "src/lib/run.ts",
        "src/lib/secrets-policy.ts",
        "src/lib/sops-config.ts",
        "src/lib/sops.ts",
        "src/lib/ssh.ts",
        "src/lib/ssh-remote.ts",
        "src/lib/secrets-init.ts"
      ],
      exclude: ["src/index.ts"],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 60,
        "src/lib/**": {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 80
        }
      }
    }
  }
});
