# Cattle (ephemeral agents)

Goal: on-demand, ephemeral Clawdbot agent VMs on Hetzner Cloud (spawn → run task → destroy).

This is separate from “Pet” hosts (long-running fleet servers).

## Principles

- Hetzner-only.
- Tailnet-first: no public SSH by default.
- TTL everywhere: every cattle instance has an expiry.
- No secrets in Nix store: inject at runtime (cloud-init / tmpfs).

## Config

Enable + configure in `fleet/clawdlets.json`:

```json
{
  "schemaVersion": 6,
  "cattle": {
    "enabled": true,
    "hetzner": {
      "image": "<image-id-or-name>",
      "serverType": "cx22",
      "location": "nbg1",
      "maxInstances": 10,
      "defaultTtl": "2h",
      "labels": { "managed-by": "clawdlets" }
    },
    "defaults": { "autoShutdown": true, "callbackUrl": "" }
  }
}
```

Notes
- `cattle.hetzner.image` must point at a NixOS cattle image (see template output `clawdlets-cattle-image`).
- Labels must be safe: ascii alnum + `._-`, max 63 chars, start/end alnum.

## Prereqs (operator)

- Tailscale installed + authenticated (used for SSH/logs): `tailscale status`
- Hetzner token set in `.clawdlets/env`: `HCLOUD_TOKEN=...`
- Age key available for decrypting host secrets (see `clawdlets secrets verify`)

## Prereqs (project repo)

- Cattle image uploaded to Hetzner as a custom image.
- Host secrets include:
  - `tailscale_auth_key` (for the cattle VM to join tailnet)
  - provider keys for the chosen model (`fleet.envSecrets` -> secret files under `secrets/hosts/<host>/`)

Build + upload (Linux/CI recommended)
- build from the project repo flake:

```bash
nix build -L .#clawdlets-cattle-image
```

- upload to Hetzner (example uses local path; adjust `--location`):

```bash
export HCLOUD_TOKEN=...
hcloud-upload-image upload --image-path ./result --architecture x86 --location nbg1 --labels managed-by=clawdlets,role=cattle-image
```

Then set `fleet/clawdlets.json`:
- `cattle.enabled=true`
- `cattle.hetzner.image="<image-id-or-name>"`

## Commands

```bash
clawdlets identity add --name rex
clawdlets identity list

clawdlets cattle spawn --identity rex --task-file ./task.json --ttl 2h
clawdlets cattle list
clawdlets cattle logs <name-or-id> --follow
clawdlets cattle ssh <name-or-id>
clawdlets cattle destroy <name-or-id>
clawdlets cattle reap --dry-run
```

## Access model (recommended)

- Cattle uses Tailscale for SSH/logging (tailnet-only).
- `clawdlets cattle ssh` resolves the Tailscale IP via `tailscale ip -4 <hostname>`.

Optional breakglass (not default): allow temporary public SSH from `adminCidr` (short TTL).

## Local state

- Local DB: `.clawdlets/cattle/state.sqlite`
- Source of truth for lifecycle: Hetzner labels (`managed-by=clawdlets,cattle=true`)

## Task format

The cattle VM reads `task.json` and runs the configured task once, then exits.

Treat `task.json` as non-secret input. Secrets come from sops-managed files in `secrets/` and are injected at runtime.

## Identity registry

Project repo structure:

```
identities/
  rex/
    SOUL.md
    config.json
    skills/
    memory/
```

`clawdlets cattle spawn --identity <name>` loads:
- `identities/<name>/SOUL.md`
- `identities/<name>/config.json` (`schemaVersion: 1`, `model.primary` optional)

Injected into the VM:
- `/var/lib/clawdlets/identity/SOUL.md`
- `/var/lib/clawdlets/identity/config.json`

Notes
- Size limits enforced (cloud-init `user_data` max 32KiB): keep SOUL + config small.
- Model selection order: `--model` > `identities/<name>/config.json model.primary` > `hosts.<host>.agentModelPrimary`.

## Cost + safety controls

- `cattle.hetzner.maxInstances`: hard cap (spawn refuses beyond limit).
- `--ttl`: required on spawn (or `cattle.hetzner.defaultTtl`).
- `clawdlets cattle reap`: deletes expired instances (use `--dry-run` first).

## Failure modes / debug

Common errors
- `cloud-init user_data too large`: reduce identity/task payload (or move to orchestrator in a later phase).
- `missing envSecrets mapping for <ENV>`: set `fleet.envSecrets.<ENV>=<secretName>` and create that secret file.
- `tailscale ip returned empty output`: the VM didn’t join tailnet (check `tailscale_auth_key`, then use Hetzner console for boot logs).

Debug commands
- list: `clawdlets cattle list`
- logs: `clawdlets cattle logs <id-or-name> --follow`
- ssh: `clawdlets cattle ssh <id-or-name>`
- reap: `clawdlets cattle reap --dry-run`
