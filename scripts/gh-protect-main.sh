#!/usr/bin/env bash
set -euo pipefail

repo=""
branch="main"
linear_history="false"
declare -a contexts=()

usage() {
  cat <<'EOF'
Usage: gh-protect-main.sh [--repo owner/repo] [--branch main] [--linear-history] [--require-check <context> ...]

Applies branch protection for a repo/branch:
- require PR reviews (1)
- require conversation resolution
- block force pushes + deletions
- enforce admins
- optional: require linear history
- optional: require specific status check contexts

Examples:
  ./scripts/gh-protect-main.sh
  ./scripts/gh-protect-main.sh --repo owner/repo --linear-history
  ./scripts/gh-protect-main.sh --require-check "ci / node"
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      repo="${2:-}"; shift 2;;
    --branch)
      branch="${2:-}"; shift 2;;
    --linear-history)
      linear_history="true"; shift;;
    --require-check)
      contexts+=("${2:-}"); shift 2;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "unknown arg: $1" >&2
      usage >&2
      exit 2;;
  esac
done

if [[ -z "$repo" ]]; then
  repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi
if [[ -z "$repo" ]]; then
  echo "unable to resolve repo (pass --repo owner/repo)" >&2
  exit 2
fi

required_status_checks="null"
if [[ ${#contexts[@]} -gt 0 ]]; then
  contexts_json="$(printf '%s\n' "${contexts[@]}" | jq -R . | jq -s .)"
  required_status_checks="$(jq -n --argjson contexts "$contexts_json" '{strict:true,contexts:$contexts}')"
fi

payload="$(
  jq -n \
    --argjson required_status_checks "$required_status_checks" \
    --argjson required_linear_history "$linear_history" \
    '{
      required_status_checks: $required_status_checks,
      enforce_admins: true,
      required_pull_request_reviews: {
        dismiss_stale_reviews: true,
        require_code_owner_reviews: false,
        required_approving_review_count: 1
      },
      restrictions: null,
      required_linear_history: $required_linear_history,
      allow_force_pushes: false,
      allow_deletions: false,
      required_conversation_resolution: true
    }'
)"

echo "repo: $repo"
echo "branch: $branch"
echo "linear_history: $linear_history"
if [[ ${#contexts[@]} -gt 0 ]]; then
  echo "required_checks:"
  printf '  - %s\n' "${contexts[@]}"
else
  echo "required_checks: (unset)"
fi

gh api -X PUT "repos/$repo/branches/$branch/protection" --input - <<<"$payload" >/dev/null
echo "ok: branch protection applied"

