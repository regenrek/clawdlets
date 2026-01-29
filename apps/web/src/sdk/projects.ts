import { createServerFn } from "@tanstack/react-start";
import { planProjectInit, initProject } from "@clawdlets/core/lib/project-init";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { createConvexClient } from "~/server/convex";
import { resolveWorkspacePath } from "~/server/paths";
import { readClawdletsEnvTokens } from "~/server/redaction";
import { runWithEvents } from "~/server/run-manager";
import { resolveTemplateSpec } from "~/server/template-spec";
import { getAdminProjectContext } from "~/sdk/repo-root";

function getHost(input?: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  return raw || "clawdbot-fleet-host";
}

export const projectInitPlan = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input");
    const d = data as Record<string, unknown>;
    return {
      localPath: String(d["localPath"] || ""),
      host: getHost(d["host"]),
      templateSpec: resolveTemplateSpec(d["templateSpec"]),
    };
  })
  .handler(async ({ data }) => {
    const destDir = resolveWorkspacePath(data.localPath, { allowMissing: true });
    return await planProjectInit({
      destDir,
      host: data.host,
      templateSpec: data.templateSpec,
    });
  });

export const projectCreateStart = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input");
    const d = data as Record<string, unknown>;
    return {
      name: String(d["name"] || ""),
      localPath: String(d["localPath"] || ""),
      host: getHost(d["host"]),
      templateSpec: resolveTemplateSpec(d["templateSpec"]),
      gitInit: d["gitInit"] === undefined ? true : Boolean(d["gitInit"]),
    };
  })
  .handler(async ({ data }) => {
    const client = createConvexClient();
    const localPath = resolveWorkspacePath(data.localPath, { allowMissing: true });

    const { projectId } = await client.mutation(api.projects.create, {
      name: data.name,
      localPath,
    });
    const { runId } = await client.mutation(api.runs.create, {
      projectId,
      kind: "project_init",
      title: `Create project`,
    });

    await client.mutation(api.runEvents.appendBatch, {
      runId,
      events: [{ ts: Date.now(), level: "info", message: "Starting project init…" }],
    });

    return {
      projectId: projectId as Id<"projects">,
      runId: runId as Id<"runs">,
      host: data.host,
      templateSpec: data.templateSpec,
      gitInit: data.gitInit,
    };
  });

export const projectCreateExecute = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input");
    const d = data as Record<string, unknown>;
    return {
      projectId: d["projectId"] as Id<"projects">,
      runId: d["runId"] as Id<"runs">,
      host: getHost(d["host"]),
      templateSpec: resolveTemplateSpec(d["templateSpec"]),
      gitInit: d["gitInit"] === undefined ? true : Boolean(d["gitInit"]),
    };
  })
  .handler(async ({ data }) => {
    const client = createConvexClient();
    const context = await getAdminProjectContext(client, data.projectId, { allowMissing: true });
    const run = await client.query(api.runs.get, { runId: data.runId });
    if (run.run.projectId !== data.projectId) throw new Error("runId does not match project");
    const repoRoot = context.repoRoot;
    const redactTokens = await readClawdletsEnvTokens(repoRoot);

    try {
      await runWithEvents({
        client,
        runId: data.runId,
        redactTokens,
        fn: async (emit) => {
          await emit({ level: "info", message: `Creating project in ${repoRoot}` });
          const result = await initProject({
            destDir: repoRoot,
            host: data.host,
            templateSpec: data.templateSpec,
            gitInit: data.gitInit,
          });
          await emit({ level: "info", message: `Wrote ${result.plannedFiles.length} files.` });
          for (const step of result.nextSteps) {
            await emit({ level: "info", message: step });
          }
        },
      });

      await client.mutation(api.projects.update, { projectId: data.projectId, status: "ready" });
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "succeeded" });
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await client.mutation(api.projects.update, { projectId: data.projectId, status: "error" });
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "failed", errorMessage: message });
      return { ok: false as const, message };
    }
  });

export const projectImport = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input");
    const d = data as Record<string, unknown>;
    return {
      name: String(d["name"] || ""),
      localPath: String(d["localPath"] || ""),
    };
  })
  .handler(async ({ data }) => {
    const client = createConvexClient();
    const localPath = resolveWorkspacePath(data.localPath, { requireRepoLayout: true });

    const { projectId } = await client.mutation(api.projects.create, {
      name: data.name,
      localPath,
    });
    await client.mutation(api.projects.update, { projectId, status: "ready" });

    const { runId } = await client.mutation(api.runs.create, {
      projectId,
      kind: "project_import",
      title: "Import project",
    });
    await client.mutation(api.runEvents.appendBatch, {
      runId,
      events: [
        { ts: Date.now(), level: "info", message: `Imported project at ${localPath}` },
      ],
    });
    await client.mutation(api.runs.setStatus, { runId, status: "succeeded" });

    return { projectId: projectId as Id<"projects">, runId: runId as Id<"runs"> };
  });
