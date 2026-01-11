#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'TXT' >&2
usage:
  scripts/sync-template-nix.sh --check
  scripts/sync-template-nix.sh --apply
TXT
}

mode="${1:-}"
case "$mode" in
  --check|--apply) ;;
  *) usage; exit 2 ;;
esac

ROOT="$(git rev-parse --show-toplevel)"

has_cmd() { command -v "$1" >/dev/null 2>&1; }

file_mode() {
  local path="$1"
  stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path"
}

trash_or_rm() {
  local path="$1"
  if has_cmd trash; then
    trash -- "$path"
  else
    rm -f -- "$path"
  fi
}

list_files() {
  local dir="$1"
  (cd "$dir" && find . -name .terraform -type d -prune -o -type f -print | sed 's|^\./||' | LC_ALL=C sort)
}

sync_tree_apply() {
  local src="$1"
  local dest="$2"

  mkdir -p "$dest"

  local extras
  extras="$(comm -23 <(list_files "$dest") <(list_files "$src") || true)"

  if [ -n "$extras" ]; then
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      trash_or_rm "$dest/$rel"
    done <<<"$extras"
  fi

  rsync -a --checksum --exclude '.terraform/' "$src/" "$dest/"

  find "$dest" -depth -type d -empty -print0 | xargs -0 -I {} rmdir -- {} 2>/dev/null || true
}

sync_tree_check() {
  local src="$1"
  local dest="$2"

  if [ ! -d "$dest" ]; then
    echo "missing: $dest" >&2
    return 1
  fi

  local extras missing
  extras="$(comm -23 <(list_files "$dest") <(list_files "$src") || true)"
  missing="$(comm -13 <(list_files "$dest") <(list_files "$src") || true)"

  if [ -n "$extras" ] || [ -n "$missing" ]; then
    echo "tree mismatch: $dest" >&2
    if [ -n "$missing" ]; then
      echo "missing files:" >&2
      echo "$missing" >&2
    fi
    if [ -n "$extras" ]; then
      echo "extra files:" >&2
      echo "$extras" >&2
    fi
    return 1
  fi

  local changed
  changed="$(rsync -a --checksum --exclude '.terraform/' --dry-run --out-format='%i %n%L' "$src/" "$dest/" | LC_ALL=C sort || true)"
  if [ -n "$changed" ]; then
    echo "content mismatch:" >&2
    echo "$changed" >&2
    return 1
  fi
}

sync_file_apply() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  install -m "$(file_mode "$src")" "$src" "$dest"
}

sync_file_check() {
  local src="$1"
  local dest="$2"
  if [ ! -f "$dest" ]; then
    echo "missing: $dest" >&2
    return 1
  fi
  if ! cmp -s "$src" "$dest"; then
    echo "content mismatch: $dest" >&2
    return 1
  fi

  if [ "$(file_mode "$src")" != "$(file_mode "$dest")" ]; then
    echo "mode mismatch: $dest" >&2
    return 1
  fi
}

sync_tree() {
  local rel="$1"
  local src="$ROOT/$rel"
  local dest="$ROOT/packages/template/template/$rel"
  if [ "$mode" = "--apply" ]; then
    sync_tree_apply "$src" "$dest"
  else
    sync_tree_check "$src" "$dest"
  fi
}

sync_file() {
  local rel="$1"
  local src="$ROOT/$rel"
  local dest="$ROOT/packages/template/template/$rel"
  if [ "$mode" = "--apply" ]; then
    sync_file_apply "$src" "$dest"
  else
    sync_file_check "$src" "$dest"
  fi
}

sync_tree infra/nix
sync_tree infra/terraform
sync_file infra/configs/fleet.nix
sync_file infra/configs/clawdlets.json
sync_file infra/configs/bundled-skills.json

sync_file scripts/gh-sync.sh
sync_file scripts/gh-sync-read.sh
sync_file scripts/ops-snapshot.sh
