#!/usr/bin/env bash
# gh-sync.sh — Pure IO sync of GitHub state (PRs/issues) into a local "memory" dir.
#
# Notes:
# - no heuristics / scoring; raw inventory only
# - safe to run under a bot user with GH_TOKEN/GITHUB_TOKEN

set -euo pipefail

MEMORY_DIR="${MEMORY_DIR:-}"
ORG="${ORG:-}"
REPOS="${REPOS:-}"

if [ -z "$MEMORY_DIR" ]; then
  echo "gh-sync: set MEMORY_DIR (destination base dir)" >&2
  exit 1
fi

GITHUB_DIR="${MEMORY_DIR}/github"
mkdir -p "$GITHUB_DIR"

log() {
  echo "[gh-sync] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >&2
}

sync_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ -n "$REPOS" ]; then
  repos="$REPOS"
else
  if [ -z "$ORG" ]; then
    echo "gh-sync: set ORG or REPOS" >&2
    exit 1
  fi
  log "Fetching repos for org: $ORG"
  repos="$(gh repo list "$ORG" --json nameWithOwner,isArchived --limit 500 -q '.[] | select(.isArchived == false) | .nameWithOwner')"
fi

if [ -z "${repos:-}" ]; then
  log "ERROR: no repos found (gh auth failed?)"
  exit 1
fi

prs_tmp="$(mktemp)"
issues_tmp="$(mktemp)"
trap 'rm -f "$prs_tmp" "$issues_tmp"' EXIT

printf '# Open Pull Requests\n\nLast synced: %s\n\n' "$sync_time" >"$prs_tmp"
printf '# Open Issues\n\nLast synced: %s\n\n' "$sync_time" >"$issues_tmp"

for repo in $repos; do
  log "Processing $repo"

  prs_json="$(gh pr list -R "$repo" --state open --json number,title,author,createdAt,updatedAt,reviewDecision,labels,isDraft,mergeable,headRefName,url --limit 200 2>/dev/null || echo '[]')"
  if [ "$(printf '%s' "$prs_json" | jq 'length')" -gt 0 ]; then
    printf '## %s\n\n' "$repo" >>"$prs_tmp"
    printf '%s' "$prs_json" | jq -r '.[] | "- **#\(.number)** [\(.title)](\(.url))\n  - Author: @\(.author.login)\n  - Created: \(.createdAt)\n  - Updated: \(.updatedAt)\n  - Review: \(.reviewDecision // "PENDING")\n  - Draft: \(.isDraft)\n  - Labels: \((.labels // []) | map(.name) | join(", ") | if . == "" then "none" else . end)\n"' >>"$prs_tmp"
    printf '\n' >>"$prs_tmp"
  fi

  issues_json="$(gh issue list -R "$repo" --state open --json number,title,author,createdAt,updatedAt,labels,comments,url --limit 200 2>/dev/null || echo '[]')"
  if [ "$(printf '%s' "$issues_json" | jq 'length')" -gt 0 ]; then
    printf '## %s\n\n' "$repo" >>"$issues_tmp"
    printf '%s' "$issues_json" | jq -r '.[] | "- **#\(.number)** [\(.title)](\(.url))\n  - Author: @\(.author.login)\n  - Created: \(.createdAt)\n  - Updated: \(.updatedAt)\n  - Comments: \(.comments | length)\n  - Labels: \((.labels // []) | map(.name) | join(", ") | if . == "" then "none" else . end)\n"' >>"$issues_tmp"
    printf '\n' >>"$issues_tmp"
  fi
done

mv "$prs_tmp" "$GITHUB_DIR/prs.md"
mv "$issues_tmp" "$GITHUB_DIR/issues.md"

log "Sync complete: $GITHUB_DIR/prs.md, $GITHUB_DIR/issues.md"
