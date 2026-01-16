export function linuxBuildRequiredError(params: { command: string }): Error {
  const cmd = params.command.trim() || "this command";
  return new Error(
    [
      `${cmd}: local NixOS builds require Linux.`,
      "Use one of:",
      "- CI: deploy-manifest.yml publishes signed deploy manifests, then deploy.yml (or selfUpdate) deploys by manifest over tailnet",
      "- Linux builder: build the system on Linux and deploy with --manifest or --toplevel",
    ].join("\n"),
  );
}

export function requireLinuxForLocalNixosBuild(params: { platform: string; command: string }): void {
  if (params.platform === "linux") return;
  throw linuxBuildRequiredError({ command: params.command });
}

