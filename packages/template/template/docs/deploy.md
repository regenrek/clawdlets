# Deploy / Updates (options)

Goal: keep the **repo public-safe** and keep instance-specific data in `.clawdlets/` (gitignored).

## Recommended: stack-based deploy (public repo + private `.clawdlets/`)

Why:
- No instance keys/tokens in git.
- No long-lived GitHub creds on servers (only needed if your base flake repo is private).
- One source of truth for CLI + future UI.

macOS note (Determinate Nix): if you see “restricted setting / not a trusted user” warnings during bootstrap,
fix `trusted-users` once. See `docs/install.md`.

### 1) First install (provision + nixos-anywhere)

Run:

```bash
export CLAWDLETS_INTERACTIVE=1
clawdlets stack init
clawdlets secrets init
clawdlets doctor --scope deploy
clawdlets bootstrap
```

If bootstrap OOMs (exit 137), temporarily disable `"coding-agent"` / Codex (via `clawdlets config set ...`) or use a bigger
builder. Details: `docs/install.md`.

### 2) Updates (rebuild)

Preferred: rebuild on the host over VPN (WireGuard/Tailscale), but pass GitHub auth only for the command.

CLI (pinned, resolves full SHA locally):

```bash
just server-rebuild-rev admin@<ipv4> HEAD
```

Example (WireGuard / Tailscale):

```bash
clawdlets server rebuild --target-host admin@<tailscale-ip> --rev HEAD
```

Notes:
- `nixos-rebuild` runs on the host (your macOS machine doesn’t need it installed).
- This keeps `GITHUB_TOKEN` off disk on the server (only in process env during the command).
- Host Nix config includes the garnix cache (see `infra/nix/modules/clawdbot-fleet/impl.nix`), so updates should
  substitute instead of rebuilding from source in normal cases.

## Other options (and tradeoffs)

### Private base repo + PAT

If your base flake repo is private, put `GITHUB_TOKEN` into `.clawdlets/.env` (fine-grained PAT; Contents: read).

### Private repo + store PAT on server

Pros:
- Simple automation (timer/cron can rebuild).

Why we’re against it:
- Long-lived GitHub credential at rest on a server (harder rotation, bigger blast radius).

### GitHub App (automation without PATs)

Pros:
- Short-lived installation tokens (no manual PAT rotation).
- Can scope to a single repo + Contents read-only.

Why we’re not using it (yet):
- Extra setup (App creation, install, key management, token minting).

### CI build + signed binary cache (Attic)

Pros:
- Best long-term ops: servers pull signed substitutes from your cache.
- Can avoid GitHub auth on servers entirely (depending on deploy approach).

Why we’re not using it (yet):
- Need to run/secure an Attic server + signing key, plus CI wiring.

### “Build locally then copy store paths to server”

Why it’s usually a dead end here:
- macOS can’t directly build `x86_64-linux` NixOS closures without a Linux builder.
- Pushing unsigned local store paths to a restricted Nix store hits the signature/trust wall again unless you redesign trust/signing.
