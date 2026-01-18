import { describe, it, expect } from "vitest";

describe("secrets-init JSON + non-interactive validation", () => {
  it("detects placeholders in buildSecretsInitTemplate (enforcement regression)", async () => {
    const { buildSecretsInitTemplate, listSecretsInitPlaceholders } = await import("../src/lib/secrets-init");

    const t1 = buildSecretsInitTemplate({ bots: ["maren", "sonja"], requiresTailscaleAuthKey: true });
    expect(
      listSecretsInitPlaceholders({
        input: t1,
        bots: ["maren", "sonja"],
        requiresTailscaleAuthKey: true,
      }),
    ).toEqual(["adminPasswordHash", "discordTokens.maren", "discordTokens.sonja", "tailscaleAuthKey"]);

    const t2 = buildSecretsInitTemplate({ bots: ["maren"], requiresTailscaleAuthKey: false });
    expect(
      listSecretsInitPlaceholders({
        input: { ...t2, tailscaleAuthKey: "<REPLACE_WITH_TSKEY_AUTH>" },
        bots: ["maren"],
        requiresTailscaleAuthKey: false,
      }),
    ).toEqual(["adminPasswordHash", "discordTokens.maren"]);
  });

  it("isPlaceholderSecretValue only matches full <...> tokens", async () => {
    const { isPlaceholderSecretValue } = await import("../src/lib/secrets-init");
    expect(isPlaceholderSecretValue("<FILL_ME>")).toBe(true);
    expect(isPlaceholderSecretValue("abc<FILL_ME>def")).toBe(false);
    expect(isPlaceholderSecretValue("<OPTIONAL>")).toBe(false);
  });

  it("listSecretsInitPlaceholders finds placeholders by field", async () => {
    const { listSecretsInitPlaceholders } = await import("../src/lib/secrets-init");
    const input = {
      adminPasswordHash: "<REPLACE_WITH_YESCRYPT_HASH>",
      tailscaleAuthKey: "<REPLACE_WITH_TSKEY_AUTH>",
      secrets: { z_ai_api_key: "<OPTIONAL>", openai_api_key: "<REPLACE_WITH_OPENAI_KEY>" },
      discordTokens: { maren: "<REPLACE_WITH_DISCORD_TOKEN>", sonja: "tok<ok>" },
    };
    expect(
      listSecretsInitPlaceholders({
        input,
        bots: ["maren", "sonja"],
        requiresTailscaleAuthKey: true,
      }),
    ).toEqual(["adminPasswordHash", "discordTokens.maren", "secrets.openai_api_key", "tailscaleAuthKey"]);
  });

  it("parseSecretsInitJson rejects invalid JSON without leaking content", async () => {
    const { parseSecretsInitJson } = await import("../src/lib/secrets-init");
    expect(() => parseSecretsInitJson("{")).toThrow(/expected valid JSON/i);
  });

  it("parseSecretsInitJson rejects missing adminPasswordHash without leaking tokens", async () => {
    const { parseSecretsInitJson } = await import("../src/lib/secrets-init");
    const secret = "SUPER_SECRET_TOKEN_123";
    const raw = JSON.stringify({ discordTokens: { maren: secret } });
    try {
      parseSecretsInitJson(raw);
      throw new Error("expected parseSecretsInitJson to throw");
    } catch (e: any) {
      const msg = String(e?.message || "");
      expect(msg).toMatch(/missing adminPasswordHash/i);
      expect(msg).not.toContain(secret);
    }
  });

  it("parseSecretsInitJson trims fields and ignores empty tokens", async () => {
    const { parseSecretsInitJson } = await import("../src/lib/secrets-init");
    const out = parseSecretsInitJson(
      JSON.stringify({
        adminPasswordHash: "  hash  ",
        tailscaleAuthKey: "  ts  ",
        secrets: { z_ai_api_key: "  zai  ", empty: " " },
        discordTokens: { maren: "  tok  ", sonja: " " },
      }),
    );
    expect(out.adminPasswordHash).toBe("hash");
    expect(out.tailscaleAuthKey).toBe("ts");
    expect(out.secrets).toEqual({ z_ai_api_key: "zai" });
    expect(out.discordTokens).toEqual({ maren: "tok" });
  });

  it("validateSecretsInitNonInteractive requires --from-json", async () => {
    const { validateSecretsInitNonInteractive } = await import("../src/lib/secrets-init");
    expect(() =>
      validateSecretsInitNonInteractive({
        interactive: false,
        fromJson: undefined,
        yes: false,
        dryRun: false,
        localSecretsDirExists: false,
      }),
    ).toThrow(/requires --from-json/i);
  });

  it("validateSecretsInitNonInteractive blocks overwrite without --yes", async () => {
    const { validateSecretsInitNonInteractive } = await import("../src/lib/secrets-init");
    expect(() =>
      validateSecretsInitNonInteractive({
        interactive: false,
        fromJson: "-",
        yes: false,
        dryRun: false,
        localSecretsDirExists: true,
      }),
    ).toThrow(/refusing to overwrite/i);
  });

  it("validateSecretsInitNonInteractive allows overwrite with --yes", async () => {
    const { validateSecretsInitNonInteractive } = await import("../src/lib/secrets-init");
    expect(() =>
      validateSecretsInitNonInteractive({
        interactive: false,
        fromJson: "-",
        yes: true,
        dryRun: false,
        localSecretsDirExists: true,
      }),
    ).not.toThrow();
  });

  it("resolveSecretsInitFromJsonArg accepts explicit value", async () => {
    const { resolveSecretsInitFromJsonArg } = await import("../src/lib/secrets-init");
    expect(
      resolveSecretsInitFromJsonArg({
        fromJsonRaw: " ./secrets.json ",
        argv: [],
        stdinIsTTY: true,
      }),
    ).toBe("./secrets.json");
  });

  it("resolveSecretsInitFromJsonArg rejects explicit value that looks like a flag", async () => {
    const { resolveSecretsInitFromJsonArg } = await import("../src/lib/secrets-init");
    expect(() =>
      resolveSecretsInitFromJsonArg({
        fromJsonRaw: "--oops",
        argv: [],
        stdinIsTTY: true,
      }),
    ).toThrow(/missing --from-json value/i);
  });

  it("resolveSecretsInitFromJsonArg accepts --from-json - only when explicitly present in argv", async () => {
    const { resolveSecretsInitFromJsonArg } = await import("../src/lib/secrets-init");
    expect(
      resolveSecretsInitFromJsonArg({
        fromJsonRaw: true,
        argv: ["node", "cli.js", "secrets", "init", "--from-json", "-", "--yes"],
        stdinIsTTY: false,
      }),
    ).toBe("-");
  });

  it("resolveSecretsInitFromJsonArg accepts inline --from-json=<path>", async () => {
    const { resolveSecretsInitFromJsonArg } = await import("../src/lib/secrets-init");
    expect(
      resolveSecretsInitFromJsonArg({
        fromJsonRaw: true,
        argv: ["node", "cli.js", "secrets", "init", "--from-json=./secrets.json"],
        stdinIsTTY: true,
      }),
    ).toBe("./secrets.json");
  });

  it("resolveSecretsInitFromJsonArg rejects missing value when parsed as boolean flag", async () => {
    const { resolveSecretsInitFromJsonArg } = await import("../src/lib/secrets-init");
    expect(() =>
      resolveSecretsInitFromJsonArg({
        fromJsonRaw: true,
        argv: ["node", "cli.js", "secrets", "init", "--from-json", "--yes"],
        stdinIsTTY: false,
      }),
    ).toThrow(/missing --from-json value/i);
  });

  it("resolveSecretsInitFromJsonArg rejects TTY stdin for boolean flag with --from-json -", async () => {
    const { resolveSecretsInitFromJsonArg } = await import("../src/lib/secrets-init");
    expect(() =>
      resolveSecretsInitFromJsonArg({
        fromJsonRaw: true,
        argv: ["node", "cli.js", "secrets", "init", "--from-json", "-"],
        stdinIsTTY: true,
      }),
    ).toThrow(/tty/i);
  });

  it("resolveSecretsInitFromJsonArg rejects TTY stdin for --from-json -", async () => {
    const { resolveSecretsInitFromJsonArg } = await import("../src/lib/secrets-init");
    expect(() =>
      resolveSecretsInitFromJsonArg({
        fromJsonRaw: "-",
        argv: ["node", "cli.js", "secrets", "init", "--from-json", "-"],
        stdinIsTTY: true,
      }),
    ).toThrow(/tty/i);
  });
});
