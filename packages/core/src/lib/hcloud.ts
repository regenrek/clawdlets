import { createHash } from "node:crypto";

type HcloudSshKey = {
  id: number;
  name: string;
  public_key: string;
};

type ListSshKeysResponse = {
  ssh_keys: HcloudSshKey[];
};

type CreateSshKeyResponse = {
  ssh_key: HcloudSshKey;
};

export const HCLOUD_REQUEST_TIMEOUT_MS = 15_000;
const HCLOUD_ERROR_BODY_LIMIT_BYTES = 64 * 1024;

export class HcloudHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;

  constructor(message: string, params: { status: number; bodyText: string }) {
    super(`${message}: HTTP ${params.status}: ${params.bodyText}`);
    this.name = "HcloudHttpError";
    this.status = params.status;
    this.bodyText = params.bodyText;
  }
}

async function readResponseTextLimited(res: Response, limitBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    const nextTotal = total + value.byteLength;
    if (nextTotal > limitBytes) {
      const sliceLen = Math.max(0, limitBytes - total);
      if (sliceLen > 0) {
        out += decoder.decode(value.slice(0, sliceLen), { stream: true });
      }
      out += "...(truncated)";
      await reader.cancel();
      total = limitBytes;
      break;
    }
    total = nextTotal;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

async function hcloudRequest<T>(params: {
  token: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}): Promise<{ ok: true; json: T } | { ok: false; status: number; bodyText: string }> {
  const search =
    params.query && Object.keys(params.query).length > 0
      ? `?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params.query)
              .filter(([, v]) => v !== undefined && v !== null && `${v}`.length > 0)
              .map(([k, v]) => [k, `${v}`]),
          ),
        ).toString()}`
      : "";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, HCLOUD_REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`https://api.hetzner.cloud/v1${params.path}${search}`, {
      method: params.method,
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
      },
      body: params.body ? JSON.stringify(params.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const bodyText = controller.signal.aborted
      ? `request timed out after ${HCLOUD_REQUEST_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    return { ok: false, status: 0, bodyText };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const bodyText = await readResponseTextLimited(res, HCLOUD_ERROR_BODY_LIMIT_BYTES);
    return { ok: false, status: res.status, bodyText };
  }

  return { ok: true, json: (await res.json()) as T };
}

export async function ensureHcloudSshKeyId(params: {
  token: string;
  name: string;
  publicKey: string;
}): Promise<string> {
  const normalizedKey = params.publicKey.trim();
  const nameBase = params.name.trim();
  const nameHash = createHash("sha256").update(normalizedKey).digest("hex").slice(0, 10);
  const nameHashed = `${nameBase}-${nameHash}`;

  const list = await hcloudRequest<ListSshKeysResponse>({
    token: params.token,
    method: "GET",
    path: "/ssh_keys",
  });
  if (!list.ok) {
    throw new HcloudHttpError("hcloud list ssh keys failed", { status: list.status, bodyText: list.bodyText });
  }

  const existing = list.json.ssh_keys.find((k) => k.public_key.trim() === normalizedKey);
  if (existing) return String(existing.id);

  const tryCreate = async (name: string) =>
    await hcloudRequest<CreateSshKeyResponse>({
      token: params.token,
      method: "POST",
      path: "/ssh_keys",
      body: { name, public_key: normalizedKey },
    });

  const create = await tryCreate(nameHashed);
  if (create.ok) return String(create.json.ssh_key.id);

  if (create.status === 409) {
    // Name collision or uniqueness constraint: retry with alternate name,
    // then fall back to public_key lookup.
    const createAlt = await tryCreate(`${nameHashed}-2`);
    if (createAlt.ok) return String(createAlt.json.ssh_key.id);

    const listAgain = await hcloudRequest<ListSshKeysResponse>({
      token: params.token,
      method: "GET",
      path: "/ssh_keys",
    });
    if (!listAgain.ok) {
      throw new HcloudHttpError("hcloud list ssh keys failed after 409", { status: listAgain.status, bodyText: listAgain.bodyText });
    }

    const existingAfter409 = listAgain.json.ssh_keys.find(
      (k) => k.public_key.trim() === normalizedKey,
    );
    if (existingAfter409) return String(existingAfter409.id);
  }

  throw new HcloudHttpError("hcloud create ssh key failed", { status: create.status, bodyText: create.bodyText });
}

export type HcloudFirewallRule = {
  direction: "in" | "out";
  protocol: "tcp" | "udp" | "icmp" | "esp" | "gre";
  port?: string;
  source_ips?: string[];
  destination_ips?: string[];
  description?: string;
};

type HcloudFirewall = {
  id: number;
  name: string;
  labels: Record<string, string>;
};

type HcloudFirewallWithRules = HcloudFirewall & {
  rules: HcloudFirewallRule[];
};

type ListFirewallsResponse = {
  firewalls: HcloudFirewall[];
  meta?: { pagination?: { next_page?: number | null } };
};

type CreateFirewallResponse = {
  firewall: HcloudFirewall;
};

type GetFirewallResponse = {
  firewall: HcloudFirewallWithRules;
};

type SetFirewallRulesResponse = {
  action?: unknown;
};

async function listAllFirewalls(params: { token: string; labelSelector?: string }): Promise<HcloudFirewall[]> {
  const out: HcloudFirewall[] = [];
  let page = 1;
  while (true) {
    const res = await hcloudRequest<ListFirewallsResponse>({
      token: params.token,
      method: "GET",
      path: "/firewalls",
      query: {
        page,
        per_page: 50,
        ...(params.labelSelector ? { label_selector: params.labelSelector } : {}),
      },
    });
    if (!res.ok) throw new HcloudHttpError("hcloud list firewalls failed", { status: res.status, bodyText: res.bodyText });
    out.push(...(res.json.firewalls || []));
    const next = res.json.meta?.pagination?.next_page;
    if (!next) break;
    page = next;
  }
  return out;
}

function labelSelectorFromLabels(labels: Record<string, string> | undefined): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(labels || {})) {
    const kk = String(k || "").trim();
    const vv = String(v ?? "").trim();
    if (!kk || !vv) continue;
    parts.push(`${kk}=${vv}`);
  }
  return parts.join(",");
}

function normalizeFirewallRules(rules: HcloudFirewallRule[]): unknown[] {
  const normalized = rules.map((r) => {
    const sourceIps = (r.source_ips || []).map((s) => String(s || "").trim()).filter(Boolean).sort();
    const destIps = (r.destination_ips || []).map((s) => String(s || "").trim()).filter(Boolean).sort();
    return {
      direction: r.direction,
      protocol: r.protocol,
      ...(r.port ? { port: String(r.port) } : {}),
      ...(sourceIps.length > 0 ? { source_ips: sourceIps } : {}),
      ...(destIps.length > 0 ? { destination_ips: destIps } : {}),
      ...(r.description ? { description: String(r.description) } : {}),
    };
  });
  normalized.sort((a: any, b: any) => {
    const ak = `${a.direction}|${a.protocol}|${a.port || ""}|${(a.source_ips || []).join(",")}|${(a.destination_ips || []).join(",")}|${a.description || ""}`;
    const bk = `${b.direction}|${b.protocol}|${b.port || ""}|${(b.source_ips || []).join(",")}|${(b.destination_ips || []).join(",")}|${b.description || ""}`;
    return ak.localeCompare(bk);
  });
  return normalized;
}

function firewallRulesEqual(a: HcloudFirewallRule[], b: HcloudFirewallRule[]): boolean {
  return JSON.stringify(normalizeFirewallRules(a)) === JSON.stringify(normalizeFirewallRules(b));
}

export async function ensureHcloudFirewallId(params: {
  token: string;
  name: string;
  rules: HcloudFirewallRule[];
  labels?: Record<string, string>;
}): Promise<string> {
  const name = params.name.trim();
  if (!name) throw new Error("firewall name missing");
  const labelSelector = labelSelectorFromLabels(params.labels);
  const existing = (await listAllFirewalls({ token: params.token, ...(labelSelector ? { labelSelector } : {}) })).find((fw) => fw.name === name);
  if (existing) {
    const details = await hcloudRequest<GetFirewallResponse>({
      token: params.token,
      method: "GET",
      path: `/firewalls/${existing.id}`,
    });
    if (!details.ok) {
      throw new HcloudHttpError("hcloud get firewall failed", { status: details.status, bodyText: details.bodyText });
    }

    const currentRules = details.json.firewall.rules || [];
    if (!firewallRulesEqual(currentRules, params.rules || [])) {
      const setRules = await hcloudRequest<SetFirewallRulesResponse>({
        token: params.token,
        method: "POST",
        path: `/firewalls/${existing.id}/actions/set_rules`,
        body: { rules: params.rules },
      });
      if (!setRules.ok) {
        throw new HcloudHttpError("hcloud set firewall rules failed", { status: setRules.status, bodyText: setRules.bodyText });
      }
    }
    return String(existing.id);
  }

  const created = await hcloudRequest<CreateFirewallResponse>({
    token: params.token,
    method: "POST",
    path: "/firewalls",
    body: {
      name,
      rules: params.rules,
      ...(params.labels ? { labels: params.labels } : {}),
    },
  });
  if (!created.ok) throw new HcloudHttpError("hcloud create firewall failed", { status: created.status, bodyText: created.bodyText });
  return String(created.json.firewall.id);
}

export type HcloudServerStatus =
  | "initializing"
  | "starting"
  | "running"
  | "stopping"
  | "off"
  | "deleting"
  | "migrating"
  | "rebuilding"
  | "unknown";

export type HcloudServer = {
  id: number;
  name: string;
  status: HcloudServerStatus | string;
  created: string;
  labels: Record<string, string>;
  public_net?: {
    ipv4?: { ip?: string | null };
  };
};

type ListServersResponse = {
  servers: HcloudServer[];
  meta?: { pagination?: { next_page?: number | null } };
};

type CreateServerResponse = {
  server: HcloudServer;
};

type GetServerResponse = {
  server: HcloudServer;
};

async function listAllServers(params: { token: string; labelSelector?: string }): Promise<HcloudServer[]> {
  const out: HcloudServer[] = [];
  let page = 1;
  while (true) {
    const res = await hcloudRequest<ListServersResponse>({
      token: params.token,
      method: "GET",
      path: "/servers",
      query: {
        page,
        per_page: 50,
        ...(params.labelSelector ? { label_selector: params.labelSelector } : {}),
      },
    });
    if (!res.ok) throw new HcloudHttpError("hcloud list servers failed", { status: res.status, bodyText: res.bodyText });
    out.push(...(res.json.servers || []));
    const next = res.json.meta?.pagination?.next_page;
    if (!next) break;
    page = next;
  }
  return out;
}

export async function listHcloudServers(params: { token: string; labelSelector?: string }): Promise<HcloudServer[]> {
  return await listAllServers({ token: params.token, labelSelector: params.labelSelector });
}

export async function createHcloudServer(params: {
  token: string;
  name: string;
  serverType: string;
  image: string;
  location: string;
  userData: string;
  labels: Record<string, string>;
  firewallIds?: string[];
}): Promise<HcloudServer> {
  const created = await hcloudRequest<CreateServerResponse>({
    token: params.token,
    method: "POST",
    path: "/servers",
    body: {
      name: params.name,
      server_type: params.serverType,
      image: params.image,
      location: params.location,
      user_data: params.userData,
      labels: params.labels,
      ...(params.firewallIds && params.firewallIds.length > 0
        ? { firewalls: params.firewallIds.map((id) => ({ firewall: Number(id) })) }
        : {}),
    },
  });
  if (!created.ok) throw new HcloudHttpError("hcloud create server failed", { status: created.status, bodyText: created.bodyText });
  return created.json.server;
}

export async function getHcloudServer(params: { token: string; id: string }): Promise<HcloudServer> {
  const id = String(params.id || "").trim();
  if (!/^\d+$/.test(id)) throw new Error(`invalid hcloud server id: ${id}`);
  const res = await hcloudRequest<GetServerResponse>({
    token: params.token,
    method: "GET",
    path: `/servers/${id}`,
  });
  if (!res.ok) throw new HcloudHttpError("hcloud get server failed", { status: res.status, bodyText: res.bodyText });
  return res.json.server;
}

export async function waitForHcloudServerStatus(params: {
  token: string;
  id: string;
  want: (status: string) => boolean;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<HcloudServer> {
  const timeoutMs = params.timeoutMs ?? 180_000;
  const pollMs = params.pollMs ?? 2_000;
  const start = Date.now();
  while (true) {
    const server = await getHcloudServer({ token: params.token, id: params.id });
    if (params.want(String(server.status || ""))) return server;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for server ${params.id} status (last=${String(server.status || "")})`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export async function deleteHcloudServer(params: { token: string; id: string }): Promise<void> {
  const id = String(params.id || "").trim();
  if (!/^\d+$/.test(id)) throw new Error(`invalid hcloud server id: ${id}`);
  const res = await hcloudRequest<unknown>({
    token: params.token,
    method: "DELETE",
    path: `/servers/${id}`,
  });
  if (!res.ok) throw new HcloudHttpError("hcloud delete server failed", { status: res.status, bodyText: res.bodyText });
}
