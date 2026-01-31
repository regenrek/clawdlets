export function linuxBuildRequiredError(params: { command: string }): Error {
  const cmd = params.command.trim() || "this command";
  return new Error(
    [
      `${cmd}: local NixOS builds require Linux.`,
      "Use one of:",
      "- CI: build systems + publish signed release manifests, then deploy by manifest (or enable pull selfUpdate)",
      "- Linux builder: build the system on Linux and deploy with --manifest",
    ].join("\n"),
  );
}

export function requireLinuxForLocalNixosBuild(params: { platform: string; command: string }): void {
  if (params.platform === "linux") return;
  throw linuxBuildRequiredError({ command: params.command });
}
