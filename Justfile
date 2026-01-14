set shell := ["zsh", "-lc"]

default:
  @just --list

install:
  cd {{justfile_directory()}} && pnpm install

build:
  cd {{justfile_directory()}} && pnpm run build

test:
  cd {{justfile_directory()}} && pnpm run test

typecheck:
  cd {{justfile_directory()}} && pnpm run typecheck

clawdlets-build:
  cd {{justfile_directory()}} && pnpm run clawdlets:build

doctor:
  cd {{justfile_directory()}} && pnpm run clawdlets:doctor

bootstrap +args="":
  cd {{justfile_directory()}} && pnpm run clawdlets:bootstrap -- {{args}}

clawdlets-lockdown +args="":
  cd {{justfile_directory()}} && pnpm run clawdlets:lockdown -- {{args}}

tofu-lockdown:
  cd {{justfile_directory()}} && pnpm run clawdlets:infra -- apply --public-ssh=false

config-validate:
  cd {{justfile_directory()}} && node cli/dist/main.js config validate

config-show:
  cd {{justfile_directory()}} && node cli/dist/main.js config show

secrets-init host="clawdbot-fleet-host":
  cd {{justfile_directory()}} && pnpm run clawdlets:secrets -- init --host {{host}}

secrets-sync host="clawdbot-fleet-host":
  cd {{justfile_directory()}} && pnpm run clawdlets:secrets -- sync --host {{host}}

infra-apply host="clawdbot-fleet-host" public_ssh="false":
  cd {{justfile_directory()}} && pnpm run clawdlets:infra -- apply --host {{host}} --public-ssh={{public_ssh}}

server-units target_host:
  cd {{justfile_directory()}} && pnpm run clawdlets:server -- status --target-host {{target_host}}

server-health target_host since="15m":
  cd {{justfile_directory()}} && pnpm run clawdlets:server -- logs --target-host {{target_host}} --since {{since}}

server-logs target_host args="":
  cd {{justfile_directory()}} && pnpm run clawdlets:server -- logs --target-host {{target_host}} {{args}}

server-restart target_host args="":
  cd {{justfile_directory()}} && pnpm run clawdlets:server -- restart --target-host {{target_host}} {{args}}

server-deploy target_host args="":
  cd {{justfile_directory()}} && pnpm run clawdlets:server -- deploy --target-host {{target_host}} {{args}}

nix-daemon-restart:
  ps -axo pid,command | rg 'nix-daemon' || true
  pids=$(ps -axo pid,command | rg 'nix-daemon' | awk '{print $1}' | tr '\n' ' ') && [ -n "$pids" ] && sudo kill $pids || true
  sleep 1
  ps -axo pid,command | rg 'nix-daemon' || true

clawdlets-help:
  cd {{justfile_directory()}} && pnpm run clawdlets:help

clawdlets-dev-install:
  cd {{justfile_directory()}} && ./scripts/dev-install-clawdlets-wrapper.sh
