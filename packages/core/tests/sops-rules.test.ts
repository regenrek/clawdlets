import { describe, it, expect } from "vitest";
import YAML from "yaml";

describe("sops-rules doctor compatibility", () => {
  it("produces path_regex values doctor checks for", async () => {
    const { getRepoLayout } = await import("../src/repo-layout");
    const { upsertSopsCreationRule } = await import("../src/lib/sops-config");
    const { getHostAgeKeySopsCreationRulePathRegex, getHostSecretsSopsCreationRulePathRegex } = await import("../src/lib/sops-rules");

    const layout = getRepoLayout("/repo", "/repo/.clawdlets");
    const host = "clawdbot-fleet-host";

    const expectedHostSecrets = getHostSecretsSopsCreationRulePathRegex(layout, host);
    const expectedHostAgeKey = getHostAgeKeySopsCreationRulePathRegex(layout, host);

    let sopsYaml = upsertSopsCreationRule({
      pathRegex: expectedHostAgeKey,
      ageRecipients: ["age1operator"],
    });
    sopsYaml = upsertSopsCreationRule({
      existingYaml: sopsYaml,
      pathRegex: expectedHostSecrets,
      ageRecipients: ["age1host", "age1operator"],
    });

    const parsed = (YAML.parse(sopsYaml) as { creation_rules?: unknown }) || {};
    const rules = Array.isArray(parsed.creation_rules) ? (parsed.creation_rules as Array<{ path_regex?: unknown }>) : [];
    const regexes = rules.map((r) => String(r?.path_regex || "")).filter(Boolean);

    expect(regexes).toContain(expectedHostAgeKey);
    expect(regexes).toContain(expectedHostSecrets);
  });
});

